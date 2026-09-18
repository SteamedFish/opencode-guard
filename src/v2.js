import { createGuardCore } from './guard-core.js';
import { redactText, redactDeep } from './engine.js';
import { restoreDeep } from './restore.js';
import { StreamingUnmasker } from './streaming-unmasker.js';
import { wrapResponse, createJsonSafeSessionView, JSON_STREAM_MASKED_PATTERN } from './response-unmasker.js';

const MCP_SERVER_CACHE_TTL_MS = 5000;

const sanitize = (s) => String(s).replace(/[^a-zA-Z0-9_-]/g, '_');

/**
 * OpenCode v2 plugin entry point. Registers session/tool hooks on the v2
 * plugin context.
 *
 * @param {Object} ctx - OpenCode v2 plugin context
 */
export async function setupV2(ctx) {
  const core = await createGuardCore(ctx.location.directory);
  if (!core) return;

  const providerGet = (providerID) => ctx.provider.get({ providerID });
  const mcpList = () => ctx.mcp.list();
  const handlers = createV2Handlers(core, { providerGet, mcpList });

  await ctx.session.hook('context', handlers.maskRequest);
  await ctx.session.hook('compaction', handlers.maskRequest);
  await ctx.session.hook('generate', handlers.maskRequest);
  await ctx.session.hook('title', handlers.maskRequest);
  await ctx.tool.hook('execute.before', handlers.toolBefore);
  await ctx.tool.hook('execute.after', handlers.toolAfter);
  await ctx.session.hook('http.response', handlers.httpResponse);

  // Older v2 runtimes may not have ws hooks - degrade gracefully
  try {
    await ctx.session.hook('experimental.ws.handshake', handlers.wsHandshake);
    await ctx.session.hook('experimental.ws.receive', handlers.wsReceive);
  } catch (err) {
    if (core.debug) {
      logger.warn(`[opencode-guard] experimental ws hooks unavailable: ${err.message}`);
    }
  }
}

/**
 * Create the v2 hook handlers with injectable provider/mcp accessors
 * (for testing).
 *
 * @param {Object} core - Guard core from createGuardCore
 * @param {Object} env
 * @param {(providerID: string) => Promise<any>} env.providerGet
 * @param {() => Promise<any>} env.mcpList
 */
export function createV2Handlers(core, env) {
  const { config, debug, logger, patterns, aiDetector, getSession, isExcludedEndpoint, isExcludedMcpServer, isExcludedMcpTool } = core;

  // Cached baseURL per providerID (undefined = unknown / error)
  const baseUrlCache = new Map();

  const resolveBaseUrl = async (providerID) => {
    if (!providerID) return undefined;
    if (baseUrlCache.has(providerID)) return baseUrlCache.get(providerID);
    let baseURL;
    try {
      const res = await env.providerGet(providerID);
      baseURL = res?.data?.settings?.baseURL;
    } catch {
      baseURL = undefined;
    }
    baseUrlCache.set(providerID, baseURL);
    return baseURL;
  };

  // Connected MCP server names cache (refreshed at most every 5s)
  const mcpCache = { at: 0, names: [] };

  const getMcpServerNames = async () => {
    if (Date.now() - mcpCache.at < MCP_SERVER_CACHE_TTL_MS) return mcpCache.names;
    try {
      const { data } = await env.mcpList();
      mcpCache.names = Array.isArray(data) ? data.map((s) => s?.name).filter(Boolean) : [];
      mcpCache.at = Date.now();
    } catch {
      // keep previous names on error
    }
    return mcpCache.names;
  };

  /**
   * Determine which MCP server (if any) a tool belongs to. MCP tools have
   * effective name `<sanitized server>_<sanitized tool>`. Also treats a tool
   * as MCP when it carries the prefix of an excluded (local/trusted) server
   * even if that server is not currently connected.
   */
  const mcpServerForTool = async (toolName) => {
    if (!toolName) return null;

    for (const s of config.excludeMcpServers) {
      if (toolName.startsWith(`${sanitize(s)}_`)) return s;
    }

    const names = await getMcpServerNames();
    const sorted = [...names].sort((a, b) => sanitize(b).length - sanitize(a).length);
    for (const name of sorted) {
      if (toolName.startsWith(`${sanitize(name)}_`)) return name;
    }
    return null;
  };

  /** Mask outgoing request content (context/compaction/generate/title hooks). */
  const maskRequest = async (event) => {
    const session = getSession(event.sessionID);
    if (!session) {
      if (debug) logger.log(`[opencode-guard] v2 maskRequest: no session for ${event.sessionID}`);
      return;
    }

    const baseURL = await resolveBaseUrl(event.model?.providerID);
    if (isExcludedEndpoint(baseURL)) {
      if (debug) logger.log(`[opencode-guard] v2 maskRequest: skipping excluded endpoint: ${baseURL}`);
      return;
    }

    let changedCount = 0;

    for (const msg of event.messages ?? []) {
      for (const part of msg?.content ?? []) {
        if (!part) continue;

        if (part.type === 'text' || part.type === 'reasoning') {
          if (typeof part.text !== 'string' || !part.text) continue;
          const result = await redactText(part.text, patterns, session, aiDetector);
          if (result.count > 0) {
            part.text = result.text;
            changedCount += result.count;
          }
          continue;
        }

        if (part.type === 'tool-call') {
          if (part.input && typeof part.input === 'object') {
            await redactDeep(part.input, patterns, session, aiDetector);
          }
          continue;
        }

        if (part.type === 'tool-result') {
          if (part.result) {
            await redactDeep(part.result, patterns, session, aiDetector);
          }
          continue;
        }

        if (part.type === 'compaction') {
          if (typeof part.text === 'string' && part.text) {
            const result = await redactText(part.text, patterns, session, aiDetector);
            if (result.count > 0) {
              part.text = result.text;
              changedCount += result.count;
            }
          }
          continue;
        }
      }
    }

    if (debug && changedCount > 0) {
      logger.log(`[opencode-guard] v2 maskRequest: masked ${changedCount} sensitive values`);
    }
  };

  /** Mask/restore tool arguments before execution. */
  const toolBefore = async (event) => {
    const session = getSession(event.sessionID);
    if (!session) {
      if (debug) logger.log(`[opencode-guard] v2 toolBefore: no session for ${event.sessionID}`);
      return;
    }

    if (!event.input || typeof event.input !== 'object') return;

    const server = await mcpServerForTool(event.tool);

    if (!server) {
      // Built-in tool - executes locally, needs originals
      if (debug) logger.log(`[opencode-guard] v2 toolBefore: restoring args for built-in tool ${event.tool}`, JSON.stringify(event.input));
      restoreDeep(event.input, session, new WeakSet(), debug);
      if (debug) logger.log(`[opencode-guard] v2 toolBefore: restored args`, JSON.stringify(event.input));
      return;
    }

    const short = event.tool.slice(sanitize(server).length + 1);

    if (isExcludedMcpServer(server) || isExcludedMcpTool(short) || isExcludedMcpTool(event.tool)) {
      // Local/trusted MCP - restore originals for local execution
      const reason = isExcludedMcpServer(server) ? `server ${server}` : `tool ${short}`;
      if (debug) logger.log(`[opencode-guard] v2 toolBefore: restoring args for local ${reason}`, JSON.stringify(event.input));
      restoreDeep(event.input, session, new WeakSet(), debug);
      if (debug) logger.log(`[opencode-guard] v2 toolBefore: restored args`, JSON.stringify(event.input));
    } else {
      // External MCP - mask args
      if (debug) logger.log(`[opencode-guard] v2 toolBefore: masking args for external server ${server}`, JSON.stringify(event.input));
      await redactDeep(event.input, patterns, session, aiDetector);
      if (debug) logger.log(`[opencode-guard] v2 toolBefore: masked args`, JSON.stringify(event.input));
    }
  };

  /** Mask tool results after execution. */
  const toolAfter = async (event) => {
    const session = getSession(event.sessionID);
    if (!session) {
      if (debug) logger.log(`[opencode-guard] v2 toolAfter: no session for ${event.sessionID}`);
      return;
    }

    if (event.status === 'completed' && event.result) {
      if (debug) logger.log(`[opencode-guard] v2 toolAfter: masking result`);
      await redactDeep(event.result, patterns, session, aiDetector);
      if (debug) logger.log(`[opencode-guard] v2 toolAfter: masked result`);
    }

    if (event.status === 'error' && event.error) {
      if (debug) logger.log(`[opencode-guard] v2 toolAfter: masking error`);
      await redactDeep(event.error, patterns, session, aiDetector);
      if (debug) logger.log(`[opencode-guard] v2 toolAfter: masked error`);
    }
  };

  /** Restore masked values in the provider HTTP response stream. */
  const httpResponse = async (event) => {
    const session = getSession(event.sessionID);
    if (!session) return;

    const wrapped = wrapResponse(event.response, session);
    if (wrapped) {
      if (debug) logger.log(`[opencode-guard] v2 httpResponse: wrapped response stream for restoration`);
      event.response = wrapped;
    }
  };

  // Per-session WebSocket unmaskers (reset on each model call via handshake)
  const wsUnmaskers = new Map();

  const wsHandshake = async (event) => {
    const key = String(event.sessionID ?? '');
    if (key) wsUnmaskers.delete(key);
  };

  const wsReceive = async (event) => {
    const key = String(event.sessionID ?? '');
    const session = getSession(event.sessionID);
    if (!session || typeof event.frame !== 'string' || !event.frame) return;

    // Each frame is a complete JSON message, so restore within the frame
    // only. A fresh unmasker per frame means we never hold bytes across
    // frames - tokens split across frames are intentionally NOT restored
    // (holding back partial tokens would corrupt the protocol stream).
    const unmasker = new StreamingUnmasker(createJsonSafeSessionView(session), {
      maskedPattern: JSON_STREAM_MASKED_PATTERN,
    });
    event.frame = unmasker.transform(event.frame) + unmasker.flush();
    wsUnmaskers.delete(key);
  };

  return {
    maskRequest,
    toolBefore,
    toolAfter,
    httpResponse,
    wsHandshake,
    wsReceive,
  };
}

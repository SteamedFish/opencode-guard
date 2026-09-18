import { createGuardCore } from './guard-core.js';
import { setupV2 } from './v2.js';
import { redactText, redactDeep } from './engine.js';
import { restoreText, restoreDeep } from './restore.js';
import { StreamingUnmasker } from './streaming-unmasker.js';

/**
 * OpenCode Guard Plugin (v1 API)
 *
 * Privacy-focused plugin for OpenCode that automatically masks sensitive data
 * before it reaches LLM providers and MCP servers. Uses format-preserving masking
 * to maintain realistic-looking values.
 *
 * @param {Object} ctx - OpenCode context
 * @param {string} ctx.directory - Project directory path
 * @returns {Object} Plugin hooks
 */
export const OpenCodeGuard = async (ctx) => {
  const core = await createGuardCore(ctx.directory);
  if (!core) return {};

  const { config, debug, logger, patterns, aiDetector, getSession, isExcludedEndpoint, isExcludedMcpServer, isExcludedMcpTool } = core;

  const streamingUnmaskers = new Map();

  const getStreamingUnmasker = (sessionID) => {
    const key = String(sessionID ?? '');
    if (!key) return null;

    let unmasker = streamingUnmaskers.get(key);
    if (unmasker && !unmasker.isClosed()) {
      return unmasker;
    }

    const session = getSession(sessionID);
    if (!session) return null;

    unmasker = new StreamingUnmasker(session);
    streamingUnmaskers.set(key, unmasker);
    return unmasker;
  };

  return {
    'experimental.chat.messages.transform': async (_input, output) => {
      const msgs = output?.messages;
      if (!Array.isArray(msgs) || msgs.length === 0) return;

      const sessionID = msgs[0]?.info?.sessionID ?? msgs[0]?.parts?.[0]?.sessionID;
      const endpoint = msgs[0]?.info?.endpoint;

      if (isExcludedEndpoint(endpoint)) {
        if (debug) logger.log(`[opencode-guard] skipping excluded endpoint: ${endpoint}`);
        return;
      }

      const session = getSession(sessionID);
      if (!session) {
        if (debug) logger.log(`[opencode-guard] chat.transform: no session for ${sessionID}`);
        return;
      }

      let changedCount = 0;

      for (const msg of msgs) {
        const parts = Array.isArray(msg?.parts) ? msg.parts : [];
        for (const part of parts) {
          if (!part) continue;

          if (part.type === 'text' || part.type === 'reasoning') {
            if (!part.text || typeof part.text !== 'string') continue;
            if (part.ignored) continue;
            if (debug) logger.log(`[opencode-guard] chat.transform: checking text: "${part.text.substring(0, 100)}${part.text.length > 100 ? '...' : ''}"`);
            const result = await redactText(part.text, patterns, session, aiDetector);
            if (result.count > 0) {
              if (debug) logger.log(`[opencode-guard] chat.transform: masked ${result.count} values, text now: "${result.text.substring(0, 100)}${result.text.length > 100 ? '...' : ''}"`);
              part.text = result.text;
              changedCount += result.count;
            }
            continue;
          }

          if (part.type === 'tool') {
            const state = part.state;
            if (!state || typeof state !== 'object') continue;

            if (state.input && typeof state.input === 'object') {
              await redactDeep(state.input, patterns, session, aiDetector);
            }

            if (state.status === 'completed' && typeof state.output === 'string') {
              const result = await redactText(state.output, patterns, session, aiDetector);
              if (result.count > 0) {
                state.output = result.text;
                changedCount += result.count;
              }
            }

            if (state.status === 'error' && typeof state.error === 'string') {
              const result = await redactText(state.error, patterns, session, aiDetector);
              if (result.count > 0) {
                state.error = result.text;
                changedCount += result.count;
              }
            }
          }
        }
      }

      if (debug && changedCount > 0) {
        logger.log(`[opencode-guard] masked ${changedCount} sensitive values`);
      }
    },

    'experimental.text.complete': async (input, output) => {
      if (!output || typeof output !== 'object') return;
      if (typeof output.text !== 'string' || !output.text) return;

      const session = getSession(input?.sessionID);
      if (!session) return;

      const before = output.text;
      output.text = restoreText(output.text, session);

      if (debug && output.text !== before) {
        logger.log('[opencode-guard] restored masked values in response');
      }
    },

    'experimental.text.chunk': async (input, output) => {
      if (!output || typeof output !== 'object') return;
      if (typeof output.text !== 'string') return;

      const unmasker = getStreamingUnmasker(input?.sessionID);
      if (!unmasker) return;

      const before = output.text;
      output.text = unmasker.transform(output.text);

      if (debug && output.text !== before) {
        logger.log('[opencode-guard] restored masked values in streaming chunk');
      }
    },

    'experimental.stream.end': async (input) => {
      const key = String(input?.sessionID ?? '');
      if (!key) return;

      const unmasker = streamingUnmaskers.get(key);
      if (unmasker && !unmasker.isClosed()) {
        streamingUnmaskers.delete(key);
      }
    },

    'mcp.tool.call.before': async (input, output) => {
      const serverName = input?.serverName;
      const toolName = input?.toolName;
      const session = getSession(input?.sessionID);
      if (!session) {
        if (debug) logger.log(`[opencode-guard] mcp.tool.call.before: no session for ${input?.sessionID}`);
        return;
      }

      if (output?.args && typeof output.args === 'object') {
        const isLocal = isExcludedMcpServer(serverName) || isExcludedMcpTool(toolName);
        if (isLocal) {
          const reason = isExcludedMcpServer(serverName) ? `server ${serverName}` : `tool ${toolName}`;
          if (debug) logger.log(`[opencode-guard] mcp.tool.call.before: restoring args for local ${reason}`, JSON.stringify(output.args));
          restoreDeep(output.args, session, new WeakSet(), debug);
          if (debug) logger.log(`[opencode-guard] mcp.tool.call.before: restored args`, JSON.stringify(output.args));
        } else {
          if (debug) logger.log(`[opencode-guard] mcp.tool.call.before: masking args for external server ${serverName}`, JSON.stringify(output.args));
          await redactDeep(output.args, patterns, session, aiDetector);
          if (debug) logger.log(`[opencode-guard] mcp.tool.call.before: masked args`, JSON.stringify(output.args));
        }
      }
    },

    'mcp.tool.call.after': async (input, output) => {
      const session = getSession(input?.sessionID);
      if (!session) {
        if (debug) logger.log(`[opencode-guard] mcp.tool.call.after: no session for ${input?.sessionID}`);
        return;
      }

      if (output?.result !== undefined) {
        // Always mask results to prevent leaking secrets to LLM
        if (debug) logger.log(`[opencode-guard] mcp.tool.call.after: masking result`);
        await redactDeep(output.result, patterns, session, aiDetector);
        if (debug) logger.log(`[opencode-guard] mcp.tool.call.after: masked result`);
      }
    },

    'tool.execute.before': async (input, output) => {
      const session = getSession(input?.sessionID);
      if (!session) {
        if (debug) logger.log(`[opencode-guard] tool.execute.before: no session for ${input?.sessionID}`);
        return;
      }

      // Built-in tools are always local - restore args
      if (output?.args && typeof output.args === 'object') {
        if (debug) {
          logger.log(`[opencode-guard] tool.execute.before: restoring args`, JSON.stringify(output.args));
          logger.log(`[opencode-guard] tool.execute.before: session has ${session.maskedToOriginal.size} mappings`);
          for (const [masked, original] of session.maskedToOriginal) {
            logger.log(`[opencode-guard]   mapping: "${masked}" -> "${original}"`);
          }
        }
        restoreDeep(output.args, session, new WeakSet(), debug);
        if (debug) logger.log(`[opencode-guard] tool.execute.before: restored args`, JSON.stringify(output.args));
      }
    },

    'tool.execute.after': async (input, output) => {
      const session = getSession(input?.sessionID);
      if (!session) {
        if (debug) logger.log(`[opencode-guard] tool.execute.after: no session for ${input?.sessionID}`);
        return;
      }

      // Always mask results to prevent leaking secrets to LLM
      if (output?.result !== undefined) {
        if (debug) logger.log(`[opencode-guard] tool.execute.after: masking result`);
        await redactDeep(output.result, patterns, session, aiDetector);
        if (debug) logger.log(`[opencode-guard] tool.execute.after: masked result`);
      }
    },
  };
};

/**
 * Dual-compat plugin entry point:
 * - OpenCode v2 calls `setup(ctx)` (Plugin.define-style object)
 * - OpenCode v1 (>=1.18.29) calls `server(ctx)`
 */
export default {
  id: 'opencode-guard',
  setup: setupV2,
  server: OpenCodeGuard,
};

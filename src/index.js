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

  const { config, debug, logger, patterns, aiDetector, getSession, createEphemeralSession, isExcludedEndpoint, isExcludedMcpServer, isExcludedMcpTool } = core;

  /**
   * Idle TTL for v1 streaming unmaskers. Entries are dropped lazily (on
   * access) when no chunk/stream.end has touched them for this long, so a
   * stream whose stream.end hook never fires does not leak forever.
   */
  const STREAMING_UNMASKER_TTL_MS = 60 * 60 * 1000; // 1h

  /**
   * KNOWN LIMITATION (M12): v1 streaming unmaskers are keyed by sessionID
   * only. The v1 chunk payload exposes no messageID/requestID, so two
   * concurrent streams within the same session share one unmasker and may
   * interleave buffered tail bytes. v2 (http.response wrapping) does not
   * have this limitation.
   */
  const streamingUnmaskers = new Map(); // key -> { unmasker, lastAccess }

  const purgeIdleStreamingUnmaskers = (now = Date.now()) => {
    for (const [key, entry] of streamingUnmaskers) {
      if (now - entry.lastAccess > STREAMING_UNMASKER_TTL_MS) {
        streamingUnmaskers.delete(key);
        if (debug) logger.log(`[opencode-guard] dropped idle streaming unmasker (>${STREAMING_UNMASKER_TTL_MS}ms)`);
      }
    }
  };

  const getStreamingUnmasker = (sessionID) => {
    const key = String(sessionID ?? '');
    if (!key) return null;

    purgeIdleStreamingUnmaskers();

    let entry = streamingUnmaskers.get(key);
    if (entry && !entry.unmasker.isClosed()) {
      entry.lastAccess = Date.now();
      return entry.unmasker;
    }

    const session = getSession(sessionID);
    if (!session) return null;

    const unmasker = new StreamingUnmasker(session);
    streamingUnmaskers.set(key, { unmasker, lastAccess: Date.now() });
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

      let session = getSession(sessionID);
      if (!session) {
        // Fail-closed: no sessionID means no persistent session, but the
        // request must still be masked. Use a per-request ephemeral session
        // (discarded afterwards; masked values cannot be restored).
        if (debug) logger.log(`[opencode-guard] chat.transform: no sessionID (${sessionID}); masking with ephemeral session (no restore possible)`);
        session = createEphemeralSession();
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

      if (!input?.sessionID) {
        // No sessionID: masked text passes through unrestored (fail-safe
        // direction), but make it observable in debug output.
        if (debug) logger.log('[opencode-guard] text.chunk: no sessionID; chunk left as-is (masked values stay masked)');
        return;
      }

      const unmasker = getStreamingUnmasker(input.sessionID);
      if (!unmasker) return;

      const before = output.text;
      output.text = unmasker.transform(output.text);

      if (debug && output.text !== before) {
        logger.log('[opencode-guard] restored masked values in streaming chunk');
      }
    },

    'experimental.stream.end': async (input, output) => {
      const key = String(input?.sessionID ?? '');
      if (!key) return;

      const entry = streamingUnmaskers.get(key);
      // Delete unconditionally: a closed unmasker must not linger in the map.
      streamingUnmaskers.delete(key);
      if (!entry) return;

      // Flush held tail bytes so the end of the stream is not dropped.
      const tail = entry.unmasker.flush();
      if (!tail) return;

      if (output && typeof output.text === 'string') {
        output.text += tail;
        if (debug) logger.log(`[opencode-guard] stream.end: flushed ${tail.length} buffered bytes into output`);
      } else if (debug) {
        logger.log(`[opencode-guard] stream.end: flushed ${tail.length} buffered bytes (no writable output field; bytes kept in stream buffer until now)`);
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
        // v1 toolName may carry the `<server>_<tool>` prefix (v2 parity):
        // strip it so exclusions are evaluated on the bare tool name.
        const sanitize = (s) => String(s).replace(/[^a-zA-Z0-9_-]/g, '_');
        const prefix = serverName ? `${sanitize(serverName)}_` : '';
        const shortName = toolName && prefix && String(toolName).startsWith(prefix)
          ? String(toolName).slice(prefix.length)
          : String(toolName ?? '');

        const excluded = isExcludedMcpServer(serverName) || isExcludedMcpTool(serverName, shortName, toolName);
        if (excluded) {
          const reason = isExcludedMcpServer(serverName) ? `server ${serverName}` : `tool ${shortName}`;
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
          // Never dump the mapping table here - it contains plaintext secrets.
          logger.log(`[opencode-guard] tool.execute.before: session has ${session.maskedToOriginal.size} mappings`);
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

      // v2 parity: error payloads can contain secrets too
      if (output?.error !== undefined && output.error !== null) {
        if (debug) logger.log(`[opencode-guard] tool.execute.after: masking error`);
        output.error = await redactDeep(output.error, patterns, session, aiDetector);
        if (debug) logger.log(`[opencode-guard] tool.execute.after: masked error`);
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

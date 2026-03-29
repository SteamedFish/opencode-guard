import { loadConfig } from './config.js';
import { buildPatternSet } from './patterns.js';
import { MaskSession } from './session.js';
import { redactText, redactDeep } from './engine.js';
import { restoreText, restoreDeep } from './restore.js';
import { initializeCustomMaskers } from './maskers/index.js';
import { StreamingUnmasker } from './streaming-unmasker.js';
import { AIDetector } from './ai-detector/index.js';

/**
 * OpenCode Guard Plugin
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
  const config = await loadConfig(ctx.directory);
  const debug = Boolean(process.env.OPENCODE_GUARD_DEBUG) || config.debug;

  if (debug) {
    const from = config.loadedFrom ? config.loadedFrom : 'not found (plugin disabled)';
    console.log(`[opencode-guard] config: ${from}, enabled=${config.enabled}`);
  }

  if (!config.enabled || !config.globalSalt) {
    return {};
  }

  initializeCustomMaskers(config.customMaskers);

  // Initialize AI detector if enabled
  let aiDetector = null;
  let aiDetectionReady = false;
  if (config.detection?.aiDetection) {
    aiDetector = new AIDetector({
      provider: config.detection.aiProvider,
      timeoutMs: config.detection.aiTimeoutMs,
      autoInstallDeps: config.detection.autoInstallDeps,
      localModel: config.detection.localModel,
    });

    if (debug) {
      console.log(`[opencode-guard] AI detection enabled (${config.detection.aiProvider})`);
      if (config.detection.autoInstallDeps) {
        console.log(`[opencode-guard] Auto-install enabled for AI dependencies`);
      }
    }

    // Eagerly initialize AI detector so auto-install happens on startup
    try {
      await aiDetector.initialize();
      aiDetectionReady = true;
      if (debug) {
        console.log(`[opencode-guard] AI detector initialized successfully`);
      }
    } catch (err) {
      if (debug) {
        console.warn(`[opencode-guard] AI detector initialization failed: ${err.message}`);
        if (!config.detection.autoInstallDeps) {
          console.log(`[opencode-guard] Tip: Set auto_install_deps: true to automatically install missing dependencies`);
        }
      }
      // Don't throw - plugin should work without AI detection
    }
  }

  const patterns = buildPatternSet(config.patterns);
  const sessions = new Map();
  const streamingUnmaskers = new Map();

  const getSession = (sessionID) => {
    const key = String(sessionID ?? '');
    if (!key) return null;

    let session = sessions.get(key);
    if (session) {
      session.cleanup();
      return session;
    }

    session = new MaskSession(config.globalSalt, {
      ttlMs: config.ttlMs,
      maxMappings: config.maxMappings,
    });
    sessions.set(key, session);
    return session;
  };

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

  const isExcludedEndpoint = (endpoint) => {
    if (!endpoint) return false;
    return config.excludeLlmEndpoints.some(excluded => 
      endpoint.includes(excluded) || excluded.includes(endpoint)
    );
  };

  const isExcludedMcpServer = (server) => {
    if (!server) return false;
    return config.excludeMcpServers.includes(server);
  };

  return {
    'experimental.chat.messages.transform': async (_input, output) => {
      const msgs = output?.messages;
      if (!Array.isArray(msgs) || msgs.length === 0) return;

      const sessionID = msgs[0]?.info?.sessionID ?? msgs[0]?.parts?.[0]?.sessionID;
      const endpoint = msgs[0]?.info?.endpoint;

      if (isExcludedEndpoint(endpoint)) {
        if (debug) console.log(`[opencode-guard] skipping excluded endpoint: ${endpoint}`);
        return;
      }

      const session = getSession(sessionID);
      if (!session) {
        if (debug) console.log(`[opencode-guard] chat.transform: no session for ${sessionID}`);
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
            if (debug) console.log(`[opencode-guard] chat.transform: checking text: "${part.text.substring(0, 100)}${part.text.length > 100 ? '...' : ''}"`);
            const result = await redactText(part.text, patterns, session, aiDetector);
            if (result.count > 0) {
              if (debug) console.log(`[opencode-guard] chat.transform: masked ${result.count} values, text now: "${result.text.substring(0, 100)}${result.text.length > 100 ? '...' : ''}"`);
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
        console.log(`[opencode-guard] masked ${changedCount} sensitive values`);
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
        console.log('[opencode-guard] restored masked values in response');
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
        console.log('[opencode-guard] restored masked values in streaming chunk');
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
      if (isExcludedMcpServer(serverName)) {
        if (debug) console.log(`[opencode-guard] skipping excluded MCP server: ${serverName}`);
        return;
      }

      const session = getSession(input?.sessionID);
      if (!session) {
        if (debug) console.log(`[opencode-guard] mcp.tool.call.before: no session for ${input?.sessionID}`);
        return;
      }

      if (output?.args && typeof output.args === 'object') {
        if (debug) console.log(`[opencode-guard] mcp.tool.call.before: masking args for ${input?.toolName}`, JSON.stringify(output.args));
        await redactDeep(output.args, patterns, session, aiDetector);
        if (debug) console.log(`[opencode-guard] mcp.tool.call.before: masked args`, JSON.stringify(output.args));
      }
    },

    'mcp.tool.call.after': async (input, output) => {
      const session = getSession(input?.sessionID);
      if (!session) {
        if (debug) console.log(`[opencode-guard] mcp.tool.call.after: no session for ${input?.sessionID}`);
        return;
      }

      if (output?.result !== undefined) {
        if (debug) console.log(`[opencode-guard] mcp.tool.call.after: restoring result`);
        restoreDeep(output.result, session, new WeakSet(), debug);
      }
    },

    'tool.execute.before': async (input, output) => {
      const session = getSession(input?.sessionID);
      if (!session) {
        if (debug) console.log(`[opencode-guard] tool.execute.before: no session for ${input?.sessionID}`);
        return;
      }

      if (output?.args && typeof output.args === 'object') {
        if (debug) {
          console.log(`[opencode-guard] tool.execute.before: restoring args`, JSON.stringify(output.args));
          console.log(`[opencode-guard] tool.execute.before: session has ${session.maskedToOriginal.size} mappings`);
          for (const [masked, original] of session.maskedToOriginal) {
            console.log(`[opencode-guard]   mapping: "${masked}" -> "${original}"`);
          }
        }
        restoreDeep(output.args, session, new WeakSet(), debug);
        if (debug) console.log(`[opencode-guard] tool.execute.before: restored args`, JSON.stringify(output.args));
      }
    },
  };
};

export default OpenCodeGuard;

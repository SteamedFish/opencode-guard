import { loadConfig } from './config.js';
import { buildPatternSet } from './patterns.js';
import { MaskSession } from './session.js';
import { redactText, redactDeep } from './engine.js';
import { restoreText, restoreDeep } from './restore.js';
import { initializeCustomMaskers } from './maskers/index.js';

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

  const patterns = buildPatternSet(config.patterns);
  const sessions = new Map();

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
      if (!session) return;

      let changedCount = 0;

      for (const msg of msgs) {
        const parts = Array.isArray(msg?.parts) ? msg.parts : [];
        for (const part of parts) {
          if (!part) continue;

          if (part.type === 'text' || part.type === 'reasoning') {
            if (!part.text || typeof part.text !== 'string') continue;
            if (part.ignored) continue;
            const result = await redactText(part.text, patterns, session);
            if (result.count > 0) {
              part.text = result.text;
              changedCount += result.count;
            }
            continue;
          }

          if (part.type === 'tool') {
            const state = part.state;
            if (!state || typeof state !== 'object') continue;

            if (state.input && typeof state.input === 'object') {
              await redactDeep(state.input, patterns, session);
            }

            if (state.status === 'completed' && typeof state.output === 'string') {
              const result = await redactText(state.output, patterns, session);
              if (result.count > 0) {
                state.output = result.text;
                changedCount += result.count;
              }
            }

            if (state.status === 'error' && typeof state.error === 'string') {
              const result = await redactText(state.error, patterns, session);
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

    'mcp.tool.call.before': async (input, output) => {
      const serverName = input?.serverName;
      if (isExcludedMcpServer(serverName)) {
        if (debug) console.log(`[opencode-guard] skipping excluded MCP server: ${serverName}`);
        return;
      }
      
      const session = getSession(input?.sessionID);
      if (!session) return;

      if (output?.args && typeof output.args === 'object') {
        await redactDeep(output.args, patterns, session);
      }
    },

    'mcp.tool.call.after': async (input, output) => {
      const session = getSession(input?.sessionID);
      if (!session) return;

      if (output?.result !== undefined) {
        restoreDeep(output.result, session);
      }
    },

    'tool.execute.before': async (input, output) => {
      const session = getSession(input?.sessionID);
      if (!session) return;

      if (output?.args && typeof output.args === 'object') {
        restoreDeep(output.args, session);
      }
    },
  };
};

export default OpenCodeGuard;

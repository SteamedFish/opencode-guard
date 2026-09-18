import { loadConfig } from './config.js';
import { createLogger } from './logger.js';
import { buildPatternSet } from './patterns.js';
import { MaskSession } from './session.js';
import { initializeCustomMaskers } from './maskers/index.js';
import { AIDetector } from './ai-detector/index.js';

/**
 * Maximum number of concurrent MaskSessions kept in the registry. When the
 * cap is exceeded the least-recently-accessed session is evicted. Prevents
 * unbounded memory growth in long-running processes that see many
 * sessionIDs.
 */
const MAX_SESSIONS = 1000;

/**
 * Parse a string as a URL (prepending https:// when it has no scheme) and
 * return its hostname/host, or null when not URL-parseable.
 *
 * @param {string} s
 * @returns {{hostname: string, host: string}|null}
 */
function urlHostParts(s) {
  try {
    const hasScheme = /^[a-zA-Z][a-zA-Z0-9+.-]*:\/\//.test(s);
    const u = new URL(hasScheme ? s : `https://${s}`);
    if (!u.hostname) return null;
    return { hostname: u.hostname, host: u.host };
  } catch {
    return null;
  }
}

/**
 * Shared initialization logic for both v1 and v2 plugin entry points.
 *
 * Loads configuration, initializes custom maskers and (optionally) the AI
 * detector, builds the pattern set, and prepares per-session storage plus
 * endpoint/MCP exclusion helpers.
 *
 * @param {string} directory - Project directory path
 * @returns {Promise<Object|null>} Guard core, or null when disabled
 */
export async function createGuardCore(directory) {
  const config = await loadConfig(directory);
  const debug = Boolean(process.env.OPENCODE_GUARD_DEBUG) || config.debug;
  const logger = createLogger({ debug, debugFile: config.debugFile });

  if (debug) {
    const from = config.loadedFrom ? config.loadedFrom : 'not found (plugin disabled)';
    logger.log(`[opencode-guard] config: ${from}, enabled=${config.enabled}`);
  }

  if (!config.enabled || !config.globalSalt) {
    return null;
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
      logger,
    });

    if (debug) {
      logger.log(`[opencode-guard] AI detection enabled (${config.detection.aiProvider})`);
      if (config.detection.autoInstallDeps) {
        logger.log(`[opencode-guard] Auto-install enabled for AI dependencies`);
      }
    }

    // Eagerly initialize AI detector so auto-install happens on startup
    try {
      await aiDetector.initialize();
      aiDetectionReady = true;
      if (aiDetector.isReady()) {
        if (debug) {
          logger.log(`[opencode-guard] AI detector initialized successfully`);
        }
      } else {
        // AI detection was explicitly enabled but is inert. Log via logger
        // (debug-gated) because plain console.warn is invisible under v2;
        // the init failure reason above also only reaches console.
        logger.warn(`[opencode-guard] AI detection enabled but provider unavailable: ${aiDetector.initError || 'unknown reason'}`);
        if (!config.detection.autoInstallDeps) {
          logger.warn(`[opencode-guard] Tip: Set auto_install_deps: true to automatically install missing dependencies`);
        }
      }
    } catch (err) {
      if (debug) {
        logger.warn(`[opencode-guard] AI detector initialization failed: ${err.message}`);
        if (!config.detection.autoInstallDeps) {
          logger.log(`[opencode-guard] Tip: Set auto_install_deps: true to automatically install missing dependencies`);
        }
      }
      // Don't throw - plugin should work without AI detection
    }
  }

  const patterns = buildPatternSet(config.patterns);

  // Session registry. Map insertion order doubles as LRU order: every
  // access re-inserts the key at the end, so the first key is always the
  // least-recently-accessed session.
  const sessions = new Map();

  const createSession = () => new MaskSession(config.globalSalt, {
    ttlMs: config.ttlMs,
    maxMappings: config.maxMappings,
    logger,
  });

  const getSession = (sessionID) => {
    const key = String(sessionID ?? '');
    if (!key) return null;

    let session = sessions.get(key);
    if (session) {
      session.cleanup();
      // Refresh LRU position
      sessions.delete(key);
      sessions.set(key, session);
      return session;
    }

    // Evict least-recently-accessed sessions when the cap is reached
    while (sessions.size >= MAX_SESSIONS) {
      const oldestKey = sessions.keys().next().value;
      if (oldestKey === undefined) break;
      sessions.delete(oldestKey);
      if (debug) logger.log(`[opencode-guard] session registry full (${MAX_SESSIONS}); evicted least-recently-accessed session`);
    }

    session = createSession();
    sessions.set(key, session);
    return session;
  };

  /**
   * Create a per-request ephemeral MaskSession for calls that carry no
   * sessionID. The session is discarded after the request, so masked values
   * can never be restored — but sensitive data never leaves unmasked
   * (fail-closed on the outgoing path).
   *
   * @returns {MaskSession}
   */
  const createEphemeralSession = () => createSession();

  const isExcludedEndpoint = (endpoint) => {
    if (!endpoint) return false;
    const endpointStr = String(endpoint);
    const ep = urlHostParts(endpointStr);

    for (const excluded of config.excludeLlmEndpoints) {
      if (!excluded) continue; // empty entries are rejected at config load

      if (ep) {
        // Hostname-aware comparison: a domain entry matches the exact host
        // or any of its subdomains, so "api.openai.com" does NOT exclude
        // "api.openai.com.evil.tld".
        const ex = urlHostParts(excluded);
        if (ex) {
          const excludedHasPort = ex.host !== ex.hostname;
          if (excludedHasPort) {
            // Port-qualified entry (e.g. "localhost:8080") requires an
            // exact host:port match.
            if (ep.host === ex.host) return true;
          } else if (ep.hostname === ex.hostname || ep.hostname.endsWith(`.${ex.hostname}`)) {
            return true;
          }
          continue;
        }
        if (ep.hostname === excluded) return true;
        continue;
      }

      // Endpoint is not URL-parseable: fall back to exact string equality
      if (endpointStr === excluded) return true;
    }
    return false;
  };

  const isExcludedMcpServer = (server) => {
    if (!server) return false;
    return config.excludeMcpServers.includes(server);
  };

  /**
   * Check whether an MCP tool is excluded (treated as local/trusted).
   *
   * Exclusions are scoped by server to avoid the confused-deputy problem of
   * bare tool names matching ANY server:
   * - Any tool on a server listed in exclude_mcp_servers is excluded
   *   (checked separately via isExcludedMcpServer).
   * - A qualified entry "server/tool" matches that exact tool on that exact
   *   server.
   * - A qualified entry "server_tool" (the effective v2 tool name) matches
   *   the full tool name exactly.
   * - A bare entry (e.g. "run_job") matches ONLY when the tool's server is
   *   itself in exclude_mcp_servers — bare names never match external
   *   servers.
   *
   * @param {string|null} server - MCP server name (null/empty for built-ins)
   * @param {string} shortName - Tool name without the server prefix
   * @param {string} [fullName] - Effective tool name (`<server>_<tool>`)
   * @returns {boolean}
   */
  const isExcludedMcpTool = (server, shortName, fullName) => {
    const short = String(shortName ?? '');
    const full = String(fullName ?? '');
    if (!short && !full) return false;

    for (const raw of config.excludeMcpTools) {
      const entry = String(raw ?? '');
      if (!entry) continue;

      const slash = entry.indexOf('/');
      if (slash > 0) {
        // Qualified "server/tool"
        if (server && entry.slice(0, slash) === server && entry.slice(slash + 1) === short) return true;
        continue;
      }

      if (!server) continue;
      // Qualified "server_tool" (effective tool name). Only treated as
      // qualified when full actually differs from the bare short name —
      // otherwise a bare tool name would match any server (H9).
      if (full && full !== short && entry === full) return true;
      // Bare tool name: only for servers that are themselves excluded
      if (short && entry === short && isExcludedMcpServer(server)) return true;
    }
    return false;
  };

  return {
    config,
    debug,
    logger,
    patterns,
    aiDetector,
    getSession,
    createEphemeralSession,
    isExcludedEndpoint,
    isExcludedMcpServer,
    isExcludedMcpTool,
  };
}

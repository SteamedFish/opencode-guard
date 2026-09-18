import { loadConfig } from './config.js';
import { createLogger } from './logger.js';
import { buildPatternSet } from './patterns.js';
import { MaskSession } from './session.js';
import { initializeCustomMaskers } from './maskers/index.js';
import { AIDetector } from './ai-detector/index.js';

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
      if (debug) {
        logger.log(`[opencode-guard] AI detector initialized successfully`);
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

  const isExcludedMcpTool = (tool) => {
    if (!tool) return false;
    return config.excludeMcpTools.includes(tool);
  };

  return {
    config,
    debug,
    logger,
    patterns,
    aiDetector,
    getSession,
    isExcludedEndpoint,
    isExcludedMcpServer,
    isExcludedMcpTool,
  };
}

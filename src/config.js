import { readFile, writeFile, mkdir, stat } from 'node:fs/promises';
import { join } from 'node:path';
import { existsSync } from 'node:fs';
import { homedir } from 'node:os';
import { randomBytes } from 'node:crypto';

const DEFAULT_LOCAL_MCP_TOOLS = [
  'submit_plan',
  'schedule_job',
  'list_jobs',
  'get_version',
  'get_skill',
  'install_skill',
  'get_job',
  'update_job',
  'delete_job',
  'cleanup_global',
  'run_job',
  'job_logs',
];

export function parseDuration(duration) {
  if (typeof duration === 'number') return duration;
  const str = String(duration).trim();
  const match = str.match(/^(\d+)\s*([hms]?)$/i);
  if (!match) return parseInt(str, 10) || 3600000;
  const value = parseInt(match[1], 10);
  const unit = match[2].toLowerCase();
  switch (unit) {
    case 'h': return value * 60 * 60 * 1000;
    case 'm': return value * 60 * 1000;
    case 's': return value * 1000;
    default: return value;
  }
}

/**
 * Read and parse a config file that is known to exist.
 *
 * @param {string} path - Config file path
 * @returns {Promise<{path: string, content: object}|{path: string, error: Error}>}
 */
async function readConfigFile(path) {
  try {
    const content = JSON.parse(await readFile(path, 'utf-8'));
    return { path, content };
  } catch (err) {
    return { path, error: err instanceof Error ? err : new Error(String(err)) };
  }
}

async function findConfigFile(projectRoot) {
  const envPath = process.env.OPENCODE_GUARD_CONFIG;
  if (envPath && existsSync(envPath)) {
    return readConfigFile(envPath);
  }

  const locations = [
    join(projectRoot, 'opencode-guard.config.json'),
    join(projectRoot, '.opencode', 'opencode-guard.config.json'),
    join(homedir(), '.config', 'opencode', 'opencode-guard.config.json'),
  ];

  for (const path of locations) {
    if (existsSync(path)) {
      return readConfigFile(path);
    }
  }

  return null;
}

const GENERATED_CONFIG_BASENAME = 'opencode-guard.config.json';

/**
 * First-run bootstrap: generate a minimal config file with a random salt in
 * ~/.config/opencode/. On write failure, fall back to an ephemeral in-memory
 * salt so the plugin stays enabled.
 *
 * @returns {Promise<{path: string, content: object, generated: boolean, ephemeral?: boolean}>}
 */
async function generateDefaultConfig() {
  const configDir = join(homedir(), '.config', 'opencode');
  const configPath = join(configDir, GENERATED_CONFIG_BASENAME);
  const salt = randomBytes(32).toString('hex');
  const content = { global_salt: salt };

  try {
    await mkdir(configDir, { recursive: true });
    const serialized = JSON.stringify(content, null, 2) + '\n';
    await writeFile(configPath, serialized, { mode: 0o600 });
    return { path: configPath, content, generated: true };
  } catch (err) {
    console.warn(
      `[opencode-guard] Failed to write default config to ${configPath}: ${err?.message || err}. ` +
      'Falling back to an ephemeral in-memory salt.'
    );
    return { path: null, content, generated: false, ephemeral: true };
  }
}

/**
 * Warn when the config file holding global_salt is readable by group/others.
 * Skip on win32 where POSIX permission bits are not meaningful.
 *
 * @param {string|null} path - Config file path
 */
async function warnInsecureConfigPermissions(path) {
  if (!path || process.platform === 'win32') return;
  try {
    const st = await stat(path);
    if (st.mode & 0o077) {
      console.warn(
        `[opencode-guard] WARNING: config file ${path} is readable by group/others ` +
        `(mode ${(st.mode & 0o777).toString(8)}) and contains global_salt. ` +
        'Run: chmod 600 ' + path
      );
    }
  } catch {
    // Stat failure must never break config loading
  }
}

/**
 * Filter empty/whitespace-only exclusion entries. An empty entry in
 * exclude_llm_endpoints would otherwise match (and exclude) every endpoint.
 *
 * @param {*} list - Raw config value
 * @param {string} key - Config key name (for the warning)
 * @returns {string[]}
 */
function sanitizeExclusionList(list, key) {
  if (!Array.isArray(list)) return [];
  const clean = [];
  for (const entry of list) {
    const s = String(entry ?? '').trim();
    if (!s) {
      console.warn(`[opencode-guard] ignoring empty/whitespace entry in ${key}`);
      continue;
    }
    clean.push(s);
  }
  return clean;
}

export async function loadConfig(projectRoot) {
  let found = await findConfigFile(projectRoot);

  if (found && found.error) {
    // Fail closed: an existing but malformed config must NOT be silently
    // replaced by a fresh auto-generated one (the user's exclusions and
    // patterns would be lost and a new salt would break determinism).
    console.warn(
      `[opencode-guard] ERROR: config file ${found.path} exists but could not be parsed: ` +
      `${found.error.message}. Plugin DISABLED (fail-closed). Fix or delete the file; ` +
      'a new config is only auto-generated when no config file exists.'
    );
    return {
      enabled: false,
      parseError: true,
      debug: false,
      debugFile: '',
      loadedFrom: found.path,
      globalSalt: '',
      ttlMs: parseDuration('1h'),
      maxMappings: 100000,
      masking: { formatPreserving: true, preserveDomains: true, preservePrefixes: true },
      detection: {
        parallel: true, aiDetection: false, aiProvider: 'local',
        aiTimeoutMs: 2000, autoInstallDeps: false, localModel: '',
      },
      excludeLlmEndpoints: [],
      excludeMcpServers: [],
      excludeMcpTools: DEFAULT_LOCAL_MCP_TOOLS,
      patterns: {},
      customMaskers: {},
    };
  }

  if (!found) {
    found = await generateDefaultConfig();
  }

  const raw = found.content;
  const extra = {};

  if (found.generated !== undefined) extra.generated = found.generated;
  if (found.ephemeral === true) extra.ephemeral = true;

  // OPENCODE_GUARD_SALT overrides the config file salt (highest priority).
  const envSalt = String(process.env.OPENCODE_GUARD_SALT || '').trim();
  const globalSalt = envSalt || String(raw.global_salt || '');

  if (globalSalt) {
    await warnInsecureConfigPermissions(found.path);
  }

  return {
    ...extra,
    enabled: raw.enabled !== false,
    debug: Boolean(raw.debug),
    debugFile: String(process.env.OPENCODE_GUARD_DEBUG_FILE || raw.debug_file || ''),
    loadedFrom: found.path,
    globalSalt,
    ttlMs: parseDuration(raw.session_ttl || '1h'),
    maxMappings: Number(raw.max_mappings || 100000),
    masking: {
      formatPreserving: Boolean(raw.masking?.format_preserving ?? true),
      preserveDomains: Boolean(raw.masking?.preserve_domains ?? true),
      preservePrefixes: Boolean(raw.masking?.preserve_prefixes ?? true),
    },
    detection: {
      parallel: Boolean(raw.detection?.parallel ?? true),
      aiDetection: Boolean(raw.detection?.ai_detection ?? false),
      aiProvider: String(raw.detection?.ai_provider || 'local'),
      aiTimeoutMs: Number(raw.detection?.ai_timeout_ms || 2000),
      autoInstallDeps: Boolean(raw.detection?.auto_install_deps ?? false),
      localModel: String(raw.detection?.local_model || ''),
    },
    excludeLlmEndpoints: sanitizeExclusionList(raw.exclude_llm_endpoints, 'exclude_llm_endpoints'),
    excludeMcpServers: sanitizeExclusionList(raw.exclude_mcp_servers, 'exclude_mcp_servers'),
    excludeMcpTools: Array.isArray(raw.exclude_mcp_tools)
      ? sanitizeExclusionList(raw.exclude_mcp_tools, 'exclude_mcp_tools')
      : DEFAULT_LOCAL_MCP_TOOLS,
    patterns: raw.patterns || {},
    customMaskers: raw.custom_maskers || {},
  };
}

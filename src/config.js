import { readFile, writeFile, mkdir } from 'node:fs/promises';
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

async function findConfigFile(projectRoot) {
  const envPath = process.env.OPENCODE_GUARD_CONFIG;
  if (envPath && existsSync(envPath)) {
    try {
      const content = JSON.parse(await readFile(envPath, 'utf-8'));
      return { path: envPath, content };
    } catch { }
  }

  const locations = [
    join(projectRoot, 'opencode-guard.config.json'),
    join(projectRoot, '.opencode', 'opencode-guard.config.json'),
    join(homedir(), '.config', 'opencode', 'opencode-guard.config.json'),
  ];

  for (const path of locations) {
    if (existsSync(path)) {
      try {
        const content = JSON.parse(await readFile(path, 'utf-8'));
        return { path, content };
      } catch { }
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

export async function loadConfig(projectRoot) {
  let found = await findConfigFile(projectRoot);

  if (!found) {
    found = await generateDefaultConfig();
  }

  const raw = found.content;
  const extra = {};

  if (found.generated !== undefined) extra.generated = found.generated;
  if (found.ephemeral === true) extra.ephemeral = true;

  return {
    ...extra,
    enabled: raw.enabled !== false,
    debug: Boolean(raw.debug),
    debugFile: String(process.env.OPENCODE_GUARD_DEBUG_FILE || raw.debug_file || ''),
    loadedFrom: found.path,
    globalSalt: String(raw.global_salt || ''),
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
      aiTimeoutMs: Number(raw.detection?.ai_timeout_ms || 500),
      autoInstallDeps: Boolean(raw.detection?.auto_install_deps ?? false),
      localModel: String(raw.detection?.local_model || ''),
    },
    excludeLlmEndpoints: Array.isArray(raw.exclude_llm_endpoints) ? raw.exclude_llm_endpoints : [],
    excludeMcpServers: Array.isArray(raw.exclude_mcp_servers) ? raw.exclude_mcp_servers : [],
    excludeMcpTools: Array.isArray(raw.exclude_mcp_tools) ? raw.exclude_mcp_tools : DEFAULT_LOCAL_MCP_TOOLS,
    patterns: raw.patterns || {},
    customMaskers: raw.custom_maskers || {},
  };
}

import { readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { existsSync } from 'node:fs';
import { homedir } from 'node:os';

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

export async function loadConfig(projectRoot) {
  const found = await findConfigFile(projectRoot);
  
  if (!found) {
    return { enabled: false, debug: false, loadedFrom: null };
  }

  const raw = found.content;
  
  return {
    enabled: Boolean(raw.enabled),
    debug: Boolean(raw.debug),
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

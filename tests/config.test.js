import { test } from 'node:test';
import assert from 'node:assert';
import { parseDuration, loadConfig } from '../src/config.js';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { writeFile, unlink } from 'node:fs/promises';
import { tmpdir } from 'node:os';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

test('parseDuration parses duration strings', () => {
  assert.strictEqual(parseDuration('1h'), 3600000);
  assert.strictEqual(parseDuration('30m'), 1800000);
  assert.strictEqual(parseDuration('10s'), 10000);
  assert.strictEqual(parseDuration('5000'), 5000);
  assert.strictEqual(parseDuration(3600000), 3600000);
});

test('parseDuration returns default for invalid input', () => {
  assert.strictEqual(parseDuration('invalid'), 3600000);
  assert.strictEqual(parseDuration(''), 3600000);
});

test('loadConfig returns disabled config when plugin is disabled', async () => {
  const originalEnv = process.env.OPENCODE_GUARD_CONFIG;
  const tempConfig = join(tmpdir(), `opencode-guard-test-${Date.now()}.json`);
  await writeFile(tempConfig, JSON.stringify({ enabled: false }));
  process.env.OPENCODE_GUARD_CONFIG = tempConfig;

  try {
    const config = await loadConfig('/nonexistent/path');
    assert.strictEqual(config.enabled, false);
    assert.strictEqual(config.debug, false);
    assert.strictEqual(config.debugFile, '');
    assert.strictEqual(config.loadedFrom, tempConfig);
  } finally {
    if (originalEnv !== undefined) {
      process.env.OPENCODE_GUARD_CONFIG = originalEnv;
    } else {
      delete process.env.OPENCODE_GUARD_CONFIG;
    }
    await unlink(tempConfig).catch(() => {});
  }
});

test('loadConfig loads config from project root', async () => {
  const projectRoot = join(__dirname, '..');
  const config = await loadConfig(projectRoot);
  assert.strictEqual(typeof config.enabled, 'boolean');
});

test('loadConfig parses all config fields', async () => {
  const mockConfig = {
    enabled: true,
    debug: true,
    global_salt: 'test-salt',
    session_ttl: '30m',
    max_mappings: 50000,
    masking: {
      format_preserving: false,
      preserve_domains: false,
      preserve_prefixes: false,
    },
    detection: {
      parallel: false,
      ai_detection: true,
      ai_provider: 'openai',
      ai_timeout_ms: 1000,
    },
    exclude_llm_endpoints: ['http://localhost:8080'],
    exclude_mcp_servers: ['test-server'],
    patterns: { builtin: ['email'] },
    custom_maskers: { test: { type: 'fixed_length', length: 10 } },
  };
  
  assert.strictEqual(mockConfig.enabled, true);
  assert.strictEqual(mockConfig.global_salt, 'test-salt');
  assert.strictEqual(mockConfig.session_ttl, '30m');
  assert.strictEqual(mockConfig.max_mappings, 50000);
  assert.strictEqual(mockConfig.masking.format_preserving, false);
  assert.strictEqual(mockConfig.detection.ai_detection, true);
  assert.strictEqual(mockConfig.exclude_llm_endpoints.length, 1);
  assert.strictEqual(mockConfig.custom_maskers.test.type, 'fixed_length');
});

test('loadConfig maps debug_file config key to debugFile', async () => {
  const originalEnv = process.env.OPENCODE_GUARD_CONFIG;
  const originalDebugFileEnv = process.env.OPENCODE_GUARD_DEBUG_FILE;
  const tempConfig = join(tmpdir(), `opencode-guard-test-${Date.now()}-debugfile.json`);
  await writeFile(tempConfig, JSON.stringify({ enabled: true, debug: true, debug_file: '/tmp/guard-from-config.log' }));
  process.env.OPENCODE_GUARD_CONFIG = tempConfig;
  delete process.env.OPENCODE_GUARD_DEBUG_FILE;

  try {
    const config = await loadConfig('/nonexistent/path');
    assert.strictEqual(config.debugFile, '/tmp/guard-from-config.log');
  } finally {
    if (originalEnv !== undefined) {
      process.env.OPENCODE_GUARD_CONFIG = originalEnv;
    } else {
      delete process.env.OPENCODE_GUARD_CONFIG;
    }
    if (originalDebugFileEnv !== undefined) {
      process.env.OPENCODE_GUARD_DEBUG_FILE = originalDebugFileEnv;
    } else {
      delete process.env.OPENCODE_GUARD_DEBUG_FILE;
    }
    await unlink(tempConfig).catch(() => {});
  }
});

test('loadConfig maps OPENCODE_GUARD_DEBUG_FILE env var to debugFile (env wins over config)', async () => {
  const originalEnv = process.env.OPENCODE_GUARD_CONFIG;
  const originalDebugFileEnv = process.env.OPENCODE_GUARD_DEBUG_FILE;
  const tempConfig = join(tmpdir(), `opencode-guard-test-${Date.now()}-debugfile-env.json`);
  await writeFile(tempConfig, JSON.stringify({ enabled: true, debug_file: '/tmp/guard-from-config.log' }));
  process.env.OPENCODE_GUARD_CONFIG = tempConfig;
  process.env.OPENCODE_GUARD_DEBUG_FILE = '/tmp/guard-from-env.log';

  try {
    const config = await loadConfig('/nonexistent/path');
    assert.strictEqual(config.debugFile, '/tmp/guard-from-env.log');
  } finally {
    if (originalEnv !== undefined) {
      process.env.OPENCODE_GUARD_CONFIG = originalEnv;
    } else {
      delete process.env.OPENCODE_GUARD_CONFIG;
    }
    if (originalDebugFileEnv !== undefined) {
      process.env.OPENCODE_GUARD_DEBUG_FILE = originalDebugFileEnv;
    } else {
      delete process.env.OPENCODE_GUARD_DEBUG_FILE;
    }
    await unlink(tempConfig).catch(() => {});
  }
});

test('loadConfig defaults debugFile to empty string', async () => {
  const originalEnv = process.env.OPENCODE_GUARD_CONFIG;
  const originalDebugFileEnv = process.env.OPENCODE_GUARD_DEBUG_FILE;
  const tempConfig = join(tmpdir(), `opencode-guard-test-${Date.now()}-nodebugfile.json`);
  await writeFile(tempConfig, JSON.stringify({ enabled: true }));
  process.env.OPENCODE_GUARD_CONFIG = tempConfig;
  delete process.env.OPENCODE_GUARD_DEBUG_FILE;

  try {
    const config = await loadConfig('/nonexistent/path');
    assert.strictEqual(config.debugFile, '');
  } finally {
    if (originalEnv !== undefined) {
      process.env.OPENCODE_GUARD_CONFIG = originalEnv;
    } else {
      delete process.env.OPENCODE_GUARD_CONFIG;
    }
    if (originalDebugFileEnv !== undefined) {
      process.env.OPENCODE_GUARD_DEBUG_FILE = originalDebugFileEnv;
    } else {
      delete process.env.OPENCODE_GUARD_DEBUG_FILE;
    }
    await unlink(tempConfig).catch(() => {});
  }
});

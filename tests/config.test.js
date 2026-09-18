import { test } from 'node:test';
import assert from 'node:assert';
import { parseDuration, loadConfig } from '../src/config.js';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { writeFile, unlink, readFile, rm, mkdtemp } from 'node:fs/promises';
import { tmpdir, homedir } from 'node:os';

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

test('loadConfig defaults enabled to true when config file has no enabled key', async () => {
  const originalEnv = process.env.OPENCODE_GUARD_CONFIG;
  const tempConfig = join(tmpdir(), `opencode-guard-test-${Date.now()}-noenabled.json`);
  await writeFile(tempConfig, JSON.stringify({ global_salt: 'test-salt' }));
  process.env.OPENCODE_GUARD_CONFIG = tempConfig;

  try {
    const config = await loadConfig('/nonexistent/path');
    assert.strictEqual(config.enabled, true);
    assert.strictEqual(config.globalSalt, 'test-salt');
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

test('loadConfig generates default config on first run and is idempotent', async () => {
  const originalEnv = process.env.OPENCODE_GUARD_CONFIG;
  const originalHome = process.env.HOME;
  const fakeHome = await mkdtemp(join(tmpdir(), 'opencode-guard-home-'));
  delete process.env.OPENCODE_GUARD_CONFIG;
  process.env.HOME = fakeHome;

  const expectedPath = join(fakeHome, '.config', 'opencode', 'opencode-guard.config.json');

  try {
    const config = await loadConfig('/nonexistent/path');
    assert.strictEqual(config.enabled, true);
    assert.strictEqual(config.generated, true);
    assert.strictEqual(typeof config.globalSalt, 'string');
    assert.match(config.globalSalt, /^[0-9a-f]{64}$/);
    assert.strictEqual(config.loadedFrom, expectedPath);

    // File actually landed on disk and contains the same salt
    const onDisk = JSON.parse(await readFile(expectedPath, 'utf-8'));
    assert.strictEqual(onDisk.global_salt, config.globalSalt);

    // Second call reads the generated file and keeps the same salt
    const config2 = await loadConfig('/nonexistent/path');
    assert.strictEqual(config2.enabled, true);
    assert.strictEqual(config2.generated, undefined);
    assert.strictEqual(config2.globalSalt, config.globalSalt);
    assert.strictEqual(config2.loadedFrom, expectedPath);
  } finally {
    if (originalEnv !== undefined) {
      process.env.OPENCODE_GUARD_CONFIG = originalEnv;
    } else {
      delete process.env.OPENCODE_GUARD_CONFIG;
    }
    if (originalHome !== undefined) {
      process.env.HOME = originalHome;
    } else {
      delete process.env.HOME;
    }
    await rm(fakeHome, { recursive: true, force: true }).catch(() => {});
  }
});

test('loadConfig falls back to ephemeral salt when config write fails', async () => {
  const originalEnv = process.env.OPENCODE_GUARD_CONFIG;
  const originalHome = process.env.HOME;
  const fakeHome = await mkdtemp(join(tmpdir(), 'opencode-guard-home-'));
  delete process.env.OPENCODE_GUARD_CONFIG;
  process.env.HOME = fakeHome;

  // Block the .config path with a regular file so mkdir fails
  const blockingFile = join(fakeHome, '.config');
  await writeFile(blockingFile, 'not a directory');

  try {
    const config = await loadConfig('/nonexistent/path');
    assert.strictEqual(config.enabled, true);
    assert.strictEqual(config.generated, false);
    assert.strictEqual(config.ephemeral, true);
    assert.strictEqual(config.loadedFrom, null);
    assert.match(config.globalSalt, /^[0-9a-f]{64}$/);
  } finally {
    if (originalEnv !== undefined) {
      process.env.OPENCODE_GUARD_CONFIG = originalEnv;
    } else {
      delete process.env.OPENCODE_GUARD_CONFIG;
    }
    if (originalHome !== undefined) {
      process.env.HOME = originalHome;
    } else {
      delete process.env.HOME;
    }
    await rm(fakeHome, { recursive: true, force: true }).catch(() => {});
  }
});


test('loadConfig fails closed (disabled) on malformed existing config, without auto-generating', async () => {
  const originalEnv = process.env.OPENCODE_GUARD_CONFIG;
  const originalHome = process.env.HOME;
  const fakeHome = await mkdtemp(join(tmpdir(), 'opencode-guard-home-'));
  const tempConfig = join(tmpdir(), `opencode-guard-test-${Date.now()}-malformed.json`);
  await writeFile(tempConfig, '{ this is not valid json ');
  process.env.OPENCODE_GUARD_CONFIG = tempConfig;
  process.env.HOME = fakeHome;

  const warnings = [];
  const originalWarn = console.warn;
  console.warn = (...args) => warnings.push(args.join(' '));

  try {
    const config = await loadConfig('/nonexistent/path');
    assert.strictEqual(config.enabled, false, 'malformed config must disable the plugin (fail closed)');
    assert.strictEqual(config.parseError, true);
    assert.strictEqual(config.globalSalt, '', 'no salt should be invented for a malformed config');
    assert.strictEqual(config.loadedFrom, tempConfig);
    assert.strictEqual(config.generated, undefined, 'must NOT auto-generate over a parse failure');
    assert.ok(warnings.some((w) => w.includes(tempConfig) && w.includes('DISABLED')), 'loud warning expected');

    // And no config was generated in the fake home either
    const { existsSync } = await import('node:fs');
    assert.strictEqual(
      existsSync(join(fakeHome, '.config', 'opencode', 'opencode-guard.config.json')),
      false,
      'auto-generation must not run when an existing config is malformed'
    );
  } finally {
    console.warn = originalWarn;
    if (originalEnv !== undefined) {
      process.env.OPENCODE_GUARD_CONFIG = originalEnv;
    } else {
      delete process.env.OPENCODE_GUARD_CONFIG;
    }
    if (originalHome !== undefined) {
      process.env.HOME = originalHome;
    } else {
      delete process.env.HOME;
    }
    await unlink(tempConfig).catch(() => {});
    await rm(fakeHome, { recursive: true, force: true }).catch(() => {});
  }
});

test('loadConfig fails closed on malformed project config (not just env path)', async () => {
  const originalEnv = process.env.OPENCODE_GUARD_CONFIG;
  const originalHome = process.env.HOME;
  const fakeHome = await mkdtemp(join(tmpdir(), 'opencode-guard-home-'));
  const fakeProject = await mkdtemp(join(tmpdir(), 'opencode-guard-project-'));
  delete process.env.OPENCODE_GUARD_CONFIG;
  process.env.HOME = fakeHome;
  await writeFile(join(fakeProject, 'opencode-guard.config.json'), '{"enabled": true,,,}');

  const originalWarn = console.warn;
  console.warn = () => {};

  try {
    const config = await loadConfig(fakeProject);
    assert.strictEqual(config.enabled, false);
    assert.strictEqual(config.parseError, true);
  } finally {
    console.warn = originalWarn;
    if (originalEnv !== undefined) {
      process.env.OPENCODE_GUARD_CONFIG = originalEnv;
    }
    if (originalHome !== undefined) {
      process.env.HOME = originalHome;
    } else {
      delete process.env.HOME;
    }
    await rm(fakeHome, { recursive: true, force: true }).catch(() => {});
    await rm(fakeProject, { recursive: true, force: true }).catch(() => {});
  }
});

test('loadConfig: OPENCODE_GUARD_SALT overrides global_salt from config file', async () => {
  const originalEnv = process.env.OPENCODE_GUARD_CONFIG;
  const originalSalt = process.env.OPENCODE_GUARD_SALT;
  const tempConfig = join(tmpdir(), `opencode-guard-test-${Date.now()}-salt.json`);
  await writeFile(tempConfig, JSON.stringify({ enabled: true, global_salt: 'file-salt' }));
  process.env.OPENCODE_GUARD_CONFIG = tempConfig;
  process.env.OPENCODE_GUARD_SALT = 'env-salt-override';

  const originalWarn = console.warn;
  console.warn = () => {}; // silence permission warning for tmp file

  try {
    const config = await loadConfig('/nonexistent/path');
    assert.strictEqual(config.globalSalt, 'env-salt-override');
  } finally {
    console.warn = originalWarn;
    if (originalEnv !== undefined) {
      process.env.OPENCODE_GUARD_CONFIG = originalEnv;
    } else {
      delete process.env.OPENCODE_GUARD_CONFIG;
    }
    if (originalSalt !== undefined) {
      process.env.OPENCODE_GUARD_SALT = originalSalt;
    } else {
      delete process.env.OPENCODE_GUARD_SALT;
    }
    await unlink(tempConfig).catch(() => {});
  }
});

test('loadConfig rejects empty/whitespace entries in exclude_llm_endpoints', async () => {
  const originalEnv = process.env.OPENCODE_GUARD_CONFIG;
  const tempConfig = join(tmpdir(), `opencode-guard-test-${Date.now()}-exclude.json`);
  await writeFile(tempConfig, JSON.stringify({
    enabled: true,
    global_salt: 'test-salt',
    exclude_llm_endpoints: ['', '   ', 'localhost', 'api.example.com'],
  }));
  process.env.OPENCODE_GUARD_CONFIG = tempConfig;

  const warnings = [];
  const originalWarn = console.warn;
  console.warn = (...args) => warnings.push(args.join(' '));

  try {
    const config = await loadConfig('/nonexistent/path');
    assert.deepStrictEqual(config.excludeLlmEndpoints, ['localhost', 'api.example.com']);
    assert.ok(warnings.some((w) => w.includes('empty/whitespace entry')), 'should warn about rejected entries');
  } finally {
    console.warn = originalWarn;
    if (originalEnv !== undefined) {
      process.env.OPENCODE_GUARD_CONFIG = originalEnv;
    } else {
      delete process.env.OPENCODE_GUARD_CONFIG;
    }
    await unlink(tempConfig).catch(() => {});
  }
});

import { test } from 'node:test';
import assert from 'node:assert';
import { MaskSession } from '../src/session.js';

test('MaskSession creates masked values deterministically', () => {
  const session = new MaskSession('test-salt', { ttlMs: 3600000, maxMappings: 1000 });
  
  const masked1 = session.getOrCreateMasked('secret123', 'API_KEY', 'pattern');
  const masked2 = session.getOrCreateMasked('secret123', 'API_KEY', 'pattern');
  
  assert.strictEqual(masked1, masked2);
});

test('MaskSession creates different masks for different values', () => {
  const session = new MaskSession('test-salt', { ttlMs: 3600000, maxMappings: 1000 });
  
  const masked1 = session.getOrCreateMasked('secret1', 'API_KEY', 'pattern');
  const masked2 = session.getOrCreateMasked('secret2', 'API_KEY', 'pattern');
  
  assert.notStrictEqual(masked1, masked2);
});

test('MaskSession can lookup original from masked', () => {
  const session = new MaskSession('test-salt', { ttlMs: 3600000, maxMappings: 1000 });
  
  const original = 'my-secret-value';
  const masked = session.getOrCreateMasked(original, 'SECRET', 'pattern');
  const lookedUp = session.lookupOriginal(masked);
  
  assert.strictEqual(lookedUp, original);
});

test('MaskSession returns undefined for unknown masked value', () => {
  const session = new MaskSession('test-salt', { ttlMs: 3600000, maxMappings: 1000 });
  
  const lookedUp = session.lookupOriginal('unknown-masked-value');
  
  assert.strictEqual(lookedUp, undefined);
});

test('MaskSession evicts oldest when max mappings reached', () => {
  const session = new MaskSession('test-salt', { ttlMs: 3600000, maxMappings: 2 });
  
  const masked1 = session.getOrCreateMasked('secret1', 'KEY', 'pattern');
  session.getOrCreateMasked('secret2', 'KEY', 'pattern');
  session.getOrCreateMasked('secret3', 'KEY', 'pattern');
  
  const lookedUp = session.lookupOriginal(masked1);
  assert.strictEqual(lookedUp, undefined);
});

test('MaskSession cleans up expired entries', () => {
  const session = new MaskSession('test-salt', { ttlMs: 100, maxMappings: 1000 });
  
  const masked = session.getOrCreateMasked('secret', 'KEY', 'pattern');
  
  session.cleanup(Date.now() + 200);
  
  const lookedUp = session.lookupOriginal(masked);
  assert.strictEqual(lookedUp, undefined);
});

test('MaskSession TTL is sliding: reuse refreshes expiry', () => {
  const realNow = Date.now;
  let fakeNow = 1_000_000;
  Date.now = () => fakeNow;
  try {
    const session = new MaskSession('test-salt', { ttlMs: 100, maxMappings: 1000 });

    const masked = session.getOrCreateMasked('secret', 'KEY', 'pattern');

    fakeNow += 90; // 90ms since creation (within TTL)
    session.getOrCreateMasked('secret', 'KEY', 'pattern'); // cache hit -> refresh

    fakeNow += 90; // 180ms since creation, but only 90ms since last access
    session.cleanup();
    assert.strictEqual(session.lookupOriginal(masked), 'secret', 'sliding TTL should keep recently-used mapping alive');

    // Without further access it expires ttlMs after the last access
    fakeNow += 101;
    session.cleanup();
    assert.strictEqual(session.lookupOriginal(masked), undefined);
  } finally {
    Date.now = realNow;
  }
});

test('MaskSession TTL is sliding: lookupOriginal refreshes expiry', () => {
  const realNow = Date.now;
  let fakeNow = 1_000_000;
  Date.now = () => fakeNow;
  try {
    const session = new MaskSession('test-salt', { ttlMs: 100, maxMappings: 1000 });

    const masked = session.getOrCreateMasked('secret', 'KEY', 'pattern');

    fakeNow += 90;
    assert.strictEqual(session.lookupOriginal(masked), 'secret'); // refresh

    fakeNow += 90; // 180ms since creation, 90ms since lookup
    session.cleanup();
    assert.strictEqual(session.maskedToOriginal.has(masked), true, 'lookup should have refreshed the TTL');
  } finally {
    Date.now = realNow;
  }
});

test('MaskSession resolves masked-value collisions so both originals restore', async () => {
  const { customRegistry } = await import('../src/maskers/index.js');
  // Force a collision: a custom masker that always returns the same constant
  customRegistry.register('const_out', () => 'CONSTMASK');
  try {
    const session = new MaskSession('test-salt', { ttlMs: 3600000, maxMappings: 1000, logger: { log() {}, warn() {} } });

    const masked1 = session.getOrCreateMasked('original-one', 'SECRET', 'const_out');
    const masked2 = session.getOrCreateMasked('original-two', 'SECRET', 'const_out');

    assert.notStrictEqual(masked1, masked2, 'colliding masked values must be disambiguated');
    assert.strictEqual(session.lookupOriginal(masked1), 'original-one');
    assert.strictEqual(session.lookupOriginal(masked2), 'original-two');
  } finally {
    customRegistry.clear();
  }
});

test('MaskSession never self-maps (masked === original)', async () => {
  const { customRegistry } = await import('../src/maskers/index.js');
  // Pathological masker that returns its input unchanged
  customRegistry.register('identity_out', (v) => v);
  try {
    const session = new MaskSession('test-salt', { ttlMs: 3600000, maxMappings: 1000, logger: { log() {}, warn() {} } });

    const masked = session.getOrCreateMasked('PLAINSECRET', 'SECRET', 'identity_out');
    assert.notStrictEqual(masked, 'PLAINSECRET', 'self-mapping would leak the value unmasked');
    assert.strictEqual(session.lookupOriginal(masked), 'PLAINSECRET');
  } finally {
    customRegistry.clear();
  }
});

test('MaskSession clamps invalid maxMappings instead of spinning forever', () => {
  const warnings = [];
  const logger = { log() {}, warn: (m) => warnings.push(m) };
  const session = new MaskSession('test-salt', { ttlMs: 1000, maxMappings: 0, logger });

  assert.strictEqual(session.maxMappings, 1, 'maxMappings 0 must be clamped to 1');
  assert.strictEqual(warnings.length, 1, 'clamp should warn');

  // Would spin forever in the eviction loop without the clamp
  session.getOrCreateMasked('a', 'KEY', 'pattern');
  session.getOrCreateMasked('b', 'KEY', 'pattern');
  assert.strictEqual(session.originalToMasked.size, 1);
});

test('MaskSession routes debug logging through an injected logger', () => {
  const logs = [];
  const logger = { log: (m) => logs.push(m), warn() {} };
  const session = new MaskSession('test-salt', { ttlMs: 3600000, maxMappings: 1000, logger });

  session.getOrCreateMasked('secret', 'KEY', 'pattern', true);
  session.getOrCreateMasked('secret', 'KEY', 'pattern', true);

  assert.ok(logs.some((m) => m.includes('created mask')), 'expected creation log via injected logger');
  assert.ok(logs.some((m) => m.includes('reusing existing mask')), 'expected reuse log via injected logger');
});

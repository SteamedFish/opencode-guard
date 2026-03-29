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

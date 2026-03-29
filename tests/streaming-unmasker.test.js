import { test } from 'node:test';
import assert from 'node:assert';
import { MaskSession } from '../src/session.js';
import { StreamingUnmasker } from '../src/streaming-unmasker.js';

test('StreamingUnmasker handles complete masked value in single chunk', () => {
  const session = new MaskSession('test-salt', { ttlMs: 3600000, maxMappings: 1000 });
  session.originalToMasked.set('secret123', 'msk-abc123def4567890');
  session.maskedToOriginal.set('msk-abc123def4567890', 'secret123');
  
  const unmasker = new StreamingUnmasker(session);
  const result = unmasker.transform('Your token is msk-abc123def4567890');
  
  assert.strictEqual(result, 'Your token is secret123');
  assert.strictEqual(unmasker.flush(), '');
});

test('StreamingUnmasker handles masked value split across chunks', () => {
  const session = new MaskSession('test-salt', { ttlMs: 3600000, maxMappings: 1000 });
  session.originalToMasked.set('secret123', 'msk-abc123def4567890');
  session.maskedToOriginal.set('msk-abc123def4567890', 'secret123');
  
  const unmasker = new StreamingUnmasker(session);
  
  const chunk1 = unmasker.transform('Your token is msk-abc123');
  assert.strictEqual(chunk1, 'Your token is ');
  
  const chunk2 = unmasker.transform('def4567890 and more');
  assert.strictEqual(chunk2, 'secret123 and more');
  
  assert.strictEqual(unmasker.flush(), '');
});

test('StreamingUnmasker handles multiple masked values in one chunk', () => {
  const session = new MaskSession('test-salt', { ttlMs: 3600000, maxMappings: 1000 });
  session.originalToMasked.set('secret1', 'msk-abc123def4567890');
  session.originalToMasked.set('secret2', 'msk-xyz789uvw4561234');
  session.maskedToOriginal.set('msk-abc123def4567890', 'secret1');
  session.maskedToOriginal.set('msk-xyz789uvw4561234', 'secret2');
  
  const unmasker = new StreamingUnmasker(session);
  const result = unmasker.transform('Token1: msk-abc123def4567890, Token2: msk-xyz789uvw4561234');
  
  assert.strictEqual(result, 'Token1: secret1, Token2: secret2');
  assert.strictEqual(unmasker.flush(), '');
});

test('StreamingUnmasker flushes remaining buffer on end', () => {
  const session = new MaskSession('test-salt', { ttlMs: 3600000, maxMappings: 1000 });
  session.originalToMasked.set('secret123', 'msk-abc123def4567890');
  session.maskedToOriginal.set('msk-abc123def4567890', 'secret123');
  
  const unmasker = new StreamingUnmasker(session);
  const result = unmasker.transform('Your token is msk-abc123def4567890');
  
  assert.ok(result.includes('secret123'));
  const final = unmasker.flush();
  assert.strictEqual(final, '');
});

test('StreamingUnmasker throws when transforming after close', () => {
  const session = new MaskSession('test-salt', { ttlMs: 3600000, maxMappings: 1000 });
  const unmasker = new StreamingUnmasker(session);
  unmasker.flush();
  
  assert.throws(() => {
    unmasker.transform('test');
  }, /already closed/);
});

import { test } from 'node:test';
import assert from 'node:assert';
import { MaskSession } from '../src/session.js';
import { StreamingUnmasker } from '../src/streaming-unmasker.js';

test('StreamingUnmasker handles complete GitHub token in single chunk', () => {
  const session = new MaskSession('test-salt', { ttlMs: 3600000, maxMappings: 1000 });
  session.originalToMasked.set('mysecrettoken', 'ghp_abc123def4567890');
  session.maskedToOriginal.set('ghp_abc123def4567890', 'mysecrettoken');
  
  const unmasker = new StreamingUnmasker(session);
  const result = unmasker.transform('Your token is ghp_abc123def4567890');
  
  assert.strictEqual(result, 'Your token is mysecrettoken');
  assert.strictEqual(unmasker.flush(), '');
});

test('StreamingUnmasker handles GitHub token split across chunks', () => {
  const session = new MaskSession('test-salt', { ttlMs: 3600000, maxMappings: 1000 });
  session.originalToMasked.set('mysecrettoken', 'ghp_abc123def4567890');
  session.maskedToOriginal.set('ghp_abc123def4567890', 'mysecrettoken');
  
  const unmasker = new StreamingUnmasker(session);
  
  const chunk1 = unmasker.transform('Your token is ghp_abc123');
  assert.strictEqual(chunk1, 'Your token is ');
  
  const chunk2 = unmasker.transform('def4567890 and more');
  assert.strictEqual(chunk2, 'mysecrettoken and more');
  
  assert.strictEqual(unmasker.flush(), '');
});

test('StreamingUnmasker handles multiple GitHub tokens in one chunk', () => {
  const session = new MaskSession('test-salt', { ttlMs: 3600000, maxMappings: 1000 });
  session.originalToMasked.set('secrettoken1', 'ghp_abc123def4567890');
  session.originalToMasked.set('secrettoken2', 'ghp_xyz789uvw4561234');
  session.maskedToOriginal.set('ghp_abc123def4567890', 'secrettoken1');
  session.maskedToOriginal.set('ghp_xyz789uvw4561234', 'secrettoken2');
  
  const unmasker = new StreamingUnmasker(session);
  const result = unmasker.transform('Token1: ghp_abc123def4567890, Token2: ghp_xyz789uvw4561234');
  
  assert.strictEqual(result, 'Token1: secrettoken1, Token2: secrettoken2');
  assert.strictEqual(unmasker.flush(), '');
});

test('StreamingUnmasker flushes remaining buffer on end', () => {
  const session = new MaskSession('test-salt', { ttlMs: 3600000, maxMappings: 1000 });
  session.originalToMasked.set('mysecrettoken', 'ghp_abc123def4567890');
  session.maskedToOriginal.set('ghp_abc123def4567890', 'mysecrettoken');
  
  const unmasker = new StreamingUnmasker(session);
  const result = unmasker.transform('Your token is ghp_abc123def4567890');
  
  assert.ok(result.includes('mysecrettoken'));
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

test('StreamingUnmasker handles OpenAI sk- token format', () => {
  const session = new MaskSession('test-salt', { ttlMs: 3600000, maxMappings: 1000 });
  session.originalToMasked.set('sk-original-key', 'sk-AbCdEfGhIjKlMnOpQrStUvWxYz123456');
  session.maskedToOriginal.set('sk-AbCdEfGhIjKlMnOpQrStUvWxYz123456', 'sk-original-key');
  
  const unmasker = new StreamingUnmasker(session);
  const result = unmasker.transform('API key: sk-AbCdEfGhIjKlMnOpQrStUvWxYz123456');
  
  assert.strictEqual(result, 'API key: sk-original-key');
  assert.strictEqual(unmasker.flush(), '');
});

test('StreamingUnmasker handles email address format', () => {
  const session = new MaskSession('test-salt', { ttlMs: 3600000, maxMappings: 1000 });
  session.originalToMasked.set('real@email.com', 'a3f7@example.com');
  session.maskedToOriginal.set('a3f7@example.com', 'real@email.com');
  
  const unmasker = new StreamingUnmasker(session);
  const result = unmasker.transform('Contact: a3f7@example.com for details');
  
  assert.strictEqual(result, 'Contact: real@email.com for details');
  assert.strictEqual(unmasker.flush(), '');
});

test('StreamingUnmasker handles AWS key format', () => {
  const session = new MaskSession('test-salt', { ttlMs: 3600000, maxMappings: 1000 });
  session.originalToMasked.set('real-aws-secret', 'AKIAIOSFODNN7EXAMPLE');
  session.maskedToOriginal.set('AKIAIOSFODNN7EXAMPLE', 'real-aws-secret');
  
  const unmasker = new StreamingUnmasker(session);
  const result = unmasker.transform('AWS Access Key: AKIAIOSFODNN7EXAMPLE');
  
  assert.strictEqual(result, 'AWS Access Key: real-aws-secret');
  assert.strictEqual(unmasker.flush(), '');
});

test('StreamingUnmasker handles mixed token types', () => {
  const session = new MaskSession('test-salt', { ttlMs: 3600000, maxMappings: 1000 });
  session.originalToMasked.set('gh-token', 'ghp_abc123xyz789');
  session.originalToMasked.set('openai-key', 'sk-TestKey123456');
  session.maskedToOriginal.set('ghp_abc123xyz789', 'gh-token');
  session.maskedToOriginal.set('sk-TestKey123456', 'openai-key');
  
  const unmasker = new StreamingUnmasker(session);
  const result = unmasker.transform('GitHub: ghp_abc123xyz789, OpenAI: sk-TestKey123456');
  
  assert.strictEqual(result, 'GitHub: gh-token, OpenAI: openai-key');
  assert.strictEqual(unmasker.flush(), '');
});

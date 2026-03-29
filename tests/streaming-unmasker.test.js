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
  session.originalToMasked.set('aiaj@email.com', 't9v5@example.com');
  session.maskedToOriginal.set('t9v5@example.com', 'aiaj@email.com');

  const unmasker = new StreamingUnmasker(session);
  const result = unmasker.transform('Contact: t9v5@example.com for details');

  assert.strictEqual(result, 'Contact: aiaj@email.com for details');
  assert.strictEqual(unmasker.flush(), '');
});

test('StreamingUnmasker handles email split across chunks', () => {
  const session = new MaskSession('test-salt', { ttlMs: 3600000, maxMappings: 1000 });
  session.originalToMasked.set('user@example.com', 'abcd@example.com');
  session.maskedToOriginal.set('abcd@example.com', 'user@example.com');

  const unmasker = new StreamingUnmasker(session);

  const chunk1 = unmasker.transform('Email: abcd@exa');
  assert.strictEqual(chunk1, 'Email: ');

  const chunk2 = unmasker.transform('mple.com for contact');
  assert.strictEqual(chunk2, 'user@example.com for contact');

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

test('StreamingUnmasker handles IPv4 address split across chunks', () => {
  const session = new MaskSession('test-salt', { ttlMs: 3600000, maxMappings: 1000 });
  const maskedIP = '192.168.255.232';
  const originalIP = '192.168.1.100';
  session.originalToMasked.set(originalIP, maskedIP);
  session.maskedToOriginal.set(maskedIP, originalIP);

  const unmasker = new StreamingUnmasker(session);

  const chunk1 = unmasker.transform('Server at 192.168.');
  assert.strictEqual(chunk1, 'Server at ');

  const chunk2 = unmasker.transform('255.232 is online');
  assert.strictEqual(chunk2, `${originalIP} is online`);

  assert.strictEqual(unmasker.flush(), '');
});

test('StreamingUnmasker handles multiple tokens split across chunks', () => {
  const session = new MaskSession('test-salt', { ttlMs: 3600000, maxMappings: 1000 });
  session.originalToMasked.set('secret-token-1', 'ghp_111111111111');
  session.originalToMasked.set('secret-token-2', 'ghp_222222222222');
  session.maskedToOriginal.set('ghp_111111111111', 'secret-token-1');
  session.maskedToOriginal.set('ghp_222222222222', 'secret-token-2');

  const unmasker = new StreamingUnmasker(session);

  const chunk1 = unmasker.transform('First: ghp_111');
  assert.strictEqual(chunk1, 'First: ');

  const chunk2 = unmasker.transform('111111111, Second: ');
  assert.strictEqual(chunk2, 'secret-token-1, Second: ');

  const chunk3 = unmasker.transform('ghp_222222222222 done');
  assert.strictEqual(chunk3, 'secret-token-2 done');

  assert.strictEqual(unmasker.flush(), '');
});

test('StreamingUnmasker handles empty chunks', () => {
  const session = new MaskSession('test-salt', { ttlMs: 3600000, maxMappings: 1000 });
  session.originalToMasked.set('mytoken', 'ghp_abc123def456');
  session.maskedToOriginal.set('ghp_abc123def456', 'mytoken');

  const unmasker = new StreamingUnmasker(session);

  const chunk1 = unmasker.transform('');
  assert.strictEqual(chunk1, '');

  const chunk2 = unmasker.transform('Token: ghp_abc123def456');
  assert.strictEqual(chunk2, 'Token: mytoken');

  const chunk3 = unmasker.transform('');
  assert.strictEqual(chunk3, '');

  assert.strictEqual(unmasker.flush(), '');
});

test('StreamingUnmasker handles text without any masked values', () => {
  const session = new MaskSession('test-salt', { ttlMs: 3600000, maxMappings: 1000 });

  const unmasker = new StreamingUnmasker(session);

  const chunk1 = unmasker.transform('Hello, this is ');
  assert.strictEqual(chunk1, 'Hello, this is ');

  const chunk2 = unmasker.transform('just regular text');
  assert.strictEqual(chunk2, 'just regular text');

  assert.strictEqual(unmasker.flush(), '');
});

test('StreamingUnmasker handles token at very beginning of chunk', () => {
  const session = new MaskSession('test-salt', { ttlMs: 3600000, maxMappings: 1000 });
  session.originalToMasked.set('secrettoken', 'ghp_xxxxxxxxxxxx');
  session.maskedToOriginal.set('ghp_xxxxxxxxxxxx', 'secrettoken');

  const unmasker = new StreamingUnmasker(session);

  const chunk1 = unmasker.transform('Start: ghp_');
  assert.strictEqual(chunk1, 'Start: ');

  const chunk2 = unmasker.transform('xxxxxxxxxxxx end');
  assert.strictEqual(chunk2, 'secrettoken end');

  assert.strictEqual(unmasker.flush(), '');
});

test('StreamingUnmasker handles token at very end of chunk', () => {
  const session = new MaskSession('test-salt', { ttlMs: 3600000, maxMappings: 1000 });
  session.originalToMasked.set('secrettoken', 'ghp_xxxxxxxxxxxx');
  session.maskedToOriginal.set('ghp_xxxxxxxxxxxx', 'secrettoken');

  const unmasker = new StreamingUnmasker(session);

  const chunk1 = unmasker.transform('Prefix ghp_xxxx');
  assert.strictEqual(chunk1, 'Prefix ');

  const chunk2 = unmasker.transform('xxxxxxxx more text');
  assert.strictEqual(chunk2, 'secrettoken more text');

  assert.strictEqual(unmasker.flush(), '');
});

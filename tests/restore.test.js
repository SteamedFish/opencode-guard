import { restoreText, restoreDeep } from '../src/restore.js';
import { MaskSession } from '../src/session.js';
import { test } from 'node:test';
import assert from 'node:assert';

const globalSalt = 'test-salt';

function createTestSession() {
  return new MaskSession(globalSalt, { ttlMs: 3600000, maxMappings: 1000 });
}

test('restoreText restores masked values', () => {
  const session = createTestSession();
  const original = 'secret123';
  const masked = session.getOrCreateMasked(original, 'SECRET', 'pattern');
  
  const text = `The value is ${masked}`;
  const restored = restoreText(text, session);
  
  assert.ok(restored.includes('secret123'));
  assert.ok(!restored.includes(masked));
});

test('restoreText returns original text when no masked values', () => {
  const session = createTestSession();
  const text = 'No masked values here';
  const restored = restoreText(text, session);
  
  assert.strictEqual(restored, text);
});

test('restoreText handles empty string', () => {
  const session = createTestSession();
  const restored = restoreText('', session);
  
  assert.strictEqual(restored, '');
});

test('restoreDeep restores nested objects', () => {
  const session = createTestSession();
  const original1 = session.getOrCreateMasked('secret1', 'SECRET', 'pattern');
  const original2 = session.getOrCreateMasked('secret2', 'SECRET', 'pattern');
  
  const obj = {
    value1: original1,
    nested: {
      value2: original2,
    },
  };
  
  session.originalToMasked.set('secret1', original1);
  session.maskedToOriginal.set(original1, 'secret1');
  session.originalToMasked.set('secret2', original2);
  session.maskedToOriginal.set(original2, 'secret2');
  
  restoreDeep(obj, session);
  assert.strictEqual(obj.value1, 'secret1');
  assert.strictEqual(obj.nested.value2, 'secret2');
});

test('restoreDeep restores arrays', () => {
  const session = createTestSession();
  const original1 = session.getOrCreateMasked('secret1', 'SECRET', 'pattern');
  const original2 = session.getOrCreateMasked('secret2', 'SECRET', 'pattern');
  
  session.originalToMasked.set('secret1', original1);
  session.maskedToOriginal.set(original1, 'secret1');
  session.originalToMasked.set('secret2', original2);
  session.maskedToOriginal.set(original2, 'secret2');
  
  const arr = [original1, 'regular', original2];
  restoreDeep(arr, session);
  
  assert.strictEqual(arr[0], 'secret1');
  assert.strictEqual(arr[1], 'regular');
  assert.strictEqual(arr[2], 'secret2');
});

test('restoreDeep handles null and undefined', () => {
  const session = createTestSession();

  assert.strictEqual(restoreDeep(null, session), null);
  assert.strictEqual(restoreDeep(undefined, session), undefined);
});

test('restoreText restores masked email addresses', () => {
  const session = createTestSession();
  const original = 'test@example.com';
  const masked = session.getOrCreateMasked(original, 'EMAIL', 'email');

  const text = `Your email is ${masked}`;
  const restored = restoreText(text, session);

  assert.ok(restored.includes('test@example.com'), `Expected "test@example.com" but got "${restored}"`);
  assert.ok(!restored.includes(masked), `Should not contain masked value "${masked}"`);
});

test('restoreText restores tokens with special characters', () => {
  const session = createTestSession();
  const original = 'sk-abc123xyz';
  const masked = session.getOrCreateMasked(original, 'TOKEN', 'sk_token');

  const text = `API key: ${masked}`;
  const restored = restoreText(text, session);

  assert.ok(restored.includes('sk-abc123xyz'), `Expected "sk-abc123xyz" but got "${restored}"`);
  assert.ok(!restored.includes(masked), `Should not contain masked value "${masked}"`);
});

test('restoreText restores IPv4 addresses', () => {
  const session = createTestSession();
  const original = '192.168.1.100';
  const masked = session.getOrCreateMasked(original, 'IPV4', 'ip');

  const text = `Server at ${masked}`;
  const restored = restoreText(text, session);

  assert.ok(restored.includes('192.168.1.100'), `Expected "192.168.1.100" but got "${restored}"`);
  assert.ok(!restored.includes(masked), `Should not contain masked value "${masked}"`);
});

test('restoreText only restores exact masked values, not substrings', () => {
  const session = createTestSession();
  const original = 'secret123';
  const masked = session.getOrCreateMasked(original, 'SECRET', 'pattern');

  const textWithMasked = `Value: ${masked}`;
  const restored1 = restoreText(textWithMasked, session);
  assert.ok(restored1.includes('secret123'), 'Should restore masked value');

  const textWithSubstring = 'Value: abcxyz';
  const restored2 = restoreText(textWithSubstring, session);
  assert.strictEqual(restored2, textWithSubstring, 'Should not modify text without exact masked value');
});

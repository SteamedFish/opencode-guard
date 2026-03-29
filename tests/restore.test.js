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

import { test } from 'node:test';
import assert from 'node:assert';
import { maskEmail, isEmail } from '../../src/maskers/email.js';

test('maskEmail preserves domain and masks local part', () => {
  const rng = (min, max) => 5; // fixed for testing
  const result = maskEmail('john.doe@example.com', rng);
  assert.ok(result.endsWith('@example.com'));
  assert.ok(!result.includes('john.doe'));
  assert.strictEqual(result.split('@')[0].length, 'john.doe'.length);
});

test('maskEmail handles different local part lengths', () => {
  const rng = (min, max) => min;
  assert.ok(maskEmail('a@b.com', rng).endsWith('@b.com'));
  assert.ok(maskEmail('very.long.name@domain.org', rng).endsWith('@domain.org'));
});

test('maskEmail preserves length of local part', () => {
  const rng = (min, max) => Math.floor((min + max) / 2);
  const original = 'user@example.com';
  const result = maskEmail(original, rng);
  const originalLocal = original.split('@')[0];
  const resultLocal = result.split('@')[0];
  assert.strictEqual(originalLocal.length, resultLocal.length);
});

test('isEmail correctly identifies email addresses', () => {
  assert.strictEqual(isEmail('user@example.com'), true);
  assert.strictEqual(isEmail('test.user@sub.domain.org'), true);
  assert.strictEqual(isEmail('not-an-email'), false);
  assert.strictEqual(isEmail('user@'), false);
  assert.strictEqual(isEmail('@domain.com'), false);
});

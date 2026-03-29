import { test } from 'node:test';
import assert from 'node:assert';
import { maskGeneric, maskWithPattern } from '../../src/maskers/generic.js';

test('maskGeneric produces deterministic output', () => {
  const rng = (min, max) => 5;
  const result1 = maskGeneric('secret-value', 20, rng);
  const result2 = maskGeneric('secret-value', 20, rng);
  assert.strictEqual(result1, result2);
});

test('maskGeneric respects target length', () => {
  const rng = (min, max) => 5;
  const result = maskGeneric('any-value', 15, rng);
  assert.strictEqual(result.length, 15);
});

test('maskWithPattern preserves character types', () => {
  const rng = (min, max) => 2;
  // Abc123-Xyz → Xyz789-Abc (preserves uppercase, lowercase, digits, special)
  const result = maskWithPattern('Abc123-Xyz', rng);
  assert.strictEqual(result.length, 'Abc123-Xyz'.length);
  assert.ok(/[A-Z]/.test(result[0])); // First char should be uppercase
  assert.ok(/[a-z]/.test(result[1])); // Second char should be lowercase
  assert.ok(/[0-9]/.test(result[3])); // Should have digits
  assert.ok(result.includes('-')); // Should preserve hyphen
});

import { test } from 'node:test';
import assert from 'node:assert';
import { maskUUID, isUUID } from '../../src/maskers/uuid.js';

test('maskUUID generates valid UUID v4', () => {
  const rng = (min, max) => Math.floor((min + max) / 2);
  const result = maskUUID('550e8400-e29b-41d4-a716-446655440000', rng);
  
  // Check format
  const uuidRegex = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
  assert.ok(uuidRegex.test(result), `Generated UUID ${result} is not valid v4`);
});

test('isUUID correctly identifies UUIDs', () => {
  assert.strictEqual(isUUID('550e8400-e29b-41d4-a716-446655440000'), true);
  assert.strictEqual(isUUID('not-a-uuid'), false);
  assert.strictEqual(isUUID(''), false);
});

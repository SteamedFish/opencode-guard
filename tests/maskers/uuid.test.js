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

test('maskUUID preserves input case convention', () => {
  const rng = (min, max) => Math.floor((min + max) / 2);

  const upper = maskUUID('A842C2B1-7DE8-48DB-B87D-FB26794CE561', rng);
  assert.ok(/^[0-9A-F-]+$/.test(upper), `uppercase input should get uppercase masked UUID, got ${upper}`);
  assert.ok(isUUID(upper), 'uppercase masked UUID is still a valid UUID');

  const lower = maskUUID('550e8400-e29b-41d4-a716-446655440000', rng);
  assert.ok(/^[0-9a-f-]+$/.test(lower), `lowercase input should get lowercase masked UUID, got ${lower}`);
});

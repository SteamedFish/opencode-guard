import { test } from 'node:test';
import assert from 'node:assert';
import { generateHmacHash, createSeededRNG, sanitizeCategory } from '../src/utils.js';

test('generateHmacHash produces deterministic output', () => {
  const salt = 'test-salt';
  const value = 'sensitive-data';
  const hash1 = generateHmacHash(salt, value);
  const hash2 = generateHmacHash(salt, value);
  assert.strictEqual(hash1, hash2);
  assert.strictEqual(hash1.length, 64);
});

test('createSeededRNG produces deterministic numbers', () => {
  const rng1 = createSeededRNG('seed-123');
  const rng2 = createSeededRNG('seed-123');
  
  assert.strictEqual(rng1(1, 100), rng2(1, 100));
  assert.strictEqual(rng1(1, 100), rng2(1, 100));
});

test('createSeededRNG produces different sequences for different seeds', () => {
  const rng1 = createSeededRNG('seed-1');
  const rng2 = createSeededRNG('seed-2');
  
  assert.notStrictEqual(rng1(1, 100), rng2(1, 100));
});

test('sanitizeCategory normalizes category names', () => {
  assert.strictEqual(sanitizeCategory('API_KEY'), 'API_KEY');
  assert.strictEqual(sanitizeCategory('api-key'), 'API_KEY');
  assert.strictEqual(sanitizeCategory('email address'), 'EMAIL_ADDRESS');
  assert.strictEqual(sanitizeCategory(''), 'TEXT');
});

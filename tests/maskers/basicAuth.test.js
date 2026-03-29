import { test } from 'node:test';
import assert from 'node:assert';
import { maskBasicAuth, hasBasicAuth } from '../../src/maskers/basicAuth.js';
import { createSeededRNG } from '../../src/utils.js';

test('hasBasicAuth should detect HTTP Basic Auth in URL', () => {
  assert.strictEqual(hasBasicAuth('https://user:pass@example.com/path'), true);
  assert.strictEqual(hasBasicAuth('http://admin:secret123@api.example.com'), true);
});

test('hasBasicAuth should not match URLs without credentials', () => {
  assert.strictEqual(hasBasicAuth('https://example.com/path'), false);
  assert.strictEqual(hasBasicAuth('http://example.com'), false);
  assert.strictEqual(hasBasicAuth('not-a-url'), false);
});

test('hasBasicAuth should not match URLs with @ but no credentials', () => {
  assert.strictEqual(hasBasicAuth('https://example.com/path?user=test@domain.com'), false);
});

test('maskBasicAuth should mask username and password while preserving structure', () => {
  const rng = createSeededRNG('test-seed');
  const masked = maskBasicAuth('https://user:pass@example.com/path', rng);
  assert.ok(/^https:\/\/[^:]+:[^@]+@example\.com\/path$/.test(masked));
  assert.ok(!masked.includes('user'));
  assert.ok(!masked.includes('pass'));
});

test('maskBasicAuth should preserve URL length for username and password', () => {
  const rng = createSeededRNG('test-seed');
  const masked = maskBasicAuth('https://admin:secret123@example.com', rng);
  const match = masked.match(/^https:\/\/([^:]+):([^@]+)@/);
  assert.strictEqual(match[1].length, 5);
  assert.strictEqual(match[2].length, 9);
});

test('maskBasicAuth should handle special characters in username', () => {
  const rng = createSeededRNG('test-seed');
  const masked = maskBasicAuth('https://user.name:pass@example.com', rng);
  assert.ok(/^https:\/\/[^@]+@example\.com$/.test(masked));
});

test('maskBasicAuth should return unchanged if no auth present', () => {
  const rng = createSeededRNG('test-seed');
  const url = 'https://example.com/path';
  assert.strictEqual(maskBasicAuth(url, rng), url);
});

test('maskBasicAuth should be deterministic with same seed', () => {
  const rng1 = createSeededRNG('same-seed');
  const rng2 = createSeededRNG('same-seed');
  const masked1 = maskBasicAuth('https://user:pass@example.com', rng1);
  const masked2 = maskBasicAuth('https://user:pass@example.com', rng2);
  assert.strictEqual(masked1, masked2);
});

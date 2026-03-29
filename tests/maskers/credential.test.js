import { test } from 'node:test';
import assert from 'node:assert';
import {
  maskPassword,
  maskCredentialPair,
  isCredentialKey,
  DEFAULT_SENSITIVE_KEYS
} from '../../src/maskers/credential.js';
import { createSeededRNG } from '../../src/utils.js';

test('maskPassword should mask password preserving length by default', () => {
  const rng = createSeededRNG('test-seed');
  const password = 'mySecret123';
  const masked = maskPassword(password, rng);
  assert.strictEqual(masked.length, password.length);
  assert.notStrictEqual(masked, password);
});

test('maskPassword should use fixed length when preserveLength is false', () => {
  const rng = createSeededRNG('test-seed');
  const password = 'short';
  const masked = maskPassword(password, rng, { preserveLength: false, fixedLength: 20 });
  assert.strictEqual(masked.length, 20);
});

test('maskPassword should use default fixed length of 12', () => {
  const rng = createSeededRNG('test-seed');
  const password = 'short';
  const masked = maskPassword(password, rng, { preserveLength: false });
  assert.strictEqual(masked.length, 12);
});

test('maskPassword should be deterministic with same seed', () => {
  const rng1 = createSeededRNG('same-seed');
  const rng2 = createSeededRNG('same-seed');
  const masked1 = maskPassword('password', rng1);
  const masked2 = maskPassword('password', rng2);
  assert.strictEqual(masked1, masked2);
});

test('maskCredentialPair should mask sensitive credential values', () => {
  const rng = createSeededRNG('test-seed');
  const pair = maskCredentialPair('password=mySecret123', rng, DEFAULT_SENSITIVE_KEYS);
  assert.ok(/^password=[^=]+$/.test(pair));
  assert.ok(!pair.includes('mySecret123'));
});

test('maskCredentialPair should mask API key values', () => {
  const rng = createSeededRNG('test-seed');
  const pair = maskCredentialPair('api_key=sk-abc123xyz', rng, DEFAULT_SENSITIVE_KEYS);
  assert.ok(/^api_key=[^=]+$/.test(pair));
  assert.ok(!pair.includes('sk-abc123xyz'));
});

test('maskCredentialPair should preserve non-sensitive values', () => {
  const rng = createSeededRNG('test-seed');
  const pair = maskCredentialPair('username=john', rng, DEFAULT_SENSITIVE_KEYS);
  assert.strictEqual(pair, 'username=john');
});

test('maskCredentialPair should handle values containing equals signs', () => {
  const rng = createSeededRNG('test-seed');
  const pair = maskCredentialPair('password=pass=word=test', rng, DEFAULT_SENSITIVE_KEYS);
  assert.ok(pair.startsWith('password='));
  assert.notStrictEqual(pair, 'password=pass=word=test');
});

test('maskCredentialPair should mask when no sensitiveKeys provided', () => {
  const rng = createSeededRNG('test-seed');
  const pair = maskCredentialPair('anything=value123', rng, []);
  assert.ok(/^anything=/.test(pair));
  assert.ok(!pair.includes('value123'));
});

test('isCredentialKey should identify password keys', () => {
  assert.strictEqual(isCredentialKey('password'), true);
  assert.strictEqual(isCredentialKey('PASSWORD'), true);
  assert.strictEqual(isCredentialKey('my_password'), true);
});

test('isCredentialKey should identify secret keys', () => {
  assert.strictEqual(isCredentialKey('secret'), true);
  assert.strictEqual(isCredentialKey('api_secret'), true);
  assert.strictEqual(isCredentialKey('clientSecret'), true);
});

test('isCredentialKey should identify token keys', () => {
  assert.strictEqual(isCredentialKey('token'), true);
  assert.strictEqual(isCredentialKey('auth_token'), true);
});

test('isCredentialKey should identify key keys', () => {
  assert.strictEqual(isCredentialKey('api_key'), true);
  assert.strictEqual(isCredentialKey('private_key'), true);
  assert.strictEqual(isCredentialKey('accessKey'), true);
});

test('isCredentialKey should not identify non-sensitive keys', () => {
  assert.strictEqual(isCredentialKey('username'), false);
  assert.strictEqual(isCredentialKey('email'), false);
  assert.strictEqual(isCredentialKey('name'), false);
});

test('isCredentialKey should use custom sensitive keys list', () => {
  const customKeys = ['customSecret', 'internalKey'];
  assert.strictEqual(isCredentialKey('customSecret', customKeys), true);
  assert.strictEqual(isCredentialKey('password', customKeys), false);
});

test('DEFAULT_SENSITIVE_KEYS should contain expected sensitive keys', () => {
  assert.ok(DEFAULT_SENSITIVE_KEYS.includes('password'));
  assert.ok(DEFAULT_SENSITIVE_KEYS.includes('api_key'));
  assert.ok(DEFAULT_SENSITIVE_KEYS.includes('secret'));
  assert.ok(DEFAULT_SENSITIVE_KEYS.includes('token'));
});

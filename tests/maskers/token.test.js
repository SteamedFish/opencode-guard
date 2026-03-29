import { test } from 'node:test';
import assert from 'node:assert';
import { 
  maskSkToken, 
  maskSkVariantToken,
  maskGhToken, 
  maskAwsKey,
  maskGenericToken,
  detectSkPrefix
} from '../../src/maskers/token.js';

test('maskSkToken preserves sk- prefix', () => {
  const rng = (min, max) => 5;
  const result = maskSkToken('sk-abc123def456', rng);
  assert.ok(result.startsWith('sk-'));
  assert.strictEqual(result.length, 'sk-abc123def456'.length);
  assert.ok(!result.includes('abc123'));
});

test('maskSkVariantToken preserves sk-proj- prefix', () => {
  const rng = (min, max) => 5;
  const result = maskSkVariantToken('sk-proj-abc123def456', rng);
  assert.ok(result.startsWith('sk-proj-'));
  assert.strictEqual(result.length, 'sk-proj-abc123def456'.length);
  assert.ok(!result.includes('abc123'));
});

test('maskSkVariantToken preserves sk-or-v1- prefix', () => {
  const rng = (min, max) => 5;
  const result = maskSkVariantToken('sk-or-v1-abc123def456ghi789', rng);
  assert.ok(result.startsWith('sk-or-v1-'));
  assert.ok(!result.includes('abc123'));
});

test('maskSkVariantToken preserves sk-litellm- prefix', () => {
  const rng = (min, max) => 5;
  const result = maskSkVariantToken('sk-litellm-abc123def456', rng);
  assert.ok(result.startsWith('sk-litellm-'));
});

test('maskSkVariantToken preserves sk-kimi- prefix', () => {
  const rng = (min, max) => 5;
  const result = maskSkVariantToken('sk-kimi-abc123', rng);
  assert.ok(result.startsWith('sk-kimi-'));
});

test('maskSkVariantToken preserves sk-ant- prefix', () => {
  const rng = (min, max) => 5;
  const result = maskSkVariantToken('sk-ant-abc123', rng);
  assert.ok(result.startsWith('sk-ant-'));
});

test('detectSkPrefix identifies all sk- variants', () => {
  assert.strictEqual(detectSkPrefix('sk-abc123'), 'sk-');
  assert.strictEqual(detectSkPrefix('sk-proj-abc123'), 'sk-proj-');
  assert.strictEqual(detectSkPrefix('sk-or-v1-abc123'), 'sk-or-v1-');
  assert.strictEqual(detectSkPrefix('sk-litellm-abc123'), 'sk-litellm-');
  assert.strictEqual(detectSkPrefix('sk-kimi-abc123'), 'sk-kimi-');
  assert.strictEqual(detectSkPrefix('sk-ant-abc123'), 'sk-ant-');
  assert.strictEqual(detectSkPrefix('sk-custom-abc123'), 'sk-custom-');
});

test('maskGhToken preserves ghp_ prefix', () => {
  const rng = (min, max) => 5;
  const result = maskGhToken('ghp_xxxxxxxxxxxx', rng);
  assert.ok(result.startsWith('ghp_'));
  assert.strictEqual(result.length, 'ghp_xxxxxxxxxxxx'.length);
});

test('maskAwsKey preserves AKIA prefix', () => {
  const rng = (min, max) => 5;
  const result = maskAwsKey('AKIAIOSFODNN7EXAMPLE', rng);
  assert.ok(result.startsWith('AKIA'));
  assert.strictEqual(result.length, 20);
});

test('maskGenericToken preserves custom prefix', () => {
  const rng = (min, max) => 5;
  const result = maskGenericToken('prefix_12345', rng, 'prefix_');
  assert.ok(result.startsWith('prefix_'));
  assert.strictEqual(result.length, 'prefix_12345'.length);
});

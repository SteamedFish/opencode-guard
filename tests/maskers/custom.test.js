import { test } from 'node:test';
import assert from 'node:assert';
import { createCustomMasker, CustomMaskerRegistry } from '../../src/maskers/custom.js';

test('createCustomMasker handles prefixed_token type', () => {
  const rng = (min, max) => 5;
  const masker = createCustomMasker({
    type: 'prefixed_token',
    prefix: 'myapp-',
    suffix_length: 10,
    suffix_chars: 'alphanumeric'
  });

  const result = masker('myapp-secret123', rng);
  assert.ok(result.startsWith('myapp-'));
  assert.strictEqual(result.length, 'myapp-secret123'.length);
});

test('createCustomMasker handles pattern_preserving type', () => {
  const rng = (min, max) => 5;
  const masker = createCustomMasker({
    type: 'pattern_preserving',
    char_sets: { uppercase: true, lowercase: true, digits: true }
  });

  const result = masker('AbC123', rng);
  assert.strictEqual(result.length, 6);
  assert.ok(/[A-Z]/.test(result[0]));
  assert.ok(/[a-z]/.test(result[1]));
  assert.ok(/[0-9]/.test(result[3]));
});

test('createCustomMasker handles fixed_length type', () => {
  const rng = (min, max) => 5;
  const masker = createCustomMasker({
    type: 'fixed_length',
    length: 20,
    chars: 'alphanumeric',
    prefix: 'tk_'
  });

  const result = masker('anything', rng);
  assert.ok(result.startsWith('tk_'));
  assert.strictEqual(result.length, 20);
});

test('CustomMaskerRegistry loads maskers from config', () => {
  const registry = new CustomMaskerRegistry();
  const config = {
    my_token: { type: 'prefixed_token', prefix: 'app-', suffix_length: 16 }
  };

  registry.loadFromConfig(config);
  const masker = registry.get('my_token');

  assert.ok(typeof masker === 'function');
});

test('CustomMaskerRegistry registers and retrieves maskers', () => {
  const registry = new CustomMaskerRegistry();
  const customMasker = (value, rng) => `masked_${value}`;

  registry.register('test', customMasker);
  assert.strictEqual(registry.get('test'), customMasker);
  assert.strictEqual(registry.has('test'), true);
});

test('CustomMaskerRegistry getNames returns all registered names', () => {
  const registry = new CustomMaskerRegistry();
  registry.register('masker1', () => 'test1');
  registry.register('masker2', () => 'test2');

  const names = registry.getNames();
  assert.ok(names.includes('masker1'));
  assert.ok(names.includes('masker2'));
  assert.strictEqual(names.length, 2);
});

test('CustomMaskerRegistry clear removes all maskers', () => {
  const registry = new CustomMaskerRegistry();
  registry.register('test', () => 'test');
  assert.strictEqual(registry.has('test'), true);

  registry.clear();
  assert.strictEqual(registry.has('test'), false);
  assert.strictEqual(registry.getNames().length, 0);
});

test('prefixed_token with preserve_length maintains original value length', () => {
  const rng = (min, max) => 5;
  const masker = createCustomMasker({
    type: 'prefixed_token',
    prefix: 'app-',
    preserve_length: true,
    suffix_chars: 'alphanumeric'
  });

  const result = masker('app-very-long-secret-value-here', rng);
  assert.ok(result.startsWith('app-'));
  assert.strictEqual(result.length, 'app-very-long-secret-value-here'.length);
});

test('pattern_preserving preserves special characters when configured', () => {
  const rng = (min, max) => 5;
  const masker = createCustomMasker({
    type: 'pattern_preserving',
    char_sets: { uppercase: true, lowercase: true, digits: true, special: '-' }
  });

  const result = masker('AbC-123', rng);
  assert.ok(result.includes('-'));
  assert.strictEqual(result.length, 7);
});

test('fixed_length without prefix uses full length', () => {
  const rng = (min, max) => 5;
  const masker = createCustomMasker({
    type: 'fixed_length',
    length: 10,
    chars: 'numeric'
  });

  const result = masker('anything', rng);
  assert.strictEqual(result.length, 10);
  assert.ok(/^\d+$/.test(result));
});

test('createCustomMasker throws on unknown type', () => {
  assert.throws(() => {
    createCustomMasker({ type: 'unknown_type' });
  }, /Unknown custom masker type/);
});

test('regex masker replaces specified groups', () => {
  const rng = () => 0;
  const masker = createCustomMasker({
    type: 'regex',
    pattern: '(api-)([^@]+)',
    replace_groups: [2],
    mask_char: 'X'
  });

  const result = masker('api-secret123', rng);
  assert.ok(result.startsWith('api-'));
  assert.ok(result.includes('XXX'));
});

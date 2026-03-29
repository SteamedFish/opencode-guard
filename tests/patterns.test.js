import { test } from 'node:test';
import assert from 'node:assert';
import { buildPatternSet } from '../src/patterns.js';

test('buildPatternSet loads builtins for null input', () => {
  const result = buildPatternSet(null);
  assert.strictEqual(result.keywords.length, 0);
  assert.ok(result.regex.length > 0, 'should have builtin patterns for null input');
  assert.ok(result.exclude.size > 0, 'should have default excludes');
  assert.strictEqual(result.exclude.has('clio-agent@sisyphuslabs.ai'), true);
});

test('buildPatternSet processes keywords', () => {
  const result = buildPatternSet({
    keywords: [
      { value: 'secret', category: 'SECRET', mask_as: 'pattern' },
    ],
  });
  assert.strictEqual(result.keywords.length, 1);
  assert.strictEqual(result.keywords[0].value, 'secret');
  assert.strictEqual(result.keywords[0].category, 'SECRET');
  assert.strictEqual(result.keywords[0].maskAs, 'pattern');
});

test('buildPatternSet processes regex patterns', () => {
  const result = buildPatternSet({
    regex: [
      { pattern: '\\d{3}-\\d{2}-\\d{4}', category: 'SSN', mask_as: 'pattern' },
    ],
  });
  assert.strictEqual(result.regex.length, 1);
  assert.strictEqual(result.regex[0].category, 'SSN');
  assert.strictEqual(result.regex[0].maskAs, 'pattern');
});

test('buildPatternSet includes builtin patterns', () => {
  const result = buildPatternSet({
    builtin: ['email', 'uuid'],
  });
  assert.ok(result.regex.length >= 2);
  const categories = result.regex.map(r => r.category);
  assert.ok(categories.includes('EMAIL'));
  assert.ok(categories.includes('UUID'));
});

test('buildPatternSet builds exclude set', () => {
  const result = buildPatternSet({
    exclude: ['example.com', 'localhost'],
  });
  assert.strictEqual(result.exclude.has('example.com'), true);
  assert.strictEqual(result.exclude.has('localhost'), true);
  // Should also have default excludes
  assert.strictEqual(result.exclude.has('clio-agent@sisyphuslabs.ai'), true);
});

test('buildPatternSet handles invalid regex gracefully', () => {
  const result = buildPatternSet({
    regex: [
      { pattern: 'valid', category: 'VALID' },
      { pattern: '[invalid', category: 'INVALID' },
    ],
  });
  assert.strictEqual(result.regex.length, 1);
});

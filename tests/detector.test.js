import { detectSensitiveData } from '../src/detector.js';
import { AIDetector } from '../src/ai-detector/index.js';
import { test } from 'node:test';
import assert from 'node:assert';

test('detectSensitiveData finds regex matches', async () => {
  const email = 'user@example.com';
  const text = `My email is ${email} and phone is 123-456-7890`;
  const patterns = {
    regex: [
      { regex: /\S+@\S+\.\S+/g, category: 'EMAIL', maskAs: 'email' },
    ],
    keywords: [],
    exclude: new Set(),
  };

  const results = await detectSensitiveData(text, patterns);
  assert.strictEqual(results.length, 1);
  assert.strictEqual(results[0].category, 'EMAIL');
  assert.strictEqual(results[0].text, email);
});

test('detectSensitiveData finds keyword matches', async () => {
  const text = 'The secret is here and another secret appears here';
  const patterns = {
    regex: [],
    keywords: [
      { value: 'secret', category: 'SECRET_KEYWORD', maskAs: 'pattern' },
    ],
    exclude: new Set(),
  };

  const results = await detectSensitiveData(text, patterns);
  assert.strictEqual(results.length, 2);
  assert.ok(results.every(r => r.category === 'SECRET_KEYWORD'));
});

test('detectSensitiveData excludes specified values', async () => {
  const kept = 'alice@example.com';
  const dropped = 'bob@example.com';
  const text = `Contact ${kept} or ${dropped}`;
  const patterns = {
    regex: [
      { regex: /\S+@\S+\.\S+/g, category: 'EMAIL', maskAs: 'email' },
    ],
    keywords: [],
    exclude: new Set([dropped]),
  };

  const results = await detectSensitiveData(text, patterns);
  assert.strictEqual(results.length, 1);
  assert.strictEqual(results[0].text, kept);
});

test('detectSensitiveData handles overlapping matches', async () => {
  const text = 'sk-abc123def456';
  const patterns = {
    regex: [
      { regex: /sk-[a-z0-9]+/gi, category: 'TOKEN', maskAs: 'pattern' },
      { regex: /sk-[a-z0-9]{3}/gi, category: 'SHORT_TOKEN', maskAs: 'pattern' },
    ],
    keywords: [],
    exclude: new Set(),
  };

  const results = await detectSensitiveData(text, patterns);
  assert.strictEqual(results.length, 1);
});

test('detectSensitiveData returns empty array for no matches', async () => {
  const text = 'No sensitive data here';
  const patterns = {
    regex: [
      { regex: /\d{3}-\d{2}-\d{4}/g, category: 'SSN', maskAs: 'pattern' },
    ],
    keywords: [],
    exclude: new Set(),
  };

  const results = await detectSensitiveData(text, patterns);
  assert.strictEqual(results.length, 0);
});

test('detectSensitiveData terminates when keyword is excluded (C1 regression)', async () => {
  const text = 'the password is hunter2 and hunter2 again';
  const patterns = {
    regex: [],
    keywords: [
      { value: 'hunter2', category: 'PASSWORD', maskAs: 'pattern' },
    ],
    exclude: new Set(['hunter2']),
  };

  const results = await detectSensitiveData(text, patterns);
  assert.strictEqual(results.length, 0, 'excluded keyword must produce no matches');
});

test('detectSensitiveData ignores zero-width regex matches (M6 regression)', async () => {
  const text = 'bbb';
  const patterns = {
    regex: [
      { regex: /a*/g, category: 'ZERO', maskAs: 'pattern' },
    ],
    keywords: [],
    exclude: new Set(),
  };

  const results = await detectSensitiveData(text, patterns);
  assert.strictEqual(results.length, 0, 'zero-width matches must not be recorded');
});

test('detectSensitiveData still finds real matches alongside a zero-width-capable pattern', async () => {
  const text = 'aa bb aa';
  const patterns = {
    regex: [
      { regex: /a*/g, category: 'ZERO', maskAs: 'pattern' },
    ],
    keywords: [],
    exclude: new Set(),
  };

  const results = await detectSensitiveData(text, patterns);
  assert.strictEqual(results.length, 2);
  assert.ok(results.every(r => r.text === 'aa'));
});

test('detectSensitiveData excludes values case-insensitively for case-insensitive rules', async () => {
  const excludedLower = 'charlie@example.org';
  const kept = 'dave@example.org';
  // Same value as excludedLower, but with different casing in the text
  const mixedCase = excludedLower.toUpperCase();
  const text = `Contact ${mixedCase} or ${kept}`;
  const patterns = {
    regex: [
      { regex: /\S+@\S+\.\S+/gi, category: 'EMAIL', maskAs: 'email' },
    ],
    keywords: [],
    exclude: new Set([excludedLower]),
  };

  const results = await detectSensitiveData(text, patterns);
  assert.strictEqual(results.length, 1);
  assert.strictEqual(results[0].text, kept);
});

test('detectSensitiveData keeps exact-match exclude behavior for case-sensitive rules', async () => {
  const text = 'SECRET value';
  const patterns = {
    regex: [
      { regex: /SECRET/g, category: 'TOKEN', maskAs: 'pattern' },
    ],
    keywords: [],
    // Different case must NOT exclude for a case-sensitive rule
    exclude: new Set(['secret']),
  };

  const results = await detectSensitiveData(text, patterns);
  assert.strictEqual(results.length, 1);
  assert.strictEqual(results[0].text, 'SECRET');
});

test('detectSensitiveData reuses regex objects across calls without stale lastIndex (N3)', async () => {
  const email = 'erin@example.net';
  const patterns = {
    regex: [
      { regex: /\S+@\S+\.\S+/g, category: 'EMAIL', maskAs: 'email' },
    ],
    keywords: [],
    exclude: new Set(),
  };

  const first = await detectSensitiveData(`mail ${email}`, patterns);
  const second = await detectSensitiveData(`mail ${email}`, patterns);
  assert.strictEqual(first.length, 1);
  assert.strictEqual(second.length, 1, 'second call must still match after lastIndex reset');
});

test('detectSensitiveData expands an AI-flagged value to all occurrences', async () => {
  const value = 'mpoq@example.com';
  const text = `first ${value} then ${value} end`;
  const first = text.indexOf(value);
  const aiDetector = new AIDetector({});
  aiDetector.initialized = true;
  aiDetector.provider = {
    detect: async () => [
      { start: first, end: first + value.length, value, type: 'EMAIL', score: 0.9 },
    ],
  };
  const patterns = { regex: [], keywords: [], exclude: new Set() };

  const results = await detectSensitiveData(text, patterns, aiDetector);

  assert.strictEqual(results.length, 2);
  assert.deepStrictEqual(
    results.map(r => r.start).sort((a, b) => a - b),
    [first, text.indexOf(value, first + 1)].sort((a, b) => a - b)
  );
  assert.ok(results.every(r => r.text === value));
});

test('detectSensitiveData deduplicates an AI-expanded value against regex matches', async () => {
  const value = 'klze@example.com';
  const text = `first ${value} then ${value} end`;
  const first = text.indexOf(value);
  const aiDetector = new AIDetector({});
  aiDetector.initialized = true;
  aiDetector.provider = {
    detect: async () => [
      { start: first, end: first + value.length, value, type: 'EMAIL', score: 0.9 },
    ],
  };
  const patterns = {
    regex: [{ regex: /\S+@\S+\.\S+/g, category: 'EMAIL', maskAs: 'email' }],
    keywords: [],
    exclude: new Set(),
  };

  const results = await detectSensitiveData(text, patterns, aiDetector);

  assert.strictEqual(results.length, 2, 'regex + expanded AI results must not duplicate spans');
  assert.ok(results.every(r => r.text === value));
});

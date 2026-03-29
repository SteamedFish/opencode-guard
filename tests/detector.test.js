import { detectSensitiveData } from '../src/detector.js';
import { test } from 'node:test';
import assert from 'node:assert';

test('detectSensitiveData finds regex matches', async () => {
  const text = 'My email is john@example.com and phone is 123-456-7890';
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
  assert.strictEqual(results[0].text, 'john@example.com');
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
  const text = 'Contact john@example.com or admin@example.com';
  const patterns = {
    regex: [
      { regex: /\S+@\S+\.\S+/g, category: 'EMAIL', maskAs: 'email' },
    ],
    keywords: [],
    exclude: new Set(['admin@example.com']),
  };
  
  const results = await detectSensitiveData(text, patterns);
  assert.strictEqual(results.length, 1);
  assert.strictEqual(results[0].text, 'john@example.com');
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

import { redactText, redactDeep } from '../src/engine.js';
import { MaskSession } from '../src/session.js';
import { test } from 'node:test';
import assert from 'node:assert';

const globalSalt = 'test-salt';

function createTestSession() {
  return new MaskSession(globalSalt, { ttlMs: 3600000, maxMappings: 1000 });
}

test('redactText masks sensitive data in text', async () => {
  const session = createTestSession();
  const text = 'My email is john@example.com';
  const patterns = {
    regex: [
      { regex: /\S+@\S+\.\S+/g, category: 'EMAIL', maskAs: 'email' },
    ],
    keywords: [],
    exclude: new Set(),
  };
  
  const result = await redactText(text, patterns, session);
  assert.strictEqual(result.count, 1);
  assert.ok(!result.text.includes('john@example.com'));
  assert.ok(result.text.includes('@example.com'));
});

test('redactText returns original text when no matches', async () => {
  const session = createTestSession();
  const text = 'No sensitive data here';
  const patterns = {
    regex: [
      { regex: /\d{3}-\d{2}-\d{4}/g, category: 'SSN', maskAs: 'pattern' },
    ],
    keywords: [],
    exclude: new Set(),
  };
  
  const result = await redactText(text, patterns, session);
  assert.strictEqual(result.count, 0);
  assert.strictEqual(result.text, text);
});

test('redactDeep masks nested objects', async () => {
  const session = createTestSession();
  const obj = {
    user: 'john',
    email: 'john@example.com',
    nested: {
      contact: 'jane@example.com',
    },
  };
  const patterns = {
    regex: [
      { regex: /\S+@\S+\.\S+/g, category: 'EMAIL', maskAs: 'email' },
    ],
    keywords: [],
    exclude: new Set(),
  };
  
  await redactDeep(obj, patterns, session);
  assert.ok(!obj.email.includes('john@example.com'));
  assert.ok(!obj.nested.contact.includes('jane@example.com'));
  assert.strictEqual(obj.user, 'john');
});

test('redactDeep masks arrays', async () => {
  const session = createTestSession();
  const arr = [
    'john@example.com',
    'jane@example.com',
    'regular string',
  ];
  const patterns = {
    regex: [
      { regex: /\S+@\S+\.\S+/g, category: 'EMAIL', maskAs: 'email' },
    ],
    keywords: [],
    exclude: new Set(),
  };
  
  await redactDeep(arr, patterns, session);
  assert.ok(!arr[0].includes('john@example.com'));
  assert.ok(!arr[1].includes('jane@example.com'));
  assert.strictEqual(arr[2], 'regular string');
});

test('redactDeep handles null and undefined', async () => {
  const session = createTestSession();
  const patterns = { regex: [], keywords: [], exclude: new Set() };
  
  assert.strictEqual(await redactDeep(null, patterns, session), null);
  assert.strictEqual(await redactDeep(undefined, patterns, session), undefined);
});

test('redactDeep handles numbers and booleans', async () => {
  const session = createTestSession();
  const patterns = { regex: [], keywords: [], exclude: new Set() };
  
  assert.strictEqual(await redactDeep(42, patterns, session), 42);
  assert.strictEqual(await redactDeep(true, patterns, session), true);
});

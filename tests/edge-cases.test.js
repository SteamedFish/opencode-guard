import { test } from 'node:test';
import assert from 'node:assert';
import { detectSensitiveData } from '../src/detector.js';
import { redactText, redactDeep } from '../src/engine.js';
import { restoreText, restoreDeep } from '../src/restore.js';
import { MaskSession } from '../src/session.js';

const mockPatterns = {
  regex: [
    { regex: /\b[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Z|a-z]{2,}\b/g, category: 'EMAIL', maskAs: 'email' },
    { regex: /ghp_[A-Za-z0-9]{36}/g, category: 'TOKEN', maskAs: 'gh_token' },
    { regex: /\b(?:\d{1,3}\.){3}\d{1,3}\b/g, category: 'IP', maskAs: 'ipv4' },
  ],
  keywords: [
    { value: 'API_SECRET_123', category: 'SECRET', maskAs: 'pattern' },
    { value: 'admin_password', category: 'PASSWORD', maskAs: 'pattern' },
  ],
  exclude: new Set(['127.0.135.56', 'jaca@localhost.local']),
};

const simplePatterns = {
  regex: [
    { regex: /test_[a-z]+/g, category: 'TEST', maskAs: 'pattern' },
  ],
  keywords: [],
  exclude: new Set(),
};

test('detectSensitiveData returns empty array for empty string', async () => {
  const results = await detectSensitiveData('', mockPatterns);
  assert.deepStrictEqual(results, []);
});

test('detectSensitiveData returns empty array for null/undefined', async () => {
  const resultsNull = await detectSensitiveData(null, mockPatterns);
  const resultsUndefined = await detectSensitiveData(undefined, mockPatterns);
  assert.deepStrictEqual(resultsNull, []);
  assert.deepStrictEqual(resultsUndefined, []);
});

test('detectSensitiveData handles text without any matches', async () => {
  const text = 'Just some regular text without any sensitive data here.';
  const results = await detectSensitiveData(text, mockPatterns);
  assert.deepStrictEqual(results, []);
});

test('detectSensitiveData handles overlapping matches correctly', async () => {
  const patterns = {
    regex: [
      { regex: /outer\d+/g, category: 'OUTER', maskAs: 'pattern' },
      { regex: /outer\d+inner/g, category: 'INNER', maskAs: 'pattern' },
    ],
    keywords: [],
    exclude: new Set(),
  };

  const text = 'outer123inner text';
  const results = await detectSensitiveData(text, patterns);
  assert.strictEqual(results.length, 1);
  assert.strictEqual(results[0].text, 'outer123inner');
  assert.strictEqual(results[0].category, 'INNER');
});

test('detectSensitiveData handles adjacent matches without overlap', async () => {
  const text = 'onmvx@example.com and ghp_xxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx';
  const results = await detectSensitiveData(text, mockPatterns);
  assert.strictEqual(results.length, 2);
  assert.strictEqual(results[0].category, 'EMAIL');
  assert.strictEqual(results[1].category, 'TOKEN');
});

test('detectSensitiveData handles multiple occurrences of same pattern', async () => {
  const text = 'Contact: myzxl@example.com and rio@test.org';
  const results = await detectSensitiveData(text, mockPatterns);
  assert.strictEqual(results.length, 2);
  assert.strictEqual(results[0].text, 'myzxl@example.com');
  assert.strictEqual(results[1].text, 'rio@test.org');
});

test('detectSensitiveData excludes values in exclude set', async () => {
  const text = 'Local addresses: 127.0.135.56 and 192.168.73.120';
  const results = await detectSensitiveData(text, mockPatterns);
  assert.strictEqual(results.length, 1);
  assert.strictEqual(results[0].text, '192.168.73.120');
});

test('detectSensitiveData handles special regex characters in text', async () => {
  const text = 'Text with regex special chars: (test) [foo] {bar} * + ? . ^ $ |';
  const results = await detectSensitiveData(text, simplePatterns);
  assert.deepStrictEqual(results, []);
});

test('detectSensitiveData handles unicode text', async () => {
  const patterns = {
    regex: [
      { regex: /测试_[a-z]+/g, category: 'TEST', maskAs: 'pattern' },
    ],
    keywords: [],
    exclude: new Set(),
  };

  const text = 'Testing unicode: 测试_abc and 测试_xyz';
  const results = await detectSensitiveData(text, patterns);
  assert.strictEqual(results.length, 2);
  assert.strictEqual(results[0].text, '测试_abc');
  assert.strictEqual(results[1].text, '测试_xyz');
});

test('detectSensitiveData handles very long text', async () => {
  const patterns = {
    regex: [
      { regex: /test_value_\d+/g, category: 'TEST', maskAs: 'pattern' },
    ],
    keywords: [],
    exclude: new Set(),
  };
  const value = 'test_value_12345';
  const text = 'x'.repeat(10000) + value + 'y'.repeat(10000);
  const results = await detectSensitiveData(text, patterns);
  assert.strictEqual(results.length, 1);
  assert.strictEqual(results[0].text, value);
  assert.strictEqual(results[0].start, 10000);
  assert.strictEqual(results[0].end, 10000 + value.length);
});

test('redactText handles empty string', async () => {
  const session = new MaskSession('test-salt', 1000, 3600000);
  const result = await redactText('', mockPatterns, session);
  assert.strictEqual(result.text, '');
  assert.strictEqual(result.count, 0);
});

test('redactText handles null/undefined', async () => {
  const session = new MaskSession('test-salt', 1000, 3600000);
  const resultNull = await redactText(null, mockPatterns, session);
  const resultUndefined = await redactText(undefined, mockPatterns, session);
  assert.strictEqual(resultNull.text, null);
  assert.strictEqual(resultUndefined.text, undefined);
});

test('redactText handles non-string input', async () => {
  const session = new MaskSession('test-salt', 1000, 3600000);
  const resultNum = await redactText(123, mockPatterns, session);
  const resultBool = await redactText(true, mockPatterns, session);
  const resultObj = await redactText({}, mockPatterns, session);
  assert.strictEqual(resultNum.text, 123);
  assert.strictEqual(resultBool.text, true);
  assert.deepStrictEqual(resultObj.text, {});
});

test('redactDeep handles deeply nested objects', async () => {
  const session = new MaskSession('test-salt', 1000, 3600000);
  const obj = {
    level1: {
      level2: {
        level3: {
          level4: {
            level5: 'test_value',
          },
        },
      },
    },
  };

  await redactDeep(obj, simplePatterns, session);
  assert.strictEqual(obj.level1.level2.level3.level4.level5, 'jksy_wlczd');
});

test('redactDeep handles mixed arrays and objects', async () => {
  const session = new MaskSession('test-salt', 1000, 3600000);
  const originalEmails = ['5t5lw@example.com', 'o5ihm@example.com', '2mxeu@example.com'];
  const data = [
    { email: originalEmails[0] },
    [originalEmails[1], { email: originalEmails[2] }],
  ];

  await redactDeep(data, mockPatterns, session);
  assert.notStrictEqual(data[0].email, originalEmails[0]);
  assert.notStrictEqual(data[1][0], originalEmails[1]);
  assert.notStrictEqual(data[1][1].email, originalEmails[2]);
});

test('redactDeep preserves primitive types', async () => {
  const session = new MaskSession('test-salt', 1000, 3600000);
  const data = {
    num: 42,
    bool: true,
    nil: null,
    undef: undefined,
    str: 'normal string',
  };

  await redactDeep(data, mockPatterns, session);
  assert.strictEqual(data.num, 42);
  assert.strictEqual(data.bool, true);
  assert.strictEqual(data.nil, null);
  assert.strictEqual(data.undef, undefined);
  assert.strictEqual(data.str, 'normal string');
});

test('restoreText handles empty string', () => {
  const session = new MaskSession('test-salt', 1000, 3600000);
  const result = restoreText('', session);
  assert.strictEqual(result, '');
});

test('restoreText handles null/undefined', () => {
  const session = new MaskSession('test-salt', 1000, 3600000);
  const resultNull = restoreText(null, session);
  const resultUndefined = restoreText(undefined, session);
  assert.strictEqual(resultNull, null);
  assert.strictEqual(resultUndefined, undefined);
});

test('restoreText handles non-string input', () => {
  const session = new MaskSession('test-salt', 1000, 3600000);
  const resultNum = restoreText(123, session);
  const resultBool = restoreText(false, session);
  const resultObj = restoreText({ foo: 'bar' }, session);
  assert.strictEqual(resultNum, 123);
  assert.strictEqual(resultBool, false);
  assert.deepStrictEqual(resultObj, { foo: 'bar' });
});

test('restoreText handles text without masked values', () => {
  const session = new MaskSession('test-salt', 1000, 3600000);
  const text = 'Just some normal text without any masked values';
  const result = restoreText(text, session);
  assert.strictEqual(result, text);
});

test('restoreText handles text with multiple masked values', async () => {
  const session = new MaskSession('test-salt', 1000, 3600000);
  const original1 = 'secret_key_abc';
  const original2 = 'secret_key_xyz';
  const masked1 = session.getOrCreateMasked(original1, 'SECRET', 'pattern');
  const masked2 = session.getOrCreateMasked(original2, 'SECRET', 'pattern');

  const text = `${masked1} and ${masked2}`;
  const result = restoreText(text, session);

  assert.ok(result.includes(original1));
  assert.ok(result.includes(original2));
});

test('restoreDeep handles deeply nested restoration', async () => {
  const session = new MaskSession('test-salt', 1000, 3600000);
  const original = 'ckkbgmlnp@data.com';
  const masked = session.getOrCreateMasked(original, 'EMAIL', 'email');

  const data = {
    user: { email: masked },
    contacts: [{ email: masked }],
    metadata: { nested: { email: masked } },
  };

  restoreDeep(data, session);

  assert.strictEqual(data.user.email, original);
  assert.strictEqual(data.contacts[0].email, original);
  assert.strictEqual(data.metadata.nested.email, original);
});

test('full pipeline: mask and restore roundtrip', async () => {
  const session = new MaskSession('test-salt', 1000, 3600000);
  const original = 'User: bdpbx@example.com, Token: ghp_123456789012345678901234567890123456';

  const masked = await redactText(original, mockPatterns, session);
  assert.ok(masked.count > 0);
  assert.ok(!masked.text.includes('bdpbx@example.com'));
  assert.ok(!masked.text.includes('ghp_1234567890'));

  const restored = restoreText(masked.text, session);
  assert.strictEqual(restored, original);
});

test('full pipeline: deep mask and restore roundtrip', async () => {
  const session = new MaskSession('test-salt', 1000, 3600000);
  const original = {
    user: 'bdpbx@example.com',
    api_key: 'ghp_735599958828459258058367928805372252',
    nested: {
      contact: 'geskcvi@example.com',
    },
  };

  const masked = structuredClone(original);
  await redactDeep(masked, mockPatterns, session);

  assert.notStrictEqual(masked.user, original.user);
  assert.notStrictEqual(masked.api_key, original.api_key);
  assert.notStrictEqual(masked.nested.contact, original.nested.contact);

  restoreDeep(masked, session);

  assert.strictEqual(masked.user, original.user);
  assert.strictEqual(masked.api_key, original.api_key);
  assert.strictEqual(masked.nested.contact, original.nested.contact);
});

test('full pipeline: session isolation between sessions', async () => {
  const session1 = new MaskSession('salt-1', 1000, 3600000);
  const session2 = new MaskSession('salt-2', 1000, 3600000);

  const text = 'bdpbx@example.com';

  const masked1 = session1.getOrCreateMasked(text, 'EMAIL', 'email');
  const masked2 = session2.getOrCreateMasked(text, 'EMAIL', 'email');

  assert.notStrictEqual(masked1, masked2);

  const restored1 = restoreText(masked1, session1);
  const restored2 = restoreText(masked2, session2);

  assert.strictEqual(restored1, text);
  assert.strictEqual(restored2, text);

  assert.strictEqual(restoreText(masked1, session2), masked1);
  assert.strictEqual(restoreText(masked2, session1), masked2);
});

test('edge case: empty patterns object', async () => {
  const session = new MaskSession('test-salt', 1000, 3600000);
  const text = 'some text with onmvx@example.com';

  const result = await redactText(text, {}, session);
  assert.strictEqual(result.text, text);
  assert.strictEqual(result.count, 0);
});

test('edge case: patterns with only exclude', async () => {
  const patterns = {
    regex: [],
    keywords: [],
    exclude: new Set(['exclude_me']),
  };

  const session = new MaskSession('test-salt', 1000, 3600000);
  const text = 'text with exclude_me in it';

  const result = await redactText(text, patterns, session);
  assert.strictEqual(result.text, text);
  assert.strictEqual(result.count, 0);
});

test('edge case: very long masked value', async () => {
  const session = new MaskSession('test-salt', 1000, 3600000);
  const longValue = 'x'.repeat(1000);

  const masked = session.getOrCreateMasked(longValue, 'LONG', 'pattern');
  const restored = restoreText(masked, session);

  assert.strictEqual(restored, longValue);
});

test('edge case: special characters in masked value', async () => {
  const session = new MaskSession('test-salt', 1000, 3600000);
  const specialValue = 'value with special chars: <>&"\'\n\t\\';

  const masked = session.getOrCreateMasked(specialValue, 'SPECIAL', 'pattern');
  const restored = restoreText(masked, session);

  assert.strictEqual(restored, specialValue);
});

test('edge case: multiple identical values in same text', async () => {
  const session = new MaskSession('test-salt', 1000, 3600000);
  const email = 'nodu@example.com';
  const text = `${email}, ${email}, and ${email}`;

  const result = await redactText(text, mockPatterns, session);
  assert.strictEqual(result.count, 3);

  const restored = restoreText(result.text, session);
  assert.strictEqual(restored, text);
});

test('edge case: text with only masked content', async () => {
  const session = new MaskSession('test-salt', 1000, 3600000);
  const text = 'nodu@example.com';

  const result = await redactText(text, mockPatterns, session);
  assert.ok(result.text.length > 0);
  assert.notStrictEqual(result.text, text);

  const restored = restoreText(result.text, session);
  assert.strictEqual(restored, text);
});

test('detectSensitiveData handles patterns with start anchor', async () => {
  const patterns = {
    regex: [
      { regex: /^start/g, category: 'START', maskAs: 'pattern' },
    ],
    keywords: [],
    exclude: new Set(),
  };

  const text = 'start of the text';
  const results = await detectSensitiveData(text, patterns);
  assert.strictEqual(results.length, 1);
  assert.strictEqual(results[0].text, 'start');
  assert.strictEqual(results[0].category, 'START');
});

test('redactDeep handles circular references gracefully', async () => {
  const session = new MaskSession('test-salt', 1000, 3600000);
  const obj = { name: 'test@test.com', child: null };
  obj.child = obj;

  await assert.doesNotReject(async () => {
    await redactDeep(obj, simplePatterns, session);
  });
  assert.ok(typeof obj.name === 'string');
});

test('restoreDeep handles circular references gracefully', () => {
  const session = new MaskSession('test-salt', 1000, 3600000);
  const obj = { value: 'test', self: null };
  obj.self = obj;

  assert.doesNotThrow(() => {
    restoreDeep(obj, session);
  });
});

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

test('buildPatternSet warns on invalid custom regex', () => {
  const warnings = [];
  const origWarn = console.warn;
  console.warn = (msg) => warnings.push(String(msg));
  try {
    buildPatternSet({
      regex: [
        { pattern: '[invalid', category: 'INVALID' },
      ],
    });
  } finally {
    console.warn = origWarn;
  }
  assert.strictEqual(warnings.length, 1);
  assert.ok(warnings[0].includes('[opencode-guard] invalid custom pattern skipped'));
  assert.ok(warnings[0].includes('[invalid'));
});

test('buildPatternSet ipv4 builtin matches valid IPs and rejects invalid ones', async () => {
  const { detectSensitiveData } = await import('../src/detector.js');
  const patterns = buildPatternSet({ builtin: ['ipv4'] });

  const valid = await detectSensitiveData('hosts 192.168.134.21 and 255.255.211.183 and 0.0.19.191', patterns);
  const validIps = valid.filter(r => r.category === 'IPV4');
  assert.strictEqual(validIps.length, 3);
  assert.deepStrictEqual(validIps.map(r => r.text), ['192.168.134.21', '255.255.211.183', '0.0.19.191']);

  const invalidOctets = await detectSensitiveData('bad 999.1.159.146 here', patterns);
  assert.strictEqual(invalidOctets.filter(r => r.category === 'IPV4').length, 0, 'octets > 255 must not match');

  const embedded = await detectSensitiveData('bad 12345.678.140.25 here', patterns);
  assert.strictEqual(embedded.filter(r => r.category === 'IPV4').length, 0, 'must not match inside longer numbers');

  const trailing = await detectSensitiveData('bad 1.2.104.67.5 here', patterns);
  assert.strictEqual(trailing.filter(r => r.category === 'IPV4').length, 0, 'must not partially match 5-octet sequences');
});

test('buildPatternSet no longer includes the duplicate china_phone builtin', () => {
  const result = buildPatternSet(null);
  const categories = result.regex.map(r => r.category);
  assert.ok(!categories.includes('CHINA_PHONE'), 'china_phone duplicate was removed');
  assert.ok(categories.includes('PHONE'), 'phone builtin remains');
  // Requesting the removed name is a harmless no-op
  const explicit = buildPatternSet({ builtin: ['china_phone', 'phone'] });
  assert.strictEqual(explicit.regex.length, 1);
  assert.strictEqual(explicit.regex[0].category, 'PHONE');
});

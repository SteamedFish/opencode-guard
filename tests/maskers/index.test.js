import { test } from 'node:test';
import assert from 'node:assert';
import { maskValue, hasBuiltinMasker } from '../../src/maskers/index.js';
import { buildPatternSet } from '../../src/patterns.js';
import { MaskSession } from '../../src/session.js';
import { restoreText } from '../../src/restore.js';

const SALT = 'index-test-salt';

test('every builtin pattern maskAs has a dedicated masker (no default fallthrough)', () => {
  // Table-driven: import the builtin rules and assert each rule's maskAs
  // hits a real dispatch-table entry instead of the auto-detect fallback.
  const { regex } = buildPatternSet({});
  assert.ok(regex.length > 0, 'expected builtin patterns to be loaded');

  const seen = new Set();
  for (const rule of regex) {
    seen.add(rule.maskAs);
    assert.ok(
      hasBuiltinMasker(rule.maskAs),
      `builtin pattern "${rule.pattern?.slice(0, 40)}..." emits maskAs "${rule.maskAs}" with no dedicated masker (would fall to default auto-detect)`
    );
  }
  // Sanity: the known set of builtin maskAs values is covered
  for (const expected of ['email', 'pattern', 'uuid', 'ipv4', 'ipv6', 'mac_address',
    'basic_auth_url', 'basic_auth_header', 'db_connection', 'generic_credential', 'password']) {
    assert.ok(seen.has(expected), `expected builtin maskAs "${expected}" to be present in patterns`);
  }
});

test('maskValue with basic_auth_url masks credentials, keeps URL shape', () => {
  const url = 'https://deploy-user:s3cret-pass@ci.internal.example:8443/artifacts';
  const masked = maskValue(url, 'BASIC_AUTH_URL', 'basic_auth_url', SALT);

  assert.notStrictEqual(masked, url, 'basic_auth_url must not fall through to auto-detect');
  assert.ok(masked.startsWith('https://'), 'protocol preserved');
  assert.ok(masked.includes('@ci.internal.example:8443/artifacts'), 'host/path preserved');
  assert.ok(!masked.includes('deploy-user'), 'username masked');
  assert.ok(!masked.includes('s3cret-pass'), 'password masked');
  // Must NOT have been mangled into something else (e.g. a fake email)
  assert.ok(/^https:\/\/[^:]+:[^@]+@/.test(masked), 'still looks like a basic-auth URL');
});

test('maskValue with basic_auth_header masks the base64 payload', () => {
  // Build the header at runtime so the literal is exactly what we expect
  const header = 'Basic ' + Buffer.from('test-user:s3cret-password').toString('base64');
  const masked = maskValue(header, 'BASIC_AUTH_HEADER', 'basic_auth_header', SALT);

  assert.notStrictEqual(masked, header);
  assert.ok(masked.startsWith('Basic '), 'Basic scheme preserved');
  assert.strictEqual(masked.length, header.length, 'length preserved');
  assert.ok(/^[A-Za-z0-9+/]+=*$/.test(masked.slice('Basic '.length)), 'still base64-shaped');
});

test('maskValue handles mixed-case database scheme (PostgreSQL://)', () => {
  const conn = 'PostgreSQL://svc_user:SuperSecret123@db.example.com:5432/prod';
  const masked = maskValue(conn, 'DB_CONNECTION', 'db_connection', SALT);

  assert.notStrictEqual(masked, conn, 'mixed-case scheme must be parsed and masked');
  assert.ok(masked.startsWith('PostgreSQL://'), 'scheme preserved');
  assert.ok(masked.includes('@db.example.com:5432/prod'), 'host/db preserved');
  assert.ok(!masked.includes('svc_user'), 'username masked');
  assert.ok(!masked.includes('SuperSecret123'), 'password masked');
});

test('mixed-case database connection round-trips through session restore', () => {
  const session = new MaskSession(SALT, { ttlMs: 3600000, maxMappings: 1000 });
  const conn = 'PostgreSQL://svc_user:SuperSecret123@db.example.com:5432/prod';

  const masked = session.getOrCreateMasked(conn, 'DB_CONNECTION', 'db_connection');
  assert.notStrictEqual(masked, conn);

  const restored = restoreText(`connect: ${masked}`, session);
  assert.strictEqual(restored, `connect: ${conn}`);
});

test('maskValue attempt parameter changes output only when > 0', () => {
  const value = 'some-secret-value';
  const base = maskValue(value, 'SECRET', 'pattern', SALT);

  assert.strictEqual(maskValue(value, 'SECRET', 'pattern', SALT, 0), base, 'attempt=0 is the default deterministic output');
  assert.strictEqual(maskValue(value, 'SECRET', 'pattern', SALT), base, 'omitted attempt equals attempt=0');
  assert.notStrictEqual(maskValue(value, 'SECRET', 'pattern', SALT, 1), base, 'attempt=1 derives a different value');
  assert.notStrictEqual(maskValue(value, 'SECRET', 'pattern', SALT, 2), base, 'attempt=2 derives a different value');
});

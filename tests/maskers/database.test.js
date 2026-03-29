import { test } from 'node:test';
import assert from 'node:assert';
import { maskDatabaseConn, isDatabaseConn } from '../../src/maskers/database.js';
import { createSeededRNG } from '../../src/utils.js';

test('isDatabaseConn should detect PostgreSQL connection strings', () => {
  assert.strictEqual(isDatabaseConn('postgresql://user:pass@localhost:5432/db'), true);
  assert.strictEqual(isDatabaseConn('postgres://admin:secret@db.example.com/mydb'), true);
});

test('isDatabaseConn should detect MySQL connection strings', () => {
  assert.strictEqual(isDatabaseConn('mysql://user:pass@localhost:3306/db'), true);
  assert.strictEqual(isDatabaseConn('mysql2://root:password@127.0.0.1/database'), true);
});

test('isDatabaseConn should detect MongoDB connection strings', () => {
  assert.strictEqual(isDatabaseConn('mongodb://user:pass@localhost:27017/db'), true);
  assert.strictEqual(isDatabaseConn('mongodb+srv://admin:secret@cluster.mongodb.net'), true);
});

test('isDatabaseConn should detect Redis connection strings', () => {
  assert.strictEqual(isDatabaseConn('redis://user:pass@localhost:6379'), true);
});

test('isDatabaseConn should not match URLs without credentials', () => {
  assert.strictEqual(isDatabaseConn('postgresql://localhost:5432/db'), false);
  assert.strictEqual(isDatabaseConn('mysql://localhost/database'), false);
});

test('isDatabaseConn should not match non-database URLs', () => {
  assert.strictEqual(isDatabaseConn('https://example.com'), false);
  assert.strictEqual(isDatabaseConn('http://user:pass@example.com'), false);
});

test('isDatabaseConn should detect MariaDB connections', () => {
  assert.strictEqual(isDatabaseConn('mariadb://user:pass@localhost/db'), true);
});

test('maskDatabaseConn should mask PostgreSQL connection string', () => {
  const rng = createSeededRNG('test-seed');
  const conn = 'postgresql://admin:secret123@localhost:5432/mydb';
  const masked = maskDatabaseConn(conn, rng);
  assert.ok(/^postgresql:\/\/[^:]+:[^@]+@localhost:5432\/mydb$/.test(masked));
  assert.ok(!masked.includes('admin'));
  assert.ok(!masked.includes('secret123'));
});

test('maskDatabaseConn should mask MongoDB connection string with options', () => {
  const rng = createSeededRNG('test-seed');
  const conn = 'mongodb+srv://dbuser:dbpass@cluster0.mongodb.net/mydb?retryWrites=true';
  const masked = maskDatabaseConn(conn, rng);
  assert.ok(/^mongodb\+srv:\/\/[^:]+:[^@]+@cluster0\.mongodb\.net\/mydb\?retryWrites=true$/.test(masked));
  assert.ok(!masked.includes('dbuser'));
  assert.ok(!masked.includes('dbpass'));
});

test('maskDatabaseConn should handle empty password', () => {
  const rng = createSeededRNG('test-seed');
  const conn = 'postgresql://admin:@localhost/db';
  const masked = maskDatabaseConn(conn, rng);
  assert.ok(/^postgresql:\/\/[^:]+:@localhost\/db$/.test(masked));
});

test('maskDatabaseConn should preserve username and password lengths', () => {
  const rng = createSeededRNG('test-seed');
  const conn = 'mysql://root:password123@localhost/db';
  const masked = maskDatabaseConn(conn, rng);
  const match = masked.match(/^mysql:\/\/([^:]+):([^@]+)@/);
  assert.strictEqual(match[1].length, 4);
  assert.strictEqual(match[2].length, 11);
});

test('maskDatabaseConn should return unchanged if no credentials present', () => {
  const rng = createSeededRNG('test-seed');
  const conn = 'postgresql://localhost:5432/db';
  assert.strictEqual(maskDatabaseConn(conn, rng), conn);
});

test('maskDatabaseConn should be deterministic with same seed', () => {
  const rng1 = createSeededRNG('same-seed');
  const rng2 = createSeededRNG('same-seed');
  const conn = 'postgresql://user:pass@localhost/db';
  const masked1 = maskDatabaseConn(conn, rng1);
  const masked2 = maskDatabaseConn(conn, rng2);
  assert.strictEqual(masked1, masked2);
});

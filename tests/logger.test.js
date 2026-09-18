import { test } from 'node:test';
import assert from 'node:assert';
import { createLogger } from '../src/logger.js';
import { existsSync } from 'node:fs';
import { readFile, unlink } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

/** Wait until predicate is true or timeout (used for fire-and-forget appends). */
async function waitFor(predicate, timeoutMs = 2000) {
  const start = Date.now();
  while (Date.now() - start < timeoutMs) {
    if (await predicate()) return true;
    await new Promise((resolve) => setTimeout(resolve, 20));
  }
  return false;
}

test('logger is a no-op when debug is false (no file created even with debugFile)', async () => {
  const file = join(tmpdir(), `opencode-guard-logger-test-${Date.now()}-noop.log`);
  const logger = createLogger({ debug: false, debugFile: file });

  logger.log('should not appear');
  logger.warn('should not appear either');

  await new Promise((resolve) => setTimeout(resolve, 100));
  assert.strictEqual(logger.enabled, false);
  assert.strictEqual(logger.fileEnabled, false);
  assert.strictEqual(existsSync(file), false, 'log file must not be created when debug is off');
});

test('logger appends to file with ISO timestamp when debug and debugFile are set', async () => {
  const file = join(tmpdir(), `opencode-guard-logger-test-${Date.now()}-append.log`);
  const logger = createLogger({ debug: true, debugFile: file });

  try {
    assert.strictEqual(logger.fileEnabled, true);
    logger.log('hello debug world');

    const written = await waitFor(async () => {
      if (!existsSync(file)) return false;
      const content = await readFile(file, 'utf-8');
      return content.includes('hello debug world');
    });
    assert.ok(written, 'log file should be created and contain the message');

    const content = await readFile(file, 'utf-8');
    assert.ok(content.includes('hello debug world'), 'file should contain the message');
    assert.match(content, /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z hello debug world\n$/, 'line should have an ISO timestamp prefix');
  } finally {
    await unlink(file).catch(() => {});
  }
});

test('logger appends warn lines to file as well', async () => {
  const file = join(tmpdir(), `opencode-guard-logger-test-${Date.now()}-warn.log`);
  const logger = createLogger({ debug: true, debugFile: file });

  try {
    logger.warn('warning line');

    const written = await waitFor(async () => {
      if (!existsSync(file)) return false;
      const content = await readFile(file, 'utf-8');
      return content.includes('warning line');
    });
    assert.ok(written, 'warn line should be appended to the file');
  } finally {
    await unlink(file).catch(() => {});
  }
});

test('logger does not throw on unwritable debug file path', async () => {
  const logger = createLogger({ debug: true, debugFile: '/nonexistent-dir-og/x.log' });

  assert.strictEqual(logger.fileEnabled, true);
  assert.doesNotThrow(() => {
    logger.log('this must not throw');
    logger.warn('neither must this');
  });

  // Fire-and-forget append failure must be swallowed asynchronously
  await new Promise((resolve) => setTimeout(resolve, 200));
  assert.strictEqual(existsSync('/nonexistent-dir-og/x.log'), false);
});

test('logger joins multiple arguments and inspects non-strings', async () => {
  const file = join(tmpdir(), `opencode-guard-logger-test-${Date.now()}-multi.log`);
  const logger = createLogger({ debug: true, debugFile: file });

  try {
    logger.log('part1', 'part2', { a: 1 });

    const written = await waitFor(async () => {
      if (!existsSync(file)) return false;
      const content = await readFile(file, 'utf-8');
      return content.includes('part1 part2') && content.includes('{ a: 1 }');
    });
    assert.ok(written, 'multiple args should be joined with space and objects inspected');
  } finally {
    await unlink(file).catch(() => {});
  }
});

test('logger expands leading ~ to home directory', () => {
  const logger = createLogger({ debug: true, debugFile: '~/guard-test.log' });
  assert.ok(!logger.debugFile.startsWith('~'), 'tilde should be expanded');
  assert.ok(logger.debugFile.endsWith('guard-test.log'));
});

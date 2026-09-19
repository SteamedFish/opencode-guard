import { test } from 'node:test';
import assert from 'node:assert';
import { AIDetector } from '../../src/ai-detector/index.js';

/**
 * Build an AIDetector with a stubbed, already-initialized provider. Avoids
 * loading transformers/model weights in unit tests.
 * @param {Function} detect - provider.detect implementation
 * @returns {AIDetector}
 */
function stubDetector(detect) {
  const detector = new AIDetector({});
  detector.initialized = true;
  detector.provider = { detect };
  return detector;
}

test('AIDetector expands a single flagged value to all occurrences', async () => {
  const text = 'reach me at qyrk@example.com, or qyrk@example.com.';
  const first = text.indexOf('qyrk@example.com');
  const detector = stubDetector(async () => [
    { start: first, end: first + 16, value: 'qyrk@example.com', type: 'EMAIL', score: 0.9 },
  ]);

  const out = await detector.detect(text);

  assert.strictEqual(out.length, 2);
  assert.deepStrictEqual(
    out.map(r => r.start).sort((a, b) => a - b),
    [text.indexOf('qyrk@example.com'), text.indexOf('qyrk@example.com', first + 1)].sort((a, b) => a - b)
  );
  for (const r of out) {
    assert.strictEqual(r.text, 'qyrk@example.com');
    assert.strictEqual(r.category, 'EMAIL');
    assert.strictEqual(r.maskAs, 'pattern');
  }
});

test('AIDetector derives text from offsets when the provider omits value', async () => {
  const text = 'x leqo@example.com y leqo@example.com';
  const first = text.indexOf('leqo@example.com');
  const detector = stubDetector(async () => [
    { start: first, end: first + 16, type: 'EMAIL', score: 0.8 },
  ]);

  const out = await detector.detect(text);

  assert.strictEqual(out.length, 2);
  for (const r of out) {
    assert.strictEqual(r.text, 'leqo@example.com');
    assert.strictEqual(text.slice(r.start, r.end), 'leqo@example.com');
  }
});

test('AIDetector returns an empty array when the provider throws', async () => {
  const detector = stubDetector(async () => {
    throw new Error('provider exploded');
  });

  assert.deepStrictEqual(await detector.detect('anything'), []);
});

test('AIDetector does not expand a value embedded in a longer ASCII word', async () => {
  const text = 'John met Johnson';
  const detector = stubDetector(async () => [
    { start: 0, end: 4, value: 'John', type: 'PERSON', score: 0.9 },
  ]);

  const out = await detector.detect(text);

  assert.strictEqual(out.length, 1);
  assert.strictEqual(out[0].text, 'John');
});

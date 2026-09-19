import { test } from 'node:test';
import assert from 'node:assert';
import { expandFlaggedOccurrences } from '../../src/ai-detector/expand.js';

function span(start, end, text) {
  return { start, end, text, category: 'EMAIL', maskAs: 'email', confidence: 0.9, source: 'ai' };
}

test('expandFlaggedOccurrences adds every whole-token occurrence of a flagged value', () => {
  const text = 'reach me at ktal@example.com, or ktal@example.com.';
  const first = text.indexOf('ktal@example.com');
  const second = text.indexOf('ktal@example.com', first + 1);
  const input = [span(first, first + 'ktal@example.com'.length, 'ktal@example.com')];

  const out = expandFlaggedOccurrences(text, input);

  assert.strictEqual(out.length, 2);
  assert.deepStrictEqual(out.map(r => r.start).sort((a, b) => a - b), [first, second].sort((a, b) => a - b));
  for (const r of out) {
    assert.strictEqual(text.slice(r.start, r.end), 'ktal@example.com');
    assert.strictEqual(r.category, 'EMAIL');
    assert.strictEqual(r.maskAs, 'email');
    assert.strictEqual(r.confidence, 0.9);
  }
});

test('expandFlaggedOccurrences does not expand a substring inside a longer ASCII word', () => {
  const text = 'John met Johnson';
  const out = expandFlaggedOccurrences(text, [span(0, 4, 'John')]);

  assert.strictEqual(out.length, 1, 'the John inside Johnson must not be expanded');
});

test('expandFlaggedOccurrences keeps an anchor span that itself sits inside a word', () => {
  const text = 'Johnson';
  const anchor = span(0, 4, 'John');
  const out = expandFlaggedOccurrences(text, [anchor]);

  assert.strictEqual(out.length, 1);
  assert.strictEqual(out[0], anchor, 'the original span object is preserved');
});

test('expandFlaggedOccurrences is case-sensitive', () => {
  const text = 'Alice and alice';
  const out = expandFlaggedOccurrences(text, [span(0, 5, 'Alice')]);

  assert.strictEqual(out.length, 1);
});

test('expandFlaggedOccurrences does not expand a digit run embedded in a longer word', () => {
  const text = 'call 1234567890 now, ref1234567890x';
  const start = text.indexOf('1234567890');
  const out = expandFlaggedOccurrences(text, [span(start, start + 10, '1234567890')]);

  assert.strictEqual(out.length, 1, 'the digit run inside ref...x must not be expanded');
});

test('expandFlaggedOccurrences does not mutate its inputs', () => {
  const text = 'a a@b.com b a@b.com';
  const anchor = span(text.indexOf('a@b.com'), text.indexOf('a@b.com') + 7, 'a@b.com');
  const input = [anchor];

  const out = expandFlaggedOccurrences(text, input);

  assert.strictEqual(input.length, 1, 'input array must be untouched');
  assert.strictEqual(out[0], anchor, 'original span object must be reused');
  assert.notStrictEqual(out, input, 'a new array is returned');
});

test('expandFlaggedOccurrences expands multiple distinct spans independently', () => {
  const text = 'a@b.com then c@d.com then a@b.com then c@d.com';
  const a1 = text.indexOf('a@b.com');
  const c1 = text.indexOf('c@d.com');
  const out = expandFlaggedOccurrences(text, [
    span(a1, a1 + 7, 'a@b.com'),
    span(c1, c1 + 7, 'c@d.com'),
  ]);

  assert.strictEqual(out.length, 4);
  assert.deepStrictEqual(
    out.map(r => r.text).sort(),
    ['a@b.com', 'a@b.com', 'c@d.com', 'c@d.com']
  );
});

test('expandFlaggedOccurrences returns inputs unchanged for empty/invalid input', () => {
  const input = [span(0, 4, 'John')];
  assert.strictEqual(expandFlaggedOccurrences('', input), input);
  assert.strictEqual(expandFlaggedOccurrences(null, input), input);
  assert.deepStrictEqual(expandFlaggedOccurrences('text', []), []);
  assert.strictEqual(expandFlaggedOccurrences('text', null), null);
});

test('expandFlaggedOccurrences passes through spans without a usable text', () => {
  const text = 'anything';
  const anchor = { start: 0, end: 8, category: 'EMAIL', maskAs: 'email' };
  const out = expandFlaggedOccurrences(text, [anchor]);

  assert.strictEqual(out.length, 1);
  assert.strictEqual(out[0], anchor);
});

test('expandFlaggedOccurrences expands across non-ASCII adjacency (ASCII-only boundary)', () => {
  const value = 'ktal@example.com';
  const text = `联系${value} 备用${value}`;
  const first = text.indexOf(value);
  const second = text.indexOf(value, first + 1);
  // Anchor the SECOND occurrence so the first is the one being expanded, and
  // it is preceded by a non-ASCII character (must not block expansion).
  const out = expandFlaggedOccurrences(text, [span(second, second + value.length, value)]);

  assert.strictEqual(text[first - 1], '系');
  assert.strictEqual(out.length, 2);
  assert.deepStrictEqual(out.map(r => r.start).sort((a, b) => a - b), [first, second]);
});

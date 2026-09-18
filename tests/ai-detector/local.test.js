import { test } from 'node:test';
import assert from 'node:assert';
import { LocalAIProvider } from '../../src/ai-detector/providers/local.js';

// These tests run for real when @huggingface/transformers is installed (and the
// model is downloadable/cached); they skip when the package is missing or the
// model cannot load (offline CI must stay green). Probe sentences use
// street-address PII, which the default Piiranha ONNX model detects reliably;
// credentials/emails are NOT reliably detected by it.

/**
 * Build a provider and initialize it, skipping the test if unavailable.
 * @returns {Promise<LocalAIProvider|null>} initialized provider or null when skipped
 */
async function readyProvider(t) {
  const provider = new LocalAIProvider({});
  if (!(await provider.isAvailable())) {
    t.skip('@huggingface/transformers not installed');
    return null;
  }
  try {
    await provider.initialize();
  } catch (err) {
    t.skip(`local model unavailable (offline?): ${err.message}`);
    return null;
  }
  return provider;
}

test('LocalAIProvider detects street address PII', async (t) => {
  const provider = await readyProvider(t);
  if (!provider) return;

  const text = 'Hi, my name is John Smith and I live at 742 Evergreen Terrace, Springfield';
  const results = await provider.detect(text);

  assert.ok(results.length > 0, 'Should detect at least one sensitive item');

  // Every result must carry valid char offsets that slice back the exact
  // original substring (the engine masks by offsets).
  for (const r of results) {
    assert.ok(Number.isInteger(r.start) && Number.isInteger(r.end), `offsets must be integers: ${JSON.stringify(r)}`);
    assert.ok(r.start >= 0 && r.end > r.start && r.end <= text.length, `offsets in range: ${JSON.stringify(r)}`);
    assert.strictEqual(text.slice(r.start, r.end), r.value, `value must equal text.slice(start, end): ${JSON.stringify(r)}`);
  }

  const categories = new Set(results.map(r => r.type));
  assert.ok(
    categories.has('STREET_ADDRESS') || categories.has('CITY') || categories.has('BUILDING_NUMBER'),
    `expected an address-category detection, got: ${[...categories].join(', ')}`
  );
});

test('LocalAIProvider detects PII in second address phrasing', async (t) => {
  const provider = await readyProvider(t);
  if (!provider) return;

  const text = 'Send the invoice to 1600 Amphitheatre Parkway, Mountain View';
  const results = await provider.detect(text);

  assert.ok(results.length > 0, 'Should detect at least one sensitive item');
  for (const r of results) {
    assert.strictEqual(text.slice(r.start, r.end), r.value, `value must equal text.slice(start, end): ${JSON.stringify(r)}`);
  }
});

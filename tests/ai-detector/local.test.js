import { test } from 'node:test';
import assert from 'node:assert';
import { LocalAIProvider } from '../../src/ai-detector/providers/local.js';

test('LocalAIProvider detects password in sentence', async () => {
  const provider = new LocalAIProvider({});
  
  if (!(await provider.isAvailable())) {
    console.log('Skipping: Transformers.js not installed');
    return;
  }
  
  await provider.initialize();
  
  const text = 'My password is secret123xyz';
  const results = await provider.detect(text);
  
  assert.ok(results.length > 0, 'Should detect at least one sensitive item');
});

test('LocalAIProvider detects API key in code', async () => {
  const provider = new LocalAIProvider({});
  
  if (!(await provider.isAvailable())) {
    console.log('Skipping: Transformers.js not installed');
    return;
  }
  
  await provider.initialize();
  
  const text = 'const apiKey = "sk-rbh833mun809voe754"';
  const results = await provider.detect(text);
  
  assert.ok(results.length > 0);
});

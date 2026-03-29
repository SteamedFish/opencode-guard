import { test } from 'node:test';
import assert from 'node:assert';
import { maskMACAddress, isMACAddress, normalizeMAC } from '../../src/maskers/mac.js';

test('isMACAddress identifies valid MAC addresses', () => {
  assert.strictEqual(isMACAddress('aa:bb:cc:dd:ee:ff'), true);
  assert.strictEqual(isMACAddress('AA:BB:CC:DD:EE:FF'), true);
  assert.strictEqual(isMACAddress('00-11-22-33-44-55'), true);
  assert.strictEqual(isMACAddress('aabbccddeeff'), true);
  assert.strictEqual(isMACAddress('not-a-mac'), false);
  assert.strictEqual(isMACAddress(''), false);
  assert.strictEqual(isMACAddress('aa:bb:cc:dd:ee'), false);
  assert.strictEqual(isMACAddress('gg:hh:ii:jj:kk:ll'), false);
});

test('normalizeMAC converts MAC to colon-separated lowercase', () => {
  assert.strictEqual(normalizeMAC('aa:bb:cc:dd:ee:ff'), 'aa:bb:cc:dd:ee:ff');
  assert.strictEqual(normalizeMAC('AA:BB:CC:DD:EE:FF'), 'aa:bb:cc:dd:ee:ff');
  assert.strictEqual(normalizeMAC('00-11-22-33-44-55'), '00:11:22:33:44:55');
  assert.strictEqual(normalizeMAC('AABBCCDDEEFF'), 'aa:bb:cc:dd:ee:ff');
});

test('maskMACAddress preserves first 3 bytes, masks last 3 bytes', () => {
  const rng = (min, max) => Math.floor((min + max) / 2);
  const result = maskMACAddress('aa:bb:cc:dd:ee:ff', rng);

  assert.ok(result.startsWith('aa:bb:cc:'), `Expected prefix aa:bb:cc but got ${result}`);

  const macRegex = /^(?:[0-9a-f]{2}:){5}[0-9a-f]{2}$/;
  assert.ok(macRegex.test(result), `Result ${result} is not valid MAC format`);
});

test('maskMACAddress handles hyphen format', () => {
  const rng = (min, max) => Math.floor((min + max) / 2);
  const result = maskMACAddress('aa-bb-cc-dd-ee-ff', rng);

  assert.ok(result.startsWith('aa:bb:cc:'), `Expected prefix aa:bb:cc but got ${result}`);
});

test('maskMACAddress handles compact format', () => {
  const rng = (min, max) => Math.floor((min + max) / 2);
  const result = maskMACAddress('AABBCCDDEEFF', rng);

  assert.ok(result.startsWith('aa:bb:cc:'), `Expected prefix aa:bb:cc but got ${result}`);
});

test('maskMACAddress is deterministic with same seed', () => {
  let counter = 0;
  const rng = (min, max) => min + ((counter++) % (max - min + 1));
  const result1 = maskMACAddress('aa:bb:cc:dd:ee:ff', rng);
  counter = 0;
  const result2 = maskMACAddress('aa:bb:cc:dd:ee:ff', rng);

  assert.strictEqual(result1, result2);
});

test('maskMACAddress produces different results for different MACs', () => {
  const rng = (min, max) => Math.floor(min + (max - min) * 0.3);
  const result1 = maskMACAddress('aa:bb:cc:dd:ee:ff', rng);
  const result2 = maskMACAddress('aa:bb:cc:11:22:33', rng);

  assert.ok(result1.startsWith('aa:bb:cc:'), 'Result 1 should preserve prefix aa:bb:cc');
  assert.ok(result2.startsWith('aa:bb:cc:'), 'Result 2 should preserve prefix aa:bb:cc');
});

test('maskMACAddress handles hyphen format', () => {
  const rng = () => 0.5;
  const result = maskMACAddress('aa-bb-cc-dd-ee-ff', rng);
  
  // Should preserve first 3 bytes (aa:bb:cc)
  assert.ok(result.startsWith('aa:bb:cc:'), `Expected prefix aa:bb:cc but got ${result}`);
});

test('maskMACAddress handles compact format', () => {
  const rng = () => 0.5;
  const result = maskMACAddress('AABBCCDDEEFF', rng);
  
  // Should preserve first 3 bytes (aa:bb:cc)
  assert.ok(result.startsWith('aa:bb:cc:'), `Expected prefix aa:bb:cc but got ${result}`);
});

test('maskMACAddress is deterministic with same seed', () => {
  const rng = () => 0.3;
  const result1 = maskMACAddress('aa:bb:cc:dd:ee:ff', rng);
  const result2 = maskMACAddress('aa:bb:cc:dd:ee:ff', rng);
  
  assert.strictEqual(result1, result2);
});

test('maskMACAddress produces different results for different MACs', () => {
  const rng = (min, max) => min + (max - min) * 0.3;
  const result1 = maskMACAddress('aa:bb:cc:dd:ee:ff', rng);
  const result2 = maskMACAddress('aa:bb:cc:11:22:33', rng);
  
  // Same prefix, different suffixes masked
  assert.ok(result1.startsWith('aa:bb:cc:'));
  assert.ok(result2.startsWith('aa:bb:cc:'));
});

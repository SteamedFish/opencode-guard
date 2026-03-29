import { test } from 'node:test';
import assert from 'node:assert';
import { maskIPv4, maskIPv6, isIPv4, isIPv6 } from '../../src/maskers/ip.js';

test('maskIPv4 keeps /16 prefix, masks host portion', () => {
  const rng = (min, max) => Math.floor((min + max) / 2);
  const result = maskIPv4('192.168.1.100', rng);
  
  // Should keep first two octets (network prefix)
  assert.ok(result.startsWith('192.168.'), `Expected to start with 192.168., got ${result}`);
  
  // Check format
  const parts = result.split('.');
  assert.strictEqual(parts.length, 4);
  
  // Check last two octets are masked (different from original)
  assert.notStrictEqual(parts[2], '1');
  assert.notStrictEqual(parts[3], '100');
  
  // Check each part is valid
  for (const part of parts) {
    const num = parseInt(part, 10);
    assert.ok(num >= 0 && num <= 255);
  }
});

test('maskIPv4 keeps private IP range intact', () => {
  const rng = (min, max) => 50;
  
  // Private ranges should stay private
  const private1 = maskIPv4('192.168.5.20', rng);
  assert.ok(private1.startsWith('192.168.'), 'Should keep 192.168.x.x private range');
  
  const private2 = maskIPv4('10.0.100.50', rng);
  assert.ok(private2.startsWith('10.0.'), 'Should keep 10.0.x.x private range');
  
  const private3 = maskIPv4('172.16.25.30', rng);
  assert.ok(private3.startsWith('172.16.'), 'Should keep 172.16.x.x private range');
});

test('maskIPv4 produces different masked hosts', () => {
  const rng1 = (min, max) => min + 10;
  const rng2 = (min, max) => max - 10;
  
  const result1 = maskIPv4('192.168.1.1', rng1);
  const result2 = maskIPv4('192.168.1.1', rng2);
  
  // Last two octets should be different
  const parts1 = result1.split('.');
  const parts2 = result2.split('.');
  assert.notStrictEqual(parts1[2], parts2[2]);
});

test('isIPv4 correctly identifies IPv4 addresses', () => {
  assert.strictEqual(isIPv4('192.168.1.1'), true);
  assert.strictEqual(isIPv4('10.0.0.1'), true);
  assert.strictEqual(isIPv4('256.1.1.1'), false);
  assert.strictEqual(isIPv4('not-an-ip'), false);
});

test('isIPv6 correctly identifies IPv6 addresses', () => {
  assert.strictEqual(isIPv6('::1'), true);
  assert.strictEqual(isIPv6('fe80::1'), true);
  assert.strictEqual(isIPv6('2001:db8::1'), true);
  assert.strictEqual(isIPv6('192.168.1.1'), false);
});

test('maskIPv6 keeps /64 prefix, masks interface ID', () => {
  const rng = (min, max) => Math.floor((min + max) / 2);
  const result = maskIPv6('2001:db8:85a3::8a2e:370:7334', rng);
  
  // Should keep first 4 groups (network prefix)
  assert.ok(result.startsWith('2001:db8:85a3:'), `Expected to keep network prefix, got ${result}`);
  
  // Interface ID should be masked
  assert.ok(!result.includes('8a2e:370:7334'), 'Should mask interface ID');
});

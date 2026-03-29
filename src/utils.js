import { createHmac } from 'node:crypto';

/**
 * Generate HMAC-SHA256 hash
 * @param {string} salt
 * @param {string} value
 * @returns {string} hex string
 */
export function generateHmacHash(salt, value) {
  const hmac = createHmac('sha256', salt);
  hmac.update(String(value));
  return hmac.digest('hex');
}

/**
 * Create a seeded random number generator
 * Uses xorshift128+ algorithm seeded with HMAC hash
 * @param {string} seed
 * @returns {Function} (min, max) => random integer in [min, max]
 */
export function createSeededRNG(seed) {
  // Convert seed string to 64-bit integers
  const hash = generateHmacHash('rng-seed', seed);
  let s1 = BigInt('0x' + hash.slice(0, 16));
  let s0 = BigInt('0x' + hash.slice(16, 32));
  
  // xorshift128+
  return function random(min = 0, max = 1) {
    let x = s0;
    let y = s1;
    s0 = x;
    x ^= x << BigInt(23);
    s1 = x ^ y ^ (x >> BigInt(17)) ^ (y >> BigInt(26));
    
    // Convert to number in range [min, max]
    const uint64_max = BigInt('0xFFFFFFFFFFFFFFFF');
    const normalized = Number(s1 % uint64_max) / Number(uint64_max);
    return Math.floor(normalized * (max - min + 1)) + min;
  };
}

/**
 * Sanitize category name: uppercase, replace invalid chars with underscore
 * @param {string} input
 * @returns {string}
 */
export function sanitizeCategory(input) {
  const raw = String(input ?? '').trim();
  if (!raw) return 'TEXT';
  const upper = raw.toUpperCase();
  const safe = upper.replace(/[^A-Z0-9_]/g, '_').replace(/_+/g, '_');
  if (!safe) return 'TEXT';
  return safe;
}

/**
 * Generate random string with given length and character set
 * @param {Function} rng - Seeded RNG function
 * @param {number} length
 * @param {string} chars - Character set
 * @returns {string}
 */
export function randomString(rng, length, chars) {
  let result = '';
  for (let i = 0; i < length; i++) {
    result += chars[rng(0, chars.length - 1)];
  }
  return result;
}

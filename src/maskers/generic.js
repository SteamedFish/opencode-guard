import { randomString } from '../utils.js';

const LOWERCASE = 'abcdefghijklmnopqrstuvwxyz';
const UPPERCASE = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ';
const DIGITS = '0123456789';
const ALPHANUMERIC = LOWERCASE + UPPERCASE + DIGITS;

/**
 * Generic masker with fixed length
 * @param {string} value - Original value (ignored, just for seeding)
 * @param {number} length - Target length
 * @param {Function} rng
 * @param {string} prefix - Optional prefix
 * @returns {string}
 */
export function maskGeneric(value, length, rng, prefix = 'masked_') {
  const targetLength = Math.max(length - prefix.length, 8);
  const masked = randomString(rng, targetLength, ALPHANUMERIC);
  return `${prefix}${masked}`;
}

/**
 * Mask while preserving character pattern (uppercase stays uppercase, etc.)
 * @param {string} value
 * @param {Function} rng
 * @returns {string}
 */
export function maskWithPattern(value, rng) {
  return Array.from(value).map(char => {
    if (/[a-z]/.test(char)) {
      return randomString(rng, 1, LOWERCASE);
    } else if (/[A-Z]/.test(char)) {
      return randomString(rng, 1, UPPERCASE);
    } else if (/[0-9]/.test(char)) {
      return randomString(rng, 1, DIGITS);
    } else {
      // Preserve special characters as-is
      return char;
    }
  }).join('');
}

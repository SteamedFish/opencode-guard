import { randomString } from '../utils.js';

const HEX = '0123456789abcdef';
const UUID_V4_VARIANT = '89ab'; // Valid variant for UUID v4

/**
 * Mask UUID with valid UUID v4
 * @param {string} uuid
 * @param {Function} rng
 * @returns {string}
 */
export function maskUUID(uuid, rng) {
  // UUID v4 format: xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx
  // where 4 is the version and y is 8, 9, a, or b
  
  const part1 = randomString(rng, 8, HEX);
  const part2 = randomString(rng, 4, HEX);
  const part3 = '4' + randomString(rng, 3, HEX); // Version 4
  const part4 = randomString(rng, 1, UUID_V4_VARIANT) + randomString(rng, 3, HEX);
  const part5 = randomString(rng, 12, HEX);
  
  return `${part1}-${part2}-${part3}-${part4}-${part5}`;
}

/**
 * Check if value is valid UUID
 * @param {string} value
 * @returns {boolean}
 */
export function isUUID(value) {
  const uuidRegex = /^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[1-5][0-9a-fA-F]{3}-[89abAB][0-9a-fA-F]{3}-[0-9a-fA-F]{12}$/;
  return uuidRegex.test(value);
}

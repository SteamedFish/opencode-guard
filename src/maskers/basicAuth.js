import { randomString } from '../utils.js';

const ALPHANUMERIC = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789';
const URL_SAFE = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789_-.';

/**
 * Mask HTTP Basic Auth credentials in URL
 * Format: protocol://username:password@host/path
 * @param {string} url
 * @param {Function} rng
 * @returns {string}
 */
export function maskBasicAuth(url, rng) {
  // Match protocol://username:password@host pattern
  const match = url.match(/^(https?:\/\/)([^:]+):([^@]+)@(.+)$/);
  if (!match) return url;

  const [, protocol, username, password, rest] = match;
  const maskedUsername = randomString(rng, username.length, URL_SAFE);
  const maskedPassword = randomString(rng, password.length, ALPHANUMERIC);

  return `${protocol}${maskedUsername}:${maskedPassword}@${rest}`;
}

/**
 * Check if URL contains HTTP Basic Auth credentials
 * @param {string} value
 * @returns {boolean}
 */
export function hasBasicAuth(value) {
  return /^https?:\/\/[^:]+:[^@]+@.+$/.test(value);
}

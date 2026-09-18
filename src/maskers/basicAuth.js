import { randomString } from '../utils.js';

const ALPHANUMERIC = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789';
const URL_SAFE = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789_-.';

const BASE64_CHARS = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/';

/**
 * Mask HTTP Basic Auth credentials
 * Supported formats:
 *   - URL:    protocol://username:password@host/path
 *   - Header: Basic <base64>
 * @param {string} url
 * @param {Function} rng
 * @returns {string}
 */
export function maskBasicAuth(url, rng) {
  // Authorization header form: "Basic <base64>" (case-insensitive scheme)
  const headerMatch = url.match(/^(Basic\s+)([A-Za-z0-9+/]+=*)$/i);
  if (headerMatch) {
    const [, scheme, encoded] = headerMatch;
    let maskedEncoded = '';
    for (const ch of encoded) {
      // Keep padding so the masked value still looks like valid base64
      maskedEncoded += ch === '=' ? '=' : randomString(rng, 1, BASE64_CHARS);
    }
    return `${scheme}${maskedEncoded}`;
  }

  // Match protocol://username:password@host pattern
  // Case-insensitive scheme for consistency with hasBasicAuth() and the detector
  const match = url.match(/^(https?:\/\/)([^:]+):([^@]+)@(.+)$/i);
  if (!match) return url;

  const [, protocol, username, password, rest] = match;
  const maskedUsername = randomString(rng, username.length, URL_SAFE);
  const maskedPassword = randomString(rng, password.length, ALPHANUMERIC);

  return `${protocol}${maskedUsername}:${maskedPassword}@${rest}`;
}

/**
 * Check if value contains HTTP Basic Auth credentials (URL or header form)
 * @param {string} value
 * @returns {boolean}
 */
export function hasBasicAuth(value) {
  return /^https?:\/\/[^:]+:[^@]+@.+$/i.test(value) ||
         /^Basic\s+[A-Za-z0-9+/]+=*$/i.test(value);
}

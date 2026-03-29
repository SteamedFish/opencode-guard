import { randomString } from '../utils.js';

const ALPHANUMERIC = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789';
const PASSWORD_CHARS = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789!@#$%^&*';

/**
 * Mask a password or credential value
 * @param {string} password
 * @param {Function} rng
 * @param {Object} options
 * @param {boolean} options.preserveLength - Whether to preserve original length (default: true)
 * @param {number} options.fixedLength - Fixed length for masked password (if preserveLength is false)
 * @returns {string}
 */
export function maskPassword(password, rng, options = {}) {
  const { preserveLength = true, fixedLength = 12 } = options;
  const length = preserveLength ? password.length : fixedLength;

  // Use password-specific character set for variety
  return randomString(rng, length, PASSWORD_CHARS);
}

/**
 * Mask credential in key=value format
 * @param {string} pair - Key=value pair
 * @param {Function} rng
 * @param {string[]} sensitiveKeys - List of key names that should be masked
 * @returns {string}
 */
export function maskCredentialPair(pair, rng, sensitiveKeys = []) {
  const eqIndex = pair.indexOf('=');
  if (eqIndex === -1) return pair;

  const key = pair.slice(0, eqIndex);
  const value = pair.slice(eqIndex + 1);

  // Check if this key should be masked
  const keyLower = key.toLowerCase();
  const shouldMask = sensitiveKeys.length === 0 || sensitiveKeys.some(k =>
    keyLower.includes(k.toLowerCase())
  );

  if (!shouldMask) return pair;

  const maskedValue = randomString(rng, value.length, PASSWORD_CHARS);
  return `${key}=${maskedValue}`;
}

/**
 * Default list of sensitive credential keys
 */
export const DEFAULT_SENSITIVE_KEYS = [
  'password', 'passwd', 'pwd', 'secret', 'token', 'api_key', 'apikey',
  'access_key', 'accesskey', 'private_key', 'privatekey', 'auth',
  'credential', 'credentials', 'key', 'passphrase', 'pin'
];

/**
 * Check if key-value pair contains a credential
 * @param {string} key
 * @param {string[]} sensitiveKeys
 * @returns {boolean}
 */
export function isCredentialKey(key, sensitiveKeys = DEFAULT_SENSITIVE_KEYS) {
  const keyLower = key.toLowerCase();
  return sensitiveKeys.some(k => keyLower.includes(k.toLowerCase()));
}

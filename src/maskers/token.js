import { randomString } from '../utils.js';

const ALPHANUMERIC = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789';
const UPPER_ALPHANUMERIC = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789';

// Known sk- prefixes in order of specificity (longest first)
const SK_PREFIXES = [
  'sk-litellm-',
  'sk-or-v1-',
  'sk-proj-',
  'sk-kimi-',
  'sk-ant-',
];

/**
 * Detect the sk- prefix from a token
 * @param {string} token
 * @returns {string} - The detected prefix or 'sk-'
 */
export function detectSkPrefix(token) {
  // Check known prefixes first
  for (const prefix of SK_PREFIXES) {
    if (token.startsWith(prefix)) {
      return prefix;
    }
  }
  // Dynamic detection for sk-{custom}- patterns
  const match = token.match(/^(sk-[a-z0-9-]+-)/);
  if (match) {
    return match[1];
  }
  // Simple sk- prefix
  if (token.startsWith('sk-')) {
    return 'sk-';
  }
  return 'sk-';
}

/**
 * Mask OpenAI-style token (sk-...)
 * @param {string} token
 * @param {Function} rng
 * @returns {string}
 */
export function maskSkToken(token, rng) {
  const prefix = 'sk-';
  const suffix = token.slice(prefix.length);
  const maskedSuffix = randomString(rng, suffix.length, ALPHANUMERIC);
  return `${prefix}${maskedSuffix}`;
}

/**
 * Mask any sk- prefixed variant (sk-proj-, sk-or-v1-, sk-litellm-, sk-kimi-, sk-ant-, etc.)
 * @param {string} token
 * @param {Function} rng
 * @returns {string}
 */
export function maskSkVariantToken(token, rng) {
  const prefix = detectSkPrefix(token);
  const suffix = token.slice(prefix.length);
  const maskedSuffix = randomString(rng, suffix.length, ALPHANUMERIC);
  return `${prefix}${maskedSuffix}`;
}

/**
 * Mask GitHub token (ghp_, gho_, ghu_, ghs_, ghr_)
 * @param {string} token
 * @param {Function} rng
 * @returns {string}
 */
export function maskGhToken(token, rng) {
  const match = token.match(/^(ghp|gho|ghu|ghs|ghr)_(.+)$/);
  if (!match) return token;
  
  const [, prefix, suffix] = match;
  const maskedSuffix = randomString(rng, suffix.length, ALPHANUMERIC);
  return `${prefix}_${maskedSuffix}`;
}

/**
 * Mask AWS access key (AKIA...)
 * @param {string} key
 * @param {Function} rng
 * @returns {string}
 */
export function maskAwsKey(key, rng) {
  const prefix = 'AKIA';
  const suffix = key.slice(prefix.length);
  const maskedSuffix = randomString(rng, suffix.length, UPPER_ALPHANUMERIC);
  return `${prefix}${maskedSuffix}`;
}

/**
 * Mask generic token with custom prefix
 * @param {string} token
 * @param {Function} rng
 * @param {string} prefix
 * @returns {string}
 */
export function maskGenericToken(token, rng, prefix = '') {
  const suffix = token.slice(prefix.length);
  const maskedSuffix = randomString(rng, suffix.length, ALPHANUMERIC);
  return `${prefix}${maskedSuffix}`;
}

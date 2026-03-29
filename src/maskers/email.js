import { randomString } from '../utils.js';

const LOWERCASE = 'abcdefghijklmnopqrstuvwxyz';
const UPPERCASE = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ';
const DIGITS = '0123456789';
const SPECIAL = '._-+';

/**
 * Mask an email address while preserving format
 * @param {string} email
 * @param {Function} rng - Seeded RNG
 * @returns {string}
 */
export function maskEmail(email, rng) {
  const [localPart, domain] = email.split('@');
  if (!domain) return email; // Invalid email, return as-is
  
  // Determine character set used in local part
  let chars = LOWERCASE;
  if (/[A-Z]/.test(localPart)) chars += UPPERCASE;
  if (/[0-9]/.test(localPart)) chars += DIGITS;
  if (/[._\-+]/.test(localPart)) chars += SPECIAL;
  
  // Generate masked local part with same length
  const maskedLocal = randomString(rng, localPart.length, chars);
  
  return `${maskedLocal}@${domain}`;
}

/**
 * Check if value looks like an email
 * @param {string} value
 * @returns {boolean}
 */
export function isEmail(value) {
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value);
}

import { randomString } from '../utils.js';

const HEX_CHARS = '0123456789abcdef';

/**
 * Validate if a string is a MAC address
 * Supports formats: aa:bb:cc:dd:ee:ff, aa-bb-cc-dd-ee-ff, AABBCCDDEEFF
 * @param {string} value
 * @returns {boolean}
 */
export function isMACAddress(value) {
  // Standard MAC address regex (6 groups of 2 hex digits)
  const macRegex = /^(?:[0-9a-fA-F]{2}[:-]){5}[0-9a-fA-F]{2}$/;
  // Compact format (12 hex chars)
  const compactRegex = /^[0-9a-fA-F]{12}$/;
  return macRegex.test(value) || compactRegex.test(value);
}

/**
 * Normalize MAC address to colon-separated format
 * @param {string} mac
 * @returns {string} - Normalized MAC address with colons
 */
export function normalizeMAC(mac) {
  // Remove any existing separators
  const clean = mac.replace(/[:-]/g, '').toLowerCase();
  // Format as xx:xx:xx:xx:xx:xx
  return clean.match(/.{1,2}/g).join(':');
}

/**
 * Mask MAC address - preserves prefix (first 3 bytes), masks suffix (last 3 bytes)
 * @param {string} mac
 * @param {Function} rng
 * @returns {string}
 */
export function maskMACAddress(mac, rng) {
  // Normalize to colon-separated format
  const normalized = normalizeMAC(mac);
  
  // Split into bytes
  const parts = normalized.split(':');
  
  // Keep first 3 bytes (prefix), mask last 3 bytes (suffix)
  const prefix = parts.slice(0, 3).join(':');
  
  // Generate random suffix (6 hex characters for 3 bytes)
  const maskedSuffix = randomString(rng, 6, HEX_CHARS);
  const suffix = maskedSuffix.match(/.{1,2}/g).join(':');
  
  return `${prefix}:${suffix}`;
}

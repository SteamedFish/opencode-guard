import { createSeededRNG } from '../utils.js';
import { maskEmail, isEmail } from './email.js';
import { maskSkToken, maskSkVariantToken, maskGhToken, maskAwsKey, maskGenericToken } from './token.js';
import { maskIPv4, maskIPv6, isIPv4, isIPv6 } from './ip.js';
import { maskUUID, isUUID } from './uuid.js';
import { maskMACAddress, isMACAddress } from './mac.js';
import { maskGeneric, maskWithPattern } from './generic.js';
import { maskBasicAuth, hasBasicAuth } from './basicAuth.js';
import { maskDatabaseConn, isDatabaseConn } from './database.js';
import { maskPassword, maskCredentialPair, DEFAULT_SENSITIVE_KEYS } from './credential.js';
import { createCustomMasker, CustomMaskerRegistry } from './custom.js';

const customRegistry = new CustomMaskerRegistry();

export function initializeCustomMaskers(customMaskersConfig) {
  customRegistry.loadFromConfig(customMaskersConfig);
}

/**
 * Dispatch table for built-in maskAs values.
 * Every `maskAs` emitted by the built-in patterns (src/patterns.js) MUST have
 * an entry here — otherwise maskValue silently falls through to auto-detect
 * and can mangle the value (e.g. a basic-auth URL detected as a fake email).
 * Tests assert that every builtin pattern's maskAs is a key of this map.
 */
const BUILTIN_MASKERS = new Map([
  ['email', maskEmail],
  ['sk_token', maskSkToken],
  ['sk_variant_token', maskSkVariantToken],
  ['gh_token', maskGhToken],
  ['aws_token', maskAwsKey],
  ['ipv4', maskIPv4],
  ['ipv6', maskIPv6],
  ['uuid', maskUUID],
  ['mac_address', maskMACAddress],
  ['pattern', maskWithPattern],
  ['basic_auth', maskBasicAuth],
  ['basic_auth_url', maskBasicAuth],
  ['basic_auth_header', maskBasicAuth],
  ['db_connection', maskDatabaseConn],
  ['password', maskPassword],
  ['credential_pair', (value, rng) => maskCredentialPair(value, rng, DEFAULT_SENSITIVE_KEYS)],
  ['generic_credential', maskWithPattern],
]);

/**
 * Check whether a maskAs value has a dedicated built-in masker
 * (as opposed to falling through to auto-detection)
 * @param {string} maskAs
 * @returns {boolean}
 */
export function hasBuiltinMasker(maskAs) {
  return BUILTIN_MASKERS.has(maskAs);
}

/**
 * Mask a value according to its category/maskAs.
 * @param {string} value
 * @param {string} category
 * @param {string} maskAs
 * @param {string} globalSalt
 * @param {number} [attempt=0] - Collision-avoidance counter. When > 0 it is
 *   appended to the RNG seed so a colliding masked value can be re-derived.
 *   attempt=0 (default) produces the historical deterministic output.
 * @returns {string}
 */
export function maskValue(value, category, maskAs, globalSalt, attempt = 0) {
  const seed = attempt > 0
    ? `${globalSalt}:${value}:${category}:${attempt}`
    : `${globalSalt}:${value}:${category}`;
  const rng = createSeededRNG(seed);

  if (maskAs && customRegistry.has(maskAs)) {
    const customMasker = customRegistry.get(maskAs);
    return customMasker(value, rng);
  }

  const builtinMasker = BUILTIN_MASKERS.get(maskAs);
  if (builtinMasker) {
    return builtinMasker(value, rng);
  }

  // Unknown maskAs: auto-detect from the value itself
  if (isEmail(value)) {
    return maskEmail(value, rng);
  } else if (hasBasicAuth(value)) {
    return maskBasicAuth(value, rng);
  } else if (isDatabaseConn(value)) {
    return maskDatabaseConn(value, rng);
  } else if (isIPv4(value)) {
    return maskIPv4(value, rng);
  } else if (isIPv6(value)) {
    return maskIPv6(value, rng);
  } else if (isUUID(value)) {
    return maskUUID(value, rng);
  } else if (isMACAddress(value)) {
    return maskMACAddress(value, rng);
  } else if (value.startsWith('sk-')) {
    return maskSkVariantToken(value, rng);
  } else if (/^(ghp|gho|ghu|ghs|ghr)_/.test(value)) {
    return maskGhToken(value, rng);
  } else if (value.startsWith('AKIA')) {
    return maskAwsKey(value, rng);
  } else {
    return maskWithPattern(value, rng);
  }
}

export {
  maskEmail,
  isEmail,
  maskSkToken,
  maskSkVariantToken,
  maskGhToken,
  maskAwsKey,
  maskGenericToken,
  maskIPv4,
  maskIPv6,
  isIPv4,
  isIPv6,
  maskUUID,
  isUUID,
  maskMACAddress,
  isMACAddress,
  maskGeneric,
  maskWithPattern,
  maskBasicAuth,
  hasBasicAuth,
  maskDatabaseConn,
  isDatabaseConn,
  maskPassword,
  maskCredentialPair,
  DEFAULT_SENSITIVE_KEYS,
  createCustomMasker,
  CustomMaskerRegistry,
  customRegistry,
};

import { createSeededRNG } from '../utils.js';
import { maskEmail, isEmail } from './email.js';
import { maskSkToken, maskSkVariantToken, maskGhToken, maskAwsKey, maskGenericToken } from './token.js';
import { maskIPv4, maskIPv6, isIPv4, isIPv6 } from './ip.js';
import { maskUUID, isUUID } from './uuid.js';
import { maskGeneric, maskWithPattern } from './generic.js';
import { maskBasicAuth, hasBasicAuth } from './basicAuth.js';
import { maskDatabaseConn, isDatabaseConn } from './database.js';
import { maskPassword, maskCredentialPair, DEFAULT_SENSITIVE_KEYS } from './credential.js';
import { createCustomMasker, CustomMaskerRegistry } from './custom.js';

const customRegistry = new CustomMaskerRegistry();

export function initializeCustomMaskers(customMaskersConfig) {
  customRegistry.loadFromConfig(customMaskersConfig);
}

export function maskValue(value, category, maskAs, globalSalt) {
  const seed = `${globalSalt}:${value}:${category}`;
  const rng = createSeededRNG(seed);

  if (maskAs && customRegistry.has(maskAs)) {
    const customMasker = customRegistry.get(maskAs);
    return customMasker(value, rng);
  }

  switch (maskAs) {
    case 'email':
      return maskEmail(value, rng);
    case 'sk_token':
      return maskSkToken(value, rng);
    case 'sk_variant_token':
      return maskSkVariantToken(value, rng);
    case 'gh_token':
      return maskGhToken(value, rng);
    case 'aws_token':
      return maskAwsKey(value, rng);
    case 'ipv4':
      return maskIPv4(value, rng);
    case 'ipv6':
      return maskIPv6(value, rng);
    case 'uuid':
      return maskUUID(value, rng);
    case 'pattern':
      return maskWithPattern(value, rng);
    case 'basic_auth':
      return maskBasicAuth(value, rng);
    case 'db_connection':
      return maskDatabaseConn(value, rng);
    case 'password':
      return maskPassword(value, rng);
    case 'credential_pair':
      return maskCredentialPair(value, rng, DEFAULT_SENSITIVE_KEYS);
    default:
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
}

export function getMaskerForCategory(category) {
  const cat = category?.toUpperCase?.() || '';

  if (cat.includes('EMAIL')) return maskEmail;
  if (cat.includes('OPENAI') || cat.includes('SK_TOKEN')) return maskSkToken;
  if (cat.includes('VARIANT') || cat.includes('PROJECT') || cat.includes('ROUTER') || cat.includes('LITELLM') || cat.includes('KIMI') || cat.includes('ANTHROPIC')) return maskSkVariantToken;
  if (cat.includes('GITHUB') || cat.includes('GH_TOKEN')) return maskGhToken;
  if (cat.includes('AWS')) return maskAwsKey;
  if (cat.includes('IPV4')) return maskIPv4;
  if (cat.includes('IPV6')) return maskIPv6;
  if (cat.includes('UUID')) return maskUUID;

  return null;
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
  initializeCustomMaskers,
};

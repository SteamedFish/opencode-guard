import { detectSensitiveData } from './detector.js';

export async function redactText(text, patterns, session, aiDetector = null) {
  if (typeof text !== 'string' || !text) {
    return { text, count: 0 };
  }
  
  const matches = await detectSensitiveData(text, patterns, aiDetector);
  if (matches.length === 0) {
    return { text, count: 0 };
  }
  
  let result = text;
  let count = 0;
  
  for (let i = matches.length - 1; i >= 0; i--) {
    const match = matches[i];
    const masked = session.getOrCreateMasked(match.text, match.category, match.maskAs);
    // Tripwire: a masker that returns its input unchanged silently leaks the
    // sensitive value (e.g. a parse regex whose flags don't match the
    // detector's). Counting behavior is intentionally left unchanged.
    if (masked === match.text && match.text.length > 0) {
      console.warn(`[opencode-guard] masker returned input unchanged for category "${match.category}" (maskAs: ${match.maskAs}) — possible silent-miss bug`);
    }
    result = result.slice(0, match.start) + masked + result.slice(match.end);
    count++;
  }
  
  return { text: result, count };
}

/**
 * Redact sensitive values inside an arbitrarily nested structure.
 *
 * ⚠️ IN-PLACE CONTRACT: this function MUTATES `value` (objects and arrays)
 * in place and returns the same reference. Callers MUST NOT pass structures
 * that share references with persisted chat history or other state that must
 * keep the original (unmasked) values — clone first (e.g. structuredClone)
 * when in doubt.
 *
 * @param {*} value - Mutated in place when it is an object or array
 * @param {Object} patterns
 * @param {MaskSession} session
 * @param {Object|null} aiDetector
 * @param {WeakSet} visited - Internal cycle guard
 * @returns {Promise<*>} the same (mutated) reference
 */
export async function redactDeep(value, patterns, session, aiDetector = null, visited = new WeakSet()) {
  if (typeof value === 'string') {
    const result = await redactText(value, patterns, session, aiDetector);
    return result.text;
  }

  if (Array.isArray(value)) {
    if (visited.has(value)) {
      return value;
    }
    visited.add(value);
    for (let i = 0; i < value.length; i++) {
      value[i] = await redactDeep(value[i], patterns, session, aiDetector, visited);
    }
    return value;
  }

  if (value && typeof value === 'object') {
    if (visited.has(value)) {
      return value;
    }
    visited.add(value);
    for (const key of Object.keys(value)) {
      value[key] = await redactDeep(value[key], patterns, session, aiDetector, visited);
    }
    return value;
  }

  return value;
}

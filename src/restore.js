const REGEX_SPECIALS = /[.*+?^${}()|[\]\\]/g;
const MAX_ITERATIONS = 10;

/**
 * Build a single alternation regex from all masked values in the session.
 * Keys are sorted longest-first so a short masked value that is a substring
 * of a longer one can never corrupt the longer one (the regex alternation
 * tries the longest match first). Empty keys are excluded (they would match
 * everywhere). Returns null when there is nothing to restore.
 * @param {MaskSession} session
 * @returns {RegExp|null}
 */
function buildRestorePattern(session) {
  const keys = [];
  for (const masked of session.maskedToOriginal.keys()) {
    if (typeof masked === 'string' && masked.length > 0) {
      keys.push(masked);
    }
  }
  if (keys.length === 0) return null;

  keys.sort((a, b) => b.length - a.length);
  const alternation = keys.map(k => k.replace(REGEX_SPECIALS, '\\$&')).join('|');
  return new RegExp(alternation, 'g');
}

export function restoreText(text, session, debug = false) {
  if (typeof text !== 'string' || !text) {
    return text;
  }

  const pattern = buildRestorePattern(session);
  if (!pattern) {
    return text;
  }

  let result = text;

  // Outer loop preserves chain-restore semantics: a restored original may
  // itself contain another masked value (double/triple masking). Each
  // iteration is a single O(text) regex pass over ALL mappings at once,
  // instead of one pass per mapping.
  for (let iteration = 0; iteration < MAX_ITERATIONS; iteration++) {
    let changed = false;
    result = result.replace(pattern, (matched) => {
      const original = session.maskedToOriginal.get(matched);
      // Skip unknown (should not happen) and self-mappings (would loop forever)
      if (original === undefined || original === matched) {
        return matched;
      }
      if (debug) console.log(`[opencode-guard] restoreText: found masked "${matched}" -> "${original}"`);
      changed = true;
      return original;
    });
    if (!changed) break;
  }

  return result;
}

export function restoreDeep(value, session, visited = new WeakSet(), debug = false) {
  if (typeof value === 'string') {
    const result = restoreText(value, session, debug);
    if (debug && result !== value) {
      console.log(`[opencode-guard] restoreDeep: restored "${value}" -> "${result}"`);
    }
    return result;
  }

  if (Array.isArray(value)) {
    if (visited.has(value)) {
      return value;
    }
    visited.add(value);
    for (let i = 0; i < value.length; i++) {
      value[i] = restoreDeep(value[i], session, visited, debug);
    }
    return value;
  }

  if (value && typeof value === 'object') {
    if (visited.has(value)) {
      return value;
    }
    visited.add(value);
    for (const key of Object.keys(value)) {
      value[key] = restoreDeep(value[key], session, visited, debug);
    }
    return value;
  }

  return value;
}

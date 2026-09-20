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

/**
 * Restore (unmask) values inside an arbitrarily nested structure.
 *
 * ⚠️ IN-PLACE CONTRACT: this function MUTATES `value` (objects and arrays)
 * in place and returns the same reference. Callers MUST NOT pass structures
 * that share references with persisted chat history or other state that must
 * keep the original (unmasked) values — clone first (e.g. structuredClone)
 * when in doubt.
 *
 * Safe on frozen inputs when no restore would apply: the per-property
 * write is skipped when the recursive call returns the same value, so a
 * frozen object whose strings happen to contain no masked keys passes
 * through untouched. (opencode v2.x Immer-freezes tool args/output before
 * plugin hooks run — see opencode#25873.)
 *
 * @param {*} value - Mutated in place when it is an object or array
 * @param {MaskSession} session
 * @param {WeakSet} visited - Internal cycle guard
 * @returns {*} the same (mutated) reference
 */
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
      // Skip the write when the recursive call returns the same reference
      // (string with no masked values, or a no-op traversal of a nested
      // object/array). Unconditional writes throw "Attempted to assign to
      // readonly property" on frozen inputs — opencode v2.x Immer-freezes
      // tool args/output before plugin hooks run (opencode#25873), and a
      // session with no mappings of its own restores everything to identity
      // but still triggers the write on every property.
      const next = restoreDeep(value[i], session, visited, debug);
      if (next !== value[i]) value[i] = next;
    }
    return value;
  }

  if (value && typeof value === 'object') {
    if (visited.has(value)) {
      return value;
    }
    visited.add(value);
    for (const key of Object.keys(value)) {
      // See the array branch above for why the write is guarded.
      const next = restoreDeep(value[key], session, visited, debug);
      if (next !== value[key]) value[key] = next;
    }
    return value;
  }

  return value;
}

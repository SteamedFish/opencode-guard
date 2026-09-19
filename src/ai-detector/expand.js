/**
 * Expand AI-detected spans to every whole-token occurrence of the same value.
 *
 * The model reports a value once, but the same value can occur several times in
 * the text. Binding a single span (the provider resolves spans left-to-right)
 * leaves the other occurrences unmasked — a residual leak, since the provider
 * sees the whole message. This helper adds a span for every additional
 * occurrence of the flagged value so the masking engine covers all of them.
 *
 * Occurrences embedded inside a longer ASCII identifier (e.g. "John" inside
 * "Johnson", or "1234" inside "ref1234x") are NOT expanded: they are a
 * different token and masking them would corrupt surrounding text. The
 * originally detected span is always kept, even when it happens to sit inside
 * such a token, because the model anchored to it explicitly.
 */

const ASCII_WORD_RE = /[A-Za-z0-9_]/;

/**
 * True when the occurrence at [start, end) is not embedded in a longer ASCII
 * word, i.e. neither adjacent character is [A-Za-z0-9_]. The check is
 * deliberately ASCII-only: a preceding/following non-ASCII character does not
 * block expansion.
 *
 * @param {string} text
 * @param {number} start
 * @param {number} end
 * @returns {boolean}
 */
function isWholeToken(text, start, end) {
  const before = start > 0 ? text[start - 1] : '';
  const after = end < text.length ? text[end] : '';
  return !(before && ASCII_WORD_RE.test(before)) && !(after && ASCII_WORD_RE.test(after));
}

/**
 * @typedef {Object} FlaggedSpan
 * @property {number} start
 * @property {number} end
 * @property {string} text
 * @property {string} category
 * @property {string} maskAs
 * @property {number} [confidence]
 * @property {string} [source]
 */

/**
 * Add a span for every whole-token occurrence of each flagged value.
 *
 * Input spans are never mutated and are always included as-is; added spans are
 * shallow copies carrying the same category/maskAs/confidence. Duplicate and
 * overlapping spans are intentionally not filtered here — downstream
 * `mergeResults` already resolves overlaps.
 *
 * @param {string} text - Original text the spans were detected in
 * @param {FlaggedSpan[]} results - Detected spans
 * @returns {FlaggedSpan[]} a new array with extra occurrence spans appended
 */
export function expandFlaggedOccurrences(text, results) {
  if (typeof text !== 'string' || text.length === 0 || !Array.isArray(results) || results.length === 0) {
    return results;
  }

  const expanded = [];
  for (const result of results) {
    expanded.push(result);

    const value = result?.text;
    if (typeof value !== 'string' || value.length === 0) continue;

    // Non-overlapping scan (advance by value.length), matching what a global
    // regex would enumerate.
    let pos = text.indexOf(value);
    while (pos !== -1) {
      if (pos !== result.start) {
        const end = pos + value.length;
        if (isWholeToken(text, pos, end)) {
          expanded.push({ ...result, start: pos, end });
        }
      }
      pos = text.indexOf(value, pos + value.length);
    }
  }

  return expanded;
}

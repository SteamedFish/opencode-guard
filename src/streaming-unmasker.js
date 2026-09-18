/**
 * StreamingUnmasker — restores masked values in incremental text streams.
 *
 * Matching is driven by the session's *actual* masked keys (the keys of
 * session.maskedToOriginal, or session.getMaskedKeys() for restricted views
 * such as the JSON-safe session view), NOT by a hardcoded generic pattern.
 * Consequences:
 *  - Every masker type restores in streams (UUIDs, MACs, passwords, DB URLs,
 *    phones, generic credentials), not just token/IP/email shapes.
 *  - Innocent trailing text ("The answer is 42", "decade", ...) is emitted
 *    immediately — a buffer suffix is held back ONLY when it is a strict
 *    prefix of at least one real masked key (it may be a key split across
 *    chunks).
 *  - After a successful restore, only the text up to the end of the replaced
 *    region is emitted; the trailing remainder is re-checked with the
 *    hold-back rule instead of being flushed unrestored.
 *
 * Key-cache invalidation heuristic: MaskSession exposes no version counter,
 * so the cache is rebuilt when a cheap fingerprint of the key set changes:
 * `${size}:${totalKeyLength}:${firstKey}:${lastKey}` (Map iteration order).
 * Rebuilding is O(n log n) (sort) + regex compile; the fingerprint itself is
 * O(n) per transform() call. A mutation that keeps size, total length, and
 * first/last keys identical (e.g. TTL eviction + insert of equal-length keys
 * in the same positions) goes undetected until the size changes — the worst
 * case is a missed restore of the new key (fail-safe: data stays masked),
 * never a wrong restore, because replacement always goes through
 * session.lookupOriginal().
 *
 * Hold-back structure: a Set of all proper key prefixes (capped at
 * maxMaskedLength). Memory is O(sum of key lengths); lookup is O(1), and the
 * per-chunk suffix scan is O(min(maxKeyLen, maxMaskedLength)) ≤ 128 substring
 * checks — independent of the number of keys. (Chosen over a sorted-array
 * binary search: simpler and allocation-bounded; the prefix Set trades a
 * bounded amount of memory for O(1) lookups on the hot path.)
 *
 * Backward compatibility: constructor keeps the (session, options = {}) shape
 * and accepts options.maskedPattern. The pattern is only used as a legacy
 * fallback when the session exposes no key source at all (no
 * `maskedToOriginal` Map and no `getMaskedKeys()`); in that mode replacement
 * still works but no hold-back is possible (pattern matches are
 * self-terminating). All existing callers pass sessions/views with a key
 * source, so they transparently get the key-driven behavior.
 */

const DEFAULT_MAX_MASKED_LENGTH = 128;

function escapeRegExp(s) {
  return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

export class StreamingUnmasker {
  constructor(session, options = {}) {
    this.session = session;
    this.maxMaskedLength = options.maxMaskedLength || DEFAULT_MAX_MASKED_LENGTH;
    // Legacy fallback pattern, used ONLY when the session exposes no masked-key
    // source. Previously this was the primary matching mechanism.
    this.maskedPattern = options.maskedPattern || null;
    this.buffer = '';
    this.closed = false;
    this._cacheFingerprint = null;
    this._cache = null; // { regex, prefixSet, maxKeyLen }
  }

  /**
   * Fingerprint of the current masked-key set, or null when the session
   * exposes no key source. See class docstring for the heuristic.
   */
  _computeFingerprint() {
    const s = this.session;
    if (s && typeof s.getMaskedKeyFingerprint === 'function') {
      return s.getMaskedKeyFingerprint();
    }
    const map = s && s.maskedToOriginal;
    if (map instanceof Map) {
      let total = 0;
      let first;
      let last;
      for (const k of map.keys()) {
        if (first === undefined) first = k;
        last = k;
        total += k.length;
      }
      return `${map.size}:${total}:${first ?? ''}:${last ?? ''}`;
    }
    return null;
  }

  /**
   * Current masked keys, or null when the session exposes no key source.
   */
  _collectKeys() {
    const s = this.session;
    if (s && typeof s.getMaskedKeys === 'function') {
      return s.getMaskedKeys();
    }
    const map = s && s.maskedToOriginal;
    if (map instanceof Map) {
      return [...map.keys()];
    }
    return null;
  }

  _buildCache(keys) {
    if (!keys || keys.length === 0) {
      return { regex: null, prefixSet: new Set(), maxKeyLen: 0 };
    }
    // Longest-first so that when one key is a substring of another, the
    // alternation matches the longer key at each position.
    const sorted = [...keys].sort((a, b) => b.length - a.length || (a < b ? -1 : a > b ? 1 : 0));
    const regex = new RegExp(sorted.map(escapeRegExp).join('|'), 'g');
    const maxKeyLen = sorted[0].length;
    const prefixCap = Math.min(maxKeyLen - 1, this.maxMaskedLength);
    const prefixSet = new Set();
    for (const key of sorted) {
      const upper = Math.min(key.length - 1, prefixCap); // strict prefixes only
      for (let i = 1; i <= upper; i++) {
        prefixSet.add(key.slice(0, i));
      }
    }
    return { regex, prefixSet, maxKeyLen };
  }

  /**
   * Key matcher cache, rebuilt when the fingerprint changes. Returns null
   * when the session exposes no key source (legacy mode).
   */
  _ensureCache() {
    const fingerprint = this._computeFingerprint();
    if (fingerprint === null) return null;
    if (fingerprint !== this._cacheFingerprint) {
      this._cacheFingerprint = fingerprint;
      this._cache = this._buildCache(this._collectKeys());
    }
    return this._cache;
  }

  _replaceKeys(text, regex) {
    return text.replace(regex, (masked) => {
      const original = this.session.lookupOriginal(masked);
      return original === undefined ? masked : original;
    });
  }

  /**
   * Index within `text` where a held-back suffix begins, or text.length when
   * nothing needs holding. Holds the LONGEST suffix that is a strict prefix
   * of at least one masked key (it may complete into a key in a later chunk);
   * emitting any part of it could split a key irreversibly.
   */
  _findHoldStart(text, cache) {
    const scanCap = Math.min(cache.maxKeyLen - 1, this.maxMaskedLength, text.length);
    for (let len = scanCap; len >= 1; len--) {
      if (cache.prefixSet.has(text.slice(text.length - len))) {
        return text.length - len;
      }
    }
    return text.length;
  }

  transform(chunk) {
    if (this.closed) {
      throw new Error('StreamingUnmasker already closed');
    }

    this.buffer += chunk;
    const cache = this._ensureCache();

    if (!cache) {
      // Legacy mode: no key source. Pattern-based replacement, no hold-back.
      if (this.maskedPattern) {
        const output = this._replaceKeys(this.buffer, this.maskedPattern);
        this.buffer = '';
        return output;
      }
      const output = this.buffer;
      this.buffer = '';
      return output;
    }

    if (!cache.regex) {
      // Empty mapping set: pass through unchanged.
      const output = this.buffer;
      this.buffer = '';
      return output;
    }

    // Rightmost end (in unprocessed buffer coordinates) among matches that
    // actually restore. Matches without an original (stale cache entry after
    // TTL eviction) are left as-is and do not extend the emit boundary.
    let replacedEnd = -1;
    for (const match of this.buffer.matchAll(cache.regex)) {
      if (this.session.lookupOriginal(match[0]) !== undefined) {
        const end = match.index + match[0].length;
        if (end > replacedEnd) replacedEnd = end;
      }
    }

    if (replacedEnd === -1) {
      // Nothing restored: hold back only a possible key prefix suffix.
      const holdStart = this._findHoldStart(this.buffer, cache);
      const output = this.buffer.slice(0, holdStart);
      this.buffer = this.buffer.slice(holdStart);
      return output;
    }

    // Restore everything up to the end of the rightmost restored match, then
    // re-run the hold-back check on the trailing remainder (fixes the old
    // behavior where a token split right behind a restored one was flushed
    // unrestored).
    const head = this.buffer.slice(0, replacedEnd);
    const tail = this.buffer.slice(replacedEnd);
    const processedHead = this._replaceKeys(head, cache.regex);
    const holdStart = this._findHoldStart(tail, cache);
    const output = processedHead + tail.slice(0, holdStart);
    this.buffer = tail.slice(holdStart);
    return output;
  }

  flush() {
    if (this.closed) {
      return '';
    }

    this.closed = true;

    let result = this.buffer;
    const cache = this._ensureCache();
    if (cache && cache.regex) {
      result = this._replaceKeys(result, cache.regex);
    } else if (!cache && this.maskedPattern) {
      result = this._replaceKeys(result, this.maskedPattern);
    }
    // Any legitimately held remainder that did not complete into a key is
    // emitted verbatim here.

    this.buffer = '';
    return result;
  }

  isClosed() {
    return this.closed;
  }
}

export function createStreamingUnmasker(session, options = {}) {
  return new StreamingUnmasker(session, options);
}

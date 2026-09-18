import { maskValue } from './maskers/index.js';

const DEFAULT_MAX_MAPPINGS = 1000;

/**
 * Max re-derivation attempts when a masked value collides with an existing
 * mapping (or maps to itself). Collisions are exponentially rare, so this
 * loop essentially never runs past attempt 1; the cap only guards against
 * pathological (e.g. constant-output custom) maskers.
 */
const MAX_MASK_ATTEMPTS = 100;

export class MaskSession {
  /**
   * @param {string} globalSalt
   * @param {Object} options
   * @param {number} options.ttlMs - Time-to-live per mapping (sliding: refreshed on access)
   * @param {number} options.maxMappings - Max stored mappings (must be >= 1)
   * @param {Object} [options.logger] - Optional logger ({ log, warn }); defaults to console
   */
  constructor(globalSalt, options = {}) {
    this.globalSalt = globalSalt;
    this.ttlMs = options.ttlMs;
    this.logger = options.logger || console;

    // maxMappings < 1 (or NaN) would make the eviction loop below spin
    // forever (`while (size >= 0)`), so validate it here.
    this.maxMappings = options.maxMappings;
    if (this.maxMappings === undefined || this.maxMappings === null) {
      this.logger.warn?.(`[opencode-guard] MaskSession: maxMappings not provided, defaulting to ${DEFAULT_MAX_MAPPINGS}`);
      this.maxMappings = DEFAULT_MAX_MAPPINGS;
    } else if (!Number.isFinite(this.maxMappings) || this.maxMappings < 1) {
      this.logger.warn?.(`[opencode-guard] MaskSession: invalid maxMappings (${this.maxMappings}), clamping to 1`);
      this.maxMappings = 1;
    }

    this.originalToMasked = new Map();
    this.maskedToOriginal = new Map();
    this.timestamps = new Map();
  }

  cleanup(now = Date.now()) {
    for (const [masked, createdAt] of this.timestamps) {
      if (now - createdAt > this.ttlMs) {
        const original = this.maskedToOriginal.get(masked);
        this.maskedToOriginal.delete(masked);
        this.timestamps.delete(masked);
        if (original) this.originalToMasked.delete(original);
      }
    }
  }

  evictOldest() {
    let oldestMasked = '';
    let oldestTime = Infinity;
    for (const [masked, createdAt] of this.timestamps) {
      if (createdAt < oldestTime) {
        oldestTime = createdAt;
        oldestMasked = masked;
      }
    }
    if (oldestMasked) {
      const original = this.maskedToOriginal.get(oldestMasked);
      this.maskedToOriginal.delete(oldestMasked);
      this.timestamps.delete(oldestMasked);
      if (original) this.originalToMasked.delete(original);
    }
  }

  /**
   * Check whether a candidate masked value is usable: it must not equal the
   * original (self-mapping would leak the value unmasked) and must not
   * collide with a mapping that belongs to a DIFFERENT original (would
   * corrupt restoration).
   */
  #isMaskedValueUsable(masked, original) {
    if (masked === original) return false;
    const mappedOriginal = this.maskedToOriginal.get(masked);
    return mappedOriginal === undefined || mappedOriginal === original;
  }

  getOrCreateMasked(original, category, maskAs, debug = false) {
    const existing = this.originalToMasked.get(original);
    if (existing !== undefined) {
      // Sliding TTL: reuse keeps the mapping alive
      this.timestamps.set(existing, Date.now());
      if (debug) this.logger.log(`[opencode-guard] session: reusing existing mask "${original}" -> "${existing}"`);
      return existing;
    }

    this.cleanup();
    while (this.originalToMasked.size >= this.maxMappings) {
      this.evictOldest();
    }

    // Derive a unique masked value. Re-derive with an attempt counter when
    // the candidate collides with a different original or equals the input.
    let attempt = 0;
    let masked = maskValue(original, category, maskAs, this.globalSalt);
    while (!this.#isMaskedValueUsable(masked, original) && attempt < MAX_MASK_ATTEMPTS) {
      attempt++;
      masked = maskValue(original, category, maskAs, this.globalSalt, attempt);
    }

    // Pathological masker (e.g. constant output): fall back to a uniqueness
    // suffix so distinct originals never share a masked value. This changes
    // the format, but correctness of restore beats format preservation.
    let suffix = 0;
    while (!this.#isMaskedValueUsable(masked, original)) {
      suffix++;
      masked = `${masked}~${suffix}`;
    }

    if (attempt > 0 || suffix > 0) {
      this.logger.warn?.(`[opencode-guard] MaskSession: mask collision/self-map for category "${category}" (re-derivations: ${attempt}, suffixes: ${suffix})`);
    }

    this.originalToMasked.set(original, masked);
    this.maskedToOriginal.set(masked, original);
    this.timestamps.set(masked, Date.now());

    if (debug) this.logger.log(`[opencode-guard] session: created mask "${original}" -> "${masked}"`);
    return masked;
  }

  lookupOriginal(masked) {
    const original = this.maskedToOriginal.get(masked);
    if (original !== undefined) {
      // Sliding TTL: restore activity keeps the mapping alive
      this.timestamps.set(masked, Date.now());
    }
    return original;
  }
}

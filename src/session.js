import { maskValue } from './maskers/index.js';

export class MaskSession {
  constructor(globalSalt, options) {
    this.globalSalt = globalSalt;
    this.ttlMs = options.ttlMs;
    this.maxMappings = options.maxMappings;
    
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
  
  getOrCreateMasked(original, category, maskAs, debug = false) {
    const existing = this.originalToMasked.get(original);
    if (existing) {
      if (debug) console.log(`[opencode-guard] session: reusing existing mask "${original}" -> "${existing}"`);
      return existing;
    }
    
    this.cleanup();
    while (this.originalToMasked.size >= this.maxMappings) {
      this.evictOldest();
    }
    
    const masked = maskValue(original, category, maskAs, this.globalSalt);
    
    this.originalToMasked.set(original, masked);
    this.maskedToOriginal.set(masked, original);
    this.timestamps.set(masked, Date.now());
    
    if (debug) console.log(`[opencode-guard] session: created mask "${original}" -> "${masked}"`);
    return masked;
  }
  
  lookupOriginal(masked) {
    return this.maskedToOriginal.get(masked);
  }
}

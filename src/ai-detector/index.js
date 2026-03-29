import { createAIProvider } from './providers.js';
import { mergeResults } from './merge.js';

/**
 * AI-powered sensitive data detector
 * Analyzes text contextually to find secrets regex cannot catch
 */
export class AIDetector {
  constructor(config = {}) {
    this.config = {
      provider: config.aiProvider || 'local',
      timeoutMs: config.aiTimeoutMs || 500,
      ...config,
    };
    this.provider = null;
    this.initialized = false;
  }

  /**
   * Initialize the AI provider
   */
  async initialize() {
    if (this.initialized) return;
    
    try {
      this.provider = createAIProvider(this.config.provider, this.config);
      this.initialized = true;
    } catch (err) {
      console.warn(`[opencode-guard] Failed to initialize AI provider: ${err.message}`);
      this.provider = null;
    }
  }

  /**
   * Detect sensitive data in text using AI
   * @param {string} text
   * @returns {Promise<Array<{start: number, end: number, text: string, category: string, maskAs: string, confidence: number}>>}
   */
  async detect(text) {
    if (!this.initialized) {
      await this.initialize();
    }

    if (!this.provider || !this.provider.isAvailable()) {
      return [];
    }

    try {
      const results = await this._detectWithTimeout(text);
      return results.map(r => ({
        ...r,
        maskAs: this._getMaskerForCategory(r.category),
      }));
    } catch (err) {
      if (process.env.OPENCODE_GUARD_DEBUG) {
        console.warn(`[opencode-guard] AI detection failed: ${err.message}`);
      }
      return [];
    }
  }

  async _detectWithTimeout(text) {
    return new Promise((resolve, reject) => {
      const timeout = setTimeout(() => {
        reject(new Error(`AI detection timeout after ${this.config.timeoutMs}ms`));
      }, this.config.timeoutMs);

      this.provider.analyze(text)
        .then(results => {
          clearTimeout(timeout);
          resolve(results);
        })
        .catch(err => {
          clearTimeout(timeout);
          reject(err);
        });
    });
  }

  _getMaskerForCategory(category) {
    const mapping = {
      'PASSWORD': 'password',
      'API_KEY': 'generic_credential',
      'SECRET': 'generic_credential',
      'TOKEN': 'token',
      'CREDENTIAL': 'generic_credential',
      'PRIVATE_KEY': 'generic_credential',
      'DEFAULT': 'pattern',
    };
    return mapping[category] || mapping.DEFAULT;
  }
}

/**
 * Convenience function for one-shot detection
 * @param {string} text
 * @param {Object} config
 * @returns {Promise<Array>}
 */
export async function detectWithAI(text, config = {}) {
  const detector = new AIDetector(config);
  return detector.detect(text);
}

import { createAIProvider } from './providers.js';
import { mergeResults } from './merge.js';

export class AIDetector {
  constructor(config = {}) {
    this.config = {
      provider: config.provider || 'local',
      timeoutMs: config.timeoutMs || 500,
      autoInstallDeps: config.autoInstallDeps || false,
      localModel: config.localModel || '',
      ...config,
    };
    this.provider = null;
    this.initialized = false;
  }

  async initialize() {
    if (this.initialized) return;
    
    try {
      this.provider = createAIProvider(this.config.provider, this.config);
      
      // Check if provider is available (for local provider, this may trigger auto-install)
      const available = await this.provider.isAvailable();
      if (!available && this.config.provider === 'local') {
        // Try to initialize which may trigger auto-install
        try {
          await this.provider.initialize();
        } catch (err) {
          console.warn(`[opencode-guard] AI provider not available: ${err.message}`);
          this.provider = null;
        }
      }
      
      this.initialized = true;
    } catch (err) {
      console.warn(`[opencode-guard] Failed to initialize AI provider: ${err.message}`);
      this.provider = null;
    }
  }

  async detect(text) {
    if (!this.initialized) {
      await this.initialize();
    }

    if (!this.provider) {
      return [];
    }

    try {
      const results = await this._detectWithTimeout(text);
      return results.map(r => ({
        start: r.start,
        end: r.end,
        text: r.value,
        category: r.type,
        confidence: r.confidence,
        maskAs: this._getMaskerForCategory(r.type),
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

      this.provider.detect(text)
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

export async function detectWithAI(text, config = {}) {
  const detector = new AIDetector(config);
  return detector.detect(text);
}

/**
 * AI Provider Registry and Base Interface
 * Supports: local (Transformers.js), openai, custom
 */

export class AIProvider {
  constructor(config = {}) {
    this.config = config;
  }

  /**
   * Analyze text for sensitive data
   * @param {string} text - Input text to analyze
   * @returns {Promise<Array<{start: number, end: number, category: string, confidence: number}>>}
   */
  async analyze(text) {
    throw new Error('analyze() must be implemented by subclass');
  }

  /**
   * Check if provider is available/initialized
   * @returns {boolean}
   */
  isAvailable() {
    return true;
  }
}

/**
 * Factory to create appropriate provider
 * @param {string} provider - Provider name
 * @param {Object} config - Provider-specific config
 * @returns {AIProvider}
 */
export function createAIProvider(provider, config = {}) {
  switch (provider) {
    case 'local':
      return new LocalAIProvider(config);
    case 'openai':
      return new OpenAIProvider(config);
    case 'custom':
      return new CustomAIProvider(config);
    default:
      throw new Error(`Unknown AI provider: ${provider}`);
  }
}

// Provider implementations in separate tasks
export { LocalAIProvider } from './providers/local.js';
export { OpenAIProvider } from './providers/openai.js';
export { CustomAIProvider } from './providers/custom.js';

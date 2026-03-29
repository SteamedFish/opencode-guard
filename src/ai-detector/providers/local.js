import { AIProvider } from './base.js';

export class LocalAIProvider extends AIProvider {
  constructor(config = {}) {
    super(config);
    this.pipeline = null;
    this.modelName = config.model || 'Xenova/distilbert-base-uncased-finetuned-sst-2-english';
    this.initialized = false;
  }

  isAvailable() {
    try {
      const module = require('@xenova/transformers');
      return !!module.pipeline;
    } catch {
      return false;
    }
  }

  async initialize() {
    if (this.initialized) return;
    
    try {
      const { pipeline } = await import('@xenova/transformers');
      this.pipeline = await pipeline(
        'token-classification',
        this.modelName,
        { quantized: true }
      );
      
      this.initialized = true;
    } catch (err) {
      console.warn(`[opencode-guard] Failed to load local AI model: ${err.message}`);
      throw err;
    }
  }

  async detect(text) {
    if (!this.initialized) {
      await this.initialize();
    }

    try {
      const results = await this.pipeline(text);
      
      return results.map(entity => ({
        type: this._mapEntityType(entity.entity),
        value: entity.word,
        confidence: entity.score,
        start: entity.start,
        end: entity.end
      }));
    } catch (err) {
      console.warn(`[opencode-guard] AI detection failed: ${err.message}`);
      return [];
    }
  }

  _mapEntityType(hfType) {
    const typeMap = {
      'B-PER': 'PERSON', 'I-PER': 'PERSON',
      'B-ORG': 'ORGANIZATION', 'I-ORG': 'ORGANIZATION',
      'B-LOC': 'LOCATION', 'I-LOC': 'LOCATION',
      'B-MISC': 'MISC', 'I-MISC': 'MISC',
      'PER': 'PERSON', 'ORG': 'ORGANIZATION',
      'LOC': 'LOCATION', 'MISC': 'MISC'
    };
    
    return typeMap[hfType] || 'UNKNOWN';
  }
}

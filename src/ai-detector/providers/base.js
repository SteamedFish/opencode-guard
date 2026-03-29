/**
 * AI Provider Base Interface
 */

export class AIProvider {
  constructor(config = {}) {
    this.config = config;
  }

  async detect(text) {
    throw new Error('detect() must be implemented by subclass');
  }

  isAvailable() {
    return true;
  }
}

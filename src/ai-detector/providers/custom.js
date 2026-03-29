import { AIProvider } from './base.js';

export class CustomAIProvider extends AIProvider {
  constructor(config = {}) {
    super(config);
    this.endpoint = config.aiEndpoint || config.endpoint;
    this.apiKey = config.openaiApiKey || config.apiKey;
    this.model = config.aiModel || config.model;
    
    if (!this.endpoint) {
      throw new Error('Endpoint required for custom AI provider');
    }
  }

  async detect(text) {
    try {
      const headers = { 'Content-Type': 'application/json' };
      
      if (this.apiKey) {
        headers['Authorization'] = `Bearer ${this.apiKey}`;
      }

      const body = {
        messages: [
          {
            role: 'system',
            content: 'You are a sensitive data detector. Analyze the text and identify any sensitive information like passwords, API keys, secrets, tokens, or credentials. Return a JSON array of objects with: start (number), end (number), category (string: PASSWORD, API_KEY, SECRET, TOKEN, CREDENTIAL, PRIVATE_KEY), confidence (number 0-1). Only return the JSON array, nothing else.'
          },
          { role: 'user', content: text }
        ],
        temperature: 0,
      };

      if (this.model) {
        body.model = this.model;
      }

      const response = await fetch(`${this.endpoint}/chat/completions`, {
        method: 'POST',
        headers,
        body: JSON.stringify(body)
      });

      if (!response.ok) {
        throw new Error(`Custom API error: ${response.status} ${response.statusText}`);
      }

      const data = await response.json();
      const content = data.choices[0]?.message?.content;
      
      if (!content) return [];

      const parsed = JSON.parse(content);
      return Array.isArray(parsed) ? parsed : (parsed.results || []);
    } catch (err) {
      console.warn(`[opencode-guard] Custom AI analysis failed: ${err.message}`);
      return [];
    }
  }
}

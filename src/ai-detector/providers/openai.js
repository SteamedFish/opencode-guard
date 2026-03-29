import { AIProvider } from './base.js';

export class OpenAIProvider extends AIProvider {
  constructor(config = {}) {
    super(config);
    this.apiKey = config.openaiApiKey || process.env.OPENAI_API_KEY;
    this.baseURL = config.aiEndpoint || config.baseURL || 'https://api.openai.com/v1';
    this.model = config.aiModel || config.model || 'gpt-4o-mini';
    
    if (!this.apiKey) {
      throw new Error('API key required for OpenAI provider');
    }
  }

  async detect(text) {
    try {
      const response = await fetch(`${this.baseURL}/chat/completions`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${this.apiKey}`,
        },
        body: JSON.stringify({
          model: this.model,
          messages: [
            {
              role: 'system',
              content: 'You are a sensitive data detector. Analyze the text and identify any sensitive information like passwords, API keys, secrets, tokens, or credentials. Return a JSON array of objects with: start (number), end (number), category (string: PASSWORD, API_KEY, SECRET, TOKEN, CREDENTIAL, PRIVATE_KEY), confidence (number 0-1). Only return the JSON array, nothing else.'
            },
            { role: 'user', content: text }
          ],
          temperature: 0,
          response_format: { type: 'json_object' }
        })
      });

      if (!response.ok) {
        throw new Error(`OpenAI API error: ${response.status} ${response.statusText}`);
      }

      const data = await response.json();
      const content = data.choices[0]?.message?.content;
      
      if (!content) return [];

      const parsed = JSON.parse(content);
      return Array.isArray(parsed) ? parsed : (parsed.results || []);
    } catch (err) {
      console.warn(`[opencode-guard] OpenAI analysis failed: ${err.message}`);
      return [];
    }
  }
}

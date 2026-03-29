import { describe, it } from 'node:test';
import assert from 'node:assert';
import { detectSensitiveData } from '../src/detector.js';
import { mergeResults } from '../src/ai-detector/merge.js';

describe('AI Detection Integration', () => {
  describe('detectSensitiveData with AI', () => {
    it('should accept aiDetector parameter', async () => {
      const aiDetector = {
        detect: async () => []
      };
      
      const results = await detectSensitiveData(
        'test@example.com',
        { regex: [], keywords: [] },
        aiDetector
      );
      
      assert.ok(Array.isArray(results));
    });

    it('should merge regex and AI results', async () => {
      const aiDetector = {
        detect: async () => [
          { start: 20, end: 30, text: 'AI_FOUND', category: 'AI', maskAs: 'pattern', confidence: 0.9 }
        ]
      };
      
      const patterns = {
        regex: [{
          regex: /test@example\.com/,
          category: 'EMAIL',
          maskAs: 'email'
        }]
      };
      
      const results = await detectSensitiveData(
        'Contact me at test@example.com for AI_FOUND here',
        patterns,
        aiDetector
      );
      
      assert.strictEqual(results.length, 2);
      assert.ok(results.some(r => r.category === 'EMAIL'));
      assert.ok(results.some(r => r.category === 'AI'));
    });

    it('should handle AI detector errors gracefully', async () => {
      const aiDetector = {
        detect: async () => { throw new Error('AI failed'); }
      };
      
      const patterns = {
        regex: [{
          regex: /test@example\.com/,
          category: 'EMAIL',
          maskAs: 'email'
        }]
      };
      
      const results = await detectSensitiveData(
        'test@example.com',
        patterns,
        aiDetector
      );
      
      assert.strictEqual(results.length, 1);
      assert.strictEqual(results[0].category, 'EMAIL');
    });

    it('should work without AI detector (null)', async () => {
      const patterns = {
        regex: [{
          regex: /secret123/,
          category: 'SECRET',
          maskAs: 'generic_credential'
        }]
      };
      
      const results = await detectSensitiveData(
        'My secret123 is hidden',
        patterns,
        null
      );
      
      assert.strictEqual(results.length, 1);
    });
  });

  describe('mergeResults', () => {
    it('should merge non-overlapping results', () => {
      const regex = [{ start: 0, end: 5, text: 'hello', category: 'A', maskAs: 'pattern' }];
      const ai = [{ start: 10, end: 15, text: 'world', category: 'B', maskAs: 'pattern' }];
      
      const merged = mergeResults(regex, ai);
      
      assert.strictEqual(merged.length, 2);
    });

    it('should prefer longer match on overlap', () => {
      const regex = [{ start: 0, end: 5, text: 'hello', category: 'A', maskAs: 'pattern' }];
      const ai = [{ start: 0, end: 10, text: 'helloworld', category: 'B', maskAs: 'pattern' }];
      
      const merged = mergeResults(regex, ai);
      
      assert.strictEqual(merged.length, 1);
      assert.strictEqual(merged[0].end, 10);
    });

    it('should prefer higher confidence when same length', () => {
      const regex = [{ start: 0, end: 5, text: 'hello', category: 'A', maskAs: 'pattern', confidence: 0.5 }];
      const ai = [{ start: 0, end: 5, text: 'hello', category: 'B', maskAs: 'pattern', confidence: 0.9 }];
      
      const merged = mergeResults(regex, ai);
      
      assert.strictEqual(merged.length, 1);
      assert.strictEqual(merged[0].category, 'B');
    });

    it('should sort results by start position', () => {
      const regex = [{ start: 10, end: 15, text: 'world', category: 'B', maskAs: 'pattern' }];
      const ai = [{ start: 0, end: 5, text: 'hello', category: 'A', maskAs: 'pattern' }];
      
      const merged = mergeResults(regex, ai);
      
      assert.strictEqual(merged[0].start, 0);
      assert.strictEqual(merged[1].start, 10);
    });
  });
});

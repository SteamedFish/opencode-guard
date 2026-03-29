# AI Detection Implementation Plan

> **REQUIRED SUB-SKILL:** Use executing-plans to implement this plan task-by-task.
> **CRITICAL:** Work MUST be done on a feature branch, NEVER on main/master.
> Use using-git-worktrees to create isolated workspace with new branch.

**Goal:** Implement AI-based sensitive data detection to complement regex patterns, detecting contextual secrets and free-form passwords that regex cannot catch.

**Architecture:** Create a pluggable AI detector system supporting multiple providers (local Transformers.js, OpenAI, custom endpoints). Run AI detection in parallel with regex detection when `ai_detection: true`. Merge results with conflict resolution (prefer longer matches). Implement timeouts and graceful fallbacks.

**Tech Stack:** Node.js ES Modules, @xenova/transformers (local), native fetch (remote APIs)

**Git Workflow:**
- Feature branch: `feature/ai-detection` (created by worktree)
- Push after EACH commit: `git push origin feature/ai-detection`
- Merge to main/master ONLY after ALL tests pass

---

## Background

Currently, the `ai_detection`, `ai_provider`, and `ai_timeout_ms` config options exist but are unused. This plan implements the feature.

**Config to implement:**
```json
{
  "detection": {
    "ai_detection": true,
    "ai_provider": "local",
    "ai_timeout_ms": 500
  }
}
```

---

## Task 1: Create AI Detector Module Structure

**Files:**
- Create: `src/ai-detector/index.js`
- Create: `src/ai-detector/providers.js`
- Create: `src/ai-detector/merge.js`
- Create: `tests/ai-detector/` directory

**Step 1: Create provider interface and registry**

`src/ai-detector/providers.js`:
```javascript
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
```

**Step 2: Create merge utility for combining regex + AI results**

`src/ai-detector/merge.js`:
```javascript
/**
 * Merge and deduplicate detection results from regex and AI
 * Conflict resolution: prefer longer matches, then higher confidence
 */

/**
 * @typedef {Object} DetectionResult
 * @property {number} start
 * @property {number} end
 * @property {string} text
 * @property {string} category
 * @property {string} maskAs
 * @property {number} [confidence] - AI confidence 0-1
 * @property {string} [source] - 'regex' or 'ai'
 */

/**
 * Merge two result sets, removing overlaps
 * @param {DetectionResult[]} regexResults
 * @param {DetectionResult[]} aiResults
 * @returns {DetectionResult[]}
 */
export function mergeResults(regexResults, aiResults) {
  // Tag sources
  const taggedRegex = regexResults.map(r => ({ ...r, source: 'regex', confidence: r.confidence ?? 1.0 }));
  const taggedAI = aiResults.map(r => ({ ...r, source: 'ai' }));
  
  // Combine and sort by start position
  const all = [...taggedRegex, ...taggedAI].sort((a, b) => a.start - b.start);
  
  const merged = [];
  
  for (const result of all) {
    let overlaps = false;
    
    for (let i = 0; i < merged.length; i++) {
      const existing = merged[i];
      
      // Check for overlap
      if (result.start < existing.end && result.end > existing.start) {
        const resultLen = result.end - result.start;
        const existingLen = existing.end - existing.start;
        
        // Prefer longer match, then higher confidence
        if (resultLen > existingLen || 
            (resultLen === existingLen && result.confidence > existing.confidence)) {
          merged[i] = result;
        }
        overlaps = true;
        break;
      }
    }
    
    if (!overlaps) {
      merged.push(result);
    }
  }
  
  return merged.sort((a, b) => a.start - b.start);
}
```

**Step 3: Create main AI detector module**

`src/ai-detector/index.js`:
```javascript
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
```

**Step 4: Commit**

```bash
git add src/ai-detector/ tests/ai-detector/
git commit -m "feat(ai): add AI detector module structure with merge logic"
git push origin feature/ai-detection
```

---

## Task 2: Implement Local Transformers.js Provider

**Files:**
- Create: `src/ai-detector/providers/local.js`
- Create: `tests/ai-detector/local.test.js`

**Step 1: Write the failing test**

`tests/ai-detector/local.test.js`:
```javascript
import { test } from 'node:test';
import assert from 'node:assert';
import { LocalAIProvider } from '../../src/ai-detector/providers/local.js';

test('LocalAIProvider detects password in sentence', async () => {
  const provider = new LocalAIProvider({});
  
  // Skip if model not available
  if (!provider.isAvailable()) {
    console.log('Skipping: Transformers.js not installed');
    return;
  }
  
  await provider.initialize();
  
  const text = 'My password is secret123xyz';
  const results = await provider.analyze(text);
  
  // Should detect the password
  assert.ok(results.length > 0, 'Should detect at least one sensitive item');
  assert.ok(results.some(r => r.category === 'PASSWORD'), 'Should categorize as PASSWORD');
});

test('LocalAIProvider detects API key in code', async () => {
  const provider = new LocalAIProvider({});
  
  if (!provider.isAvailable()) {
    console.log('Skipping: Transformers.js not installed');
    return;
  }
  
  await provider.initialize();
  
  const text = 'const apiKey = "sk-abc123def456ghi789"';
  const results = await provider.analyze(text);
  
  assert.ok(results.some(r => r.category === 'API_KEY' || r.category === 'SECRET'));
});
```

**Step 2: Run test to verify it fails**

```bash
npm test tests/ai-detector/local.test.js
```
Expected: FAIL with "Cannot find module"

**Step 3: Implement local provider**

`src/ai-detector/providers/local.js`:
```javascript
import { AIProvider } from '../providers.js';

/**
 * Local AI Provider using Transformers.js
 * Runs NER (Named Entity Recognition) or text classification locally
 */
export class LocalAIProvider extends AIProvider {
  constructor(config = {}) {
    super(config);
    this.model = null;
    this.pipeline = null;
    this.modelName = config.model || 'Xenova/distilbert-base-uncased-finetuned-sst-2-english';
    this.initialized = false;
  }

  /**
   * Check if Transformers.js is available
   */
  isAvailable() {
    try {
      // Dynamic import to avoid hard dependency
      const module = require('@xenova/transformers');
      return !!module.pipeline;
    } catch {
      return false;
    }
  }

  async initialize() {
    if (this.initialized) return;
    
    try {
      // Dynamic import
      const { pipeline } = await import('@xenova/transformers');
      
      // Use token classification for entity detection
      // or text classification with custom logic
      this.pipeline = await pipeline(
        'token-classification',
        this.modelName,
        { quantized: true } // Use quantized for speed
      );
      
      this.initialized = true;
    } catch (err) {
      console.warn(`[opencode-guard] Failed to load local AI model: ${err.message}`);
      throw err;
    }
  }

  /**
   * Analyze text for sensitive entities
   * Maps token classification results to sensitive data categories
   */
  async analyze(text) {
    if (!this.initialized) {
      await this.initialize();
    }

    if (!this.pipeline) {
      return [];
    }

    try {
      const outputs = await this.pipeline(text);
      return this._processOutputs(outputs, text);
    } catch (err) {
      console.warn(`[opencode-guard] Local AI analysis failed: ${err.message}`);
      return [];
    }
  }

  /**
   * Process token classification outputs
   * Group tokens into entities and map to categories
   */
  _processOutputs(outputs, originalText) {
    const results = [];
    let currentEntity = null;

    for (const token of outputs) {
      const entity = token.entity;
      const word = token.word;
      const score = token.score;
      
      // Map entity types to our categories
      const category = this._mapEntityType(entity);
      
      if (!category) continue;

      // Find position in original text
      const start = originalText.indexOf(word);
      if (start === -1) continue;
      
      const end = start + word.length;

      // Group consecutive tokens of same type
      if (currentEntity && currentEntity.category === category) {
        currentEntity.end = end;
        currentEntity.text = originalText.slice(currentEntity.start, end);
        currentEntity.confidence = Math.min(currentEntity.confidence, score);
      } else {
        if (currentEntity) {
          results.push(currentEntity);
        }
        currentEntity = {
          start,
          end,
          text: word,
          category,
          confidence: score,
        };
      }
    }

    if (currentEntity) {
      results.push(currentEntity);
    }

    return results;
  }

  /**
   * Map HuggingFace entity types to our categories
   */
  _mapEntityType(entityType) {
    // Standard NER mappings
    const mappings = {
      'PER': null, // Person - not sensitive for us
      'ORG': null, // Organization
      'LOC': null, // Location
      'MISC': null,
      'LABEL_0': null,
      'LABEL_1': 'PASSWORD', // Custom model labels
      'SENSITIVE': 'SECRET',
      'SECRET': 'SECRET',
      'API_KEY': 'API_KEY',
      'PASSWORD': 'PASSWORD',
    };

    // Check for B- (begin) or I- (inside) prefixes
    const cleanType = entityType.replace(/^[BI]-/, '');
    return mappings[cleanType] || null;
  }
}
```

**Step 4: Update providers.js to export LocalAIProvider**

Add to `src/ai-detector/providers.js`:
```javascript
export { LocalAIProvider } from './providers/local.js';
```

**Step 5: Run test to verify it passes**

```bash
npm test tests/ai-detector/local.test.js
```
Expected: PASS (or SKIP if transformers not installed)

**Step 6: Commit**

```bash
git add src/ai-detector/providers/ tests/ai-detector/
git commit -m "feat(ai): implement local Transformers.js provider"
git push origin feature/ai-detection
```

---

## Task 3: Implement OpenAI Provider

**Files:**
- Create: `src/ai-detector/providers/openai.js`
- Create: `tests/ai-detector/openai.test.js`

**Step 1: Write the failing test**

`tests/ai-detector/openai.test.js`:
```javascript
import { test } from 'node:test';
import assert from 'node:assert';
import { OpenAIProvider } from '../../src/ai-detector/providers/openai.js';

test('OpenAIProvider requires API key', () => {
  assert.throws(() => {
    new OpenAIProvider({});
  }, /API key required/);
});

test('OpenAIProvider structure is valid', () => {
  const provider = new OpenAIProvider({ 
    apiKey: 'sk-test123',
    model: 'gpt-4o-mini'
  });
  
  assert.ok(provider.isAvailable());
  assert.strictEqual(typeof provider.analyze, 'function');
});
```

**Step 2: Run test to verify it fails**

```bash
npm test tests/ai-detector/openai.test.js
```
Expected: FAIL with "Cannot find module"

**Step 3: Implement OpenAI provider**

`src/ai-detector/providers/openai.js`:
```javascript
import { AIProvider } from '../providers.js';

/**
 * OpenAI Provider for AI detection
 * Uses GPT-4 or other models via API
 */
export class OpenAIProvider extends AIProvider {
  constructor(config = {}) {
    super(config);
    this.apiKey = config.apiKey || config.openaiApiKey;
    this.baseURL = config.baseURL || 'https://api.openai.com/v1';
    this.model = config.model || 'gpt-4o-mini';
    
    if (!this.apiKey) {
      throw new Error('OpenAI API key required');
    }
  }

  isAvailable() {
    return true; // Always available if API key provided
  }

  /**
   * Analyze text using OpenAI API
   */
  async analyze(text) {
    const prompt = this._buildPrompt(text);
    
    const response = await fetch(`${this.baseURL}/chat/completions`, {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${this.apiKey}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        model: this.model,
        messages: [
          {
            role: 'system',
            content: 'You are a sensitive data detector. Analyze text and return JSON array of detected sensitive items with positions. Categories: PASSWORD, API_KEY, SECRET, TOKEN, PRIVATE_KEY.'
          },
          {
            role: 'user',
            content: prompt,
          }
        ],
        response_format: { type: 'json_object' },
        max_tokens: 500,
      }),
    });

    if (!response.ok) {
      throw new Error(`OpenAI API error: ${response.status} ${response.statusText}`);
    }

    const data = await response.json();
    return this._parseResponse(data, text);
  }

  _buildPrompt(text) {
    return `Analyze the following text for sensitive data like passwords, API keys, secrets, tokens, or private keys.

Text: """${text}"""

Return a JSON object with this structure:
{
  "detections": [
    {
      "start": 0,      // character position in text
      "end": 10,       // end position
      "category": "PASSWORD",  // PASSWORD, API_KEY, SECRET, TOKEN, PRIVATE_KEY
      "confidence": 0.95       // 0-1 confidence score
    }
  ]
}

Only include actual sensitive values, not context words like "password" or "key" unless they contain the value.`;
  }

  _parseResponse(data, originalText) {
    try {
      const content = data.choices?.[0]?.message?.content;
      if (!content) return [];
      
      const parsed = JSON.parse(content);
      const detections = parsed.detections || [];
      
      return detections.map(d => ({
        start: d.start,
        end: d.end,
        text: originalText.slice(d.start, d.end),
        category: d.category,
        confidence: d.confidence,
      }));
    } catch (err) {
      console.warn(`[opencode-guard] Failed to parse OpenAI response: ${err.message}`);
      return [];
    }
  }
}
```

**Step 4: Update providers.js to export OpenAIProvider**

Add to `src/ai-detector/providers.js`:
```javascript
export { OpenAIProvider } from './providers/openai.js';
```

**Step 5: Run test to verify it passes**

```bash
npm test tests/ai-detector/openai.test.js
```
Expected: PASS

**Step 6: Commit**

```bash
git add src/ai-detector/providers/ tests/ai-detector/
git commit -m "feat(ai): implement OpenAI API provider"
git push origin feature/ai-detection
```

---

## Task 4: Implement Custom Endpoint Provider

**Files:**
- Create: `src/ai-detector/providers/custom.js`
- Create: `tests/ai-detector/custom.test.js`

**Step 1: Write the failing test**

`tests/ai-detector/custom.test.js`:
```javascript
import { test } from 'node:test';
import assert from 'node:assert';
import { CustomAIProvider } from '../../src/ai-detector/providers/custom.js';

test('CustomAIProvider requires endpoint URL', () => {
  assert.throws(() => {
    new CustomAIProvider({});
  }, /endpoint URL required/);
});

test('CustomAIProvider structure is valid', () => {
  const provider = new CustomAIProvider({ 
    endpoint: 'http://localhost:8000/analyze'
  });
  
  assert.ok(provider.isAvailable());
  assert.strictEqual(typeof provider.analyze, 'function');
});
```

**Step 2: Run test to verify it fails**

```bash
npm test tests/ai-detector/custom.test.js
```
Expected: FAIL with "Cannot find module"

**Step 3: Implement custom provider**

`src/ai-detector/providers/custom.js`:
```javascript
import { AIProvider } from '../providers.js';

/**
 * Custom AI Provider for self-hosted or third-party endpoints
 * Compatible with OpenAI-compatible APIs (Ollama, LocalAI, etc.)
 */
export class CustomAIProvider extends AIProvider {
  constructor(config = {}) {
    super(config);
    this.endpoint = config.endpoint || config.customEndpoint;
    this.apiKey = config.apiKey;
    this.headers = config.headers || {};
    
    if (!this.endpoint) {
      throw new Error('Custom endpoint URL required');
    }
  }

  isAvailable() {
    return true;
  }

  /**
   * Send text to custom endpoint for analysis
   */
  async analyze(text) {
    const headers = {
      'Content-Type': 'application/json',
      ...this.headers,
    };
    
    if (this.apiKey) {
      headers['Authorization'] = `Bearer ${this.apiKey}`;
    }

    const response = await fetch(this.endpoint, {
      method: 'POST',
      headers,
      body: JSON.stringify({
        text,
        task: 'sensitive_data_detection',
      }),
    });

    if (!response.ok) {
      throw new Error(`Custom endpoint error: ${response.status}`);
    }

    const data = await response.json();
    return this._normalizeResponse(data, text);
  }

  /**
   * Normalize various response formats to standard format
   */
  _normalizeResponse(data, originalText) {
    // Try to detect common response formats
    
    // Format 1: { detections: [...] }
    if (data.detections && Array.isArray(data.detections)) {
      return data.detections.map(d => ({
        start: d.start ?? d.position ?? 0,
        end: d.end ?? (d.start + d.text?.length) ?? 0,
        text: d.text ?? originalText.slice(d.start, d.end),
        category: d.category ?? d.type ?? 'SECRET',
        confidence: d.confidence ?? d.score ?? 0.8,
      }));
    }
    
    // Format 2: { results: [...] }
    if (data.results && Array.isArray(data.results)) {
      return data.results.map(r => ({
        start: r.start ?? 0,
        end: r.end ?? r.start + r.length ?? 0,
        text: r.text ?? r.value ?? originalText.slice(r.start, r.end),
        category: r.category ?? r.label ?? 'SECRET',
        confidence: r.confidence ?? r.score ?? 0.8,
      }));
    }
    
    // Format 3: Array directly
    if (Array.isArray(data)) {
      return data.map(item => ({
        start: item.start ?? 0,
        end: item.end ?? item.start + (item.text?.length || 0),
        text: item.text ?? item.value ?? '',
        category: item.category ?? item.type ?? 'SECRET',
        confidence: item.confidence ?? 0.8,
      }));
    }
    
    console.warn('[opencode-guard] Unrecognized custom endpoint response format');
    return [];
  }
}
```

**Step 4: Update providers.js to export CustomAIProvider**

Add to `src/ai-detector/providers.js`:
```javascript
export { CustomAIProvider } from './providers/custom.js';
```

**Step 5: Run test to verify it passes**

```bash
npm test tests/ai-detector/custom.test.js
```
Expected: PASS

**Step 6: Commit**

```bash
git add src/ai-detector/providers/ tests/ai-detector/
git commit -m "feat(ai): implement custom endpoint provider"
git push origin feature/ai-detection
```

---

## Task 5: Integrate AI Detection into Main Detector

**Files:**
- Modify: `src/detector.js`
- Modify: `tests/detector.test.js`

**Step 1: Write tests for AI integration**

Add to `tests/detector.test.js`:
```javascript
import { AIDetector } from '../src/ai-detector/index.js';

test('detectSensitiveData with aiDetection enabled', async () => {
  const text = 'The password is secret123 and api key is sk-abc123';
  const patterns = buildPatternSet({ builtin: [], regex: [] });
  
  const aiDetector = new AIDetector({
    aiProvider: 'local',
    aiTimeoutMs: 1000,
  });
  
  const results = await detectSensitiveData(text, patterns, {
    aiDetector,
    aiDetection: true,
  });
  
  // Should have results from AI even with empty regex patterns
  assert.ok(results.length > 0, 'AI should detect sensitive data');
});

test('detectSensitiveData falls back to regex when AI fails', async () => {
  const text = 'email: test@example.com';
  const patterns = buildPatternSet({ builtin: ['email'] });
  
  const results = await detectSensitiveData(text, patterns, {
    aiDetection: false, // AI disabled
  });
  
  assert.ok(results.some(r => r.category === 'EMAIL'));
});
```

**Step 2: Run test to verify it fails**

```bash
npm test tests/detector.test.js
```
Expected: FAIL with new tests failing

**Step 3: Modify detector.js to integrate AI**

`src/detector.js`:
```javascript
import { AIDetector } from './ai-detector/index.js';
import { mergeResults } from './ai-detector/merge.js';

export async function detectSensitiveData(text, patterns, options = {}) {
  if (typeof text !== 'string' || !text) {
    return [];
  }

  // Run regex detection (always)
  const regexResults = await detectWithRegex(text, patterns);
  
  // Run AI detection if enabled
  let aiResults = [];
  if (options.aiDetection && options.aiDetector) {
    try {
      aiResults = await options.aiDetector.detect(text);
    } catch (err) {
      if (process.env.OPENCODE_GUARD_DEBUG) {
        console.warn(`[opencode-guard] AI detection error: ${err.message}`);
      }
    }
  }
  
  // Merge results if AI ran, otherwise just return regex
  if (aiResults.length > 0) {
    return mergeResults(regexResults, aiResults);
  }
  
  return regexResults;
}

async function detectWithRegex(text, patterns) {
  const results = [];
  const seen = new Set();
  
  for (const rule of (patterns.regex || [])) {
    const regex = new RegExp(rule.regex.source, rule.regex.flags);
    let match;
    let lastIndex = -1;
    while ((match = regex.exec(text)) !== null) {
      const matchedText = match[0];

      if (match.index === lastIndex) {
        regex.lastIndex++;
        continue;
      }
      lastIndex = match.index;

      if (patterns.exclude?.has(matchedText)) continue;

      const key = `${match.index}-${match.index + matchedText.length}`;
      if (!seen.has(key)) {
        seen.add(key);
        results.push({
          start: match.index,
          end: match.index + matchedText.length,
          text: matchedText,
          category: rule.category,
          maskAs: rule.maskAs,
        });
      }
    }
  }
  
  for (const keyword of (patterns.keywords || [])) {
    const value = keyword.value;
    let pos = 0;
    while ((pos = text.indexOf(value, pos)) !== -1) {
      if (patterns.exclude?.has(value)) continue;
      
      const key = `${pos}-${pos + value.length}`;
      if (!seen.has(key)) {
        seen.add(key);
        results.push({
          start: pos,
          end: pos + value.length,
          text: value,
          category: keyword.category,
          maskAs: keyword.maskAs,
        });
      }
      pos += value.length;
    }
  }
  
  results.sort((a, b) => a.start - b.start);
  
  const filtered = [];
  for (const result of results) {
    let overlaps = false;
    for (const existing of filtered) {
      if (result.start < existing.end && result.end > existing.start) {
        if (result.end - result.start > existing.end - existing.start) {
          filtered[filtered.indexOf(existing)] = result;
        }
        overlaps = true;
        break;
      }
    }
    if (!overlaps) filtered.push(result);
  }
  
  return filtered.sort((a, b) => a.start - b.start);
}
```

**Step 4: Run test to verify it passes**

```bash
npm test tests/detector.test.js
```
Expected: PASS

**Step 5: Commit**

```bash
git add src/detector.js tests/detector.test.js
git commit -m "feat(ai): integrate AI detection into main detector pipeline"
git push origin feature/ai-detection
```

---

## Task 6: Integrate AI Detector into Plugin

**Files:**
- Modify: `src/index.js`
- Modify: `tests/index.test.js`

**Step 1: Modify index.js to create and use AI detector**

Modify `src/index.js`:
```javascript
import { loadConfig } from './config.js';
import { buildPatternSet } from './patterns.js';
import { MaskSession } from './session.js';
import { redactText, redactDeep } from './engine.js';
import { restoreText, restoreDeep } from './restore.js';
import { initializeCustomMaskers } from './maskers/index.js';
import { StreamingUnmasker } from './streaming-unmasker.js';
import { AIDetector } from './ai-detector/index.js';

// ... existing code ...

export const OpenCodeGuard = async (ctx) => {
  const config = await loadConfig(ctx.directory);
  const debug = Boolean(process.env.OPENCODE_GUARD_DEBUG) || config.debug;

  if (debug) {
    const from = config.loadedFrom ? config.loadedFrom : 'not found (plugin disabled)';
    console.log(`[opencode-guard] config: ${from}, enabled=${config.enabled}`);
  }

  if (!config.enabled || !config.globalSalt) {
    return {};
  }

  initializeCustomMaskers(config.customMaskers);

  const patterns = buildPatternSet(config.patterns);
  const sessions = new Map();
  const streamingUnmaskers = new Map();
  
  // Initialize AI detector if enabled
  let aiDetector = null;
  if (config.detection?.aiDetection) {
    try {
      aiDetector = new AIDetector({
        provider: config.detection.aiProvider,
        timeoutMs: config.detection.aiTimeoutMs,
        apiKey: config.detection.aiApiKey,
        endpoint: config.detection.aiEndpoint,
        model: config.detection.aiModel,
      });
      if (debug) {
        console.log(`[opencode-guard] AI detection enabled (${config.detection.aiProvider})`);
      }
    } catch (err) {
      console.warn(`[opencode-guard] Failed to initialize AI detector: ${err.message}`);
    }
  }

  // ... existing code ...

  return {
    'experimental.chat.messages.transform': async (_input, output) => {
      // ... existing code ...
      
      for (const msg of msgs) {
        const parts = Array.isArray(msg?.parts) ? msg.parts : [];
        for (const part of parts) {
          if (!part) continue;

          if (part.type === 'text' || part.type === 'reasoning') {
            if (!part.text || typeof part.text !== 'string') continue;
            if (part.ignored) continue;
            
            // Pass AI detector to redactText
            const result = await redactText(part.text, patterns, session, {
              aiDetector,
              aiDetection: config.detection?.aiDetection && aiDetector !== null,
            });
            
            if (result.count > 0) {
              part.text = result.text;
              changedCount += result.count;
            }
            continue;
          }
          
          // ... rest of existing code ...
        }
      }
      
      // ... existing code ...
    },
    
    // ... other hooks ...
  };
};
```

**Step 2: Update engine.js to accept AI options**

Modify `src/engine.js`:
```javascript
export async function redactText(text, patterns, session, options = {}) {
  if (typeof text !== 'string' || !text) {
    return { text, count: 0 };
  }
  
  const matches = await detectSensitiveData(text, patterns, {
    aiDetector: options.aiDetector,
    aiDetection: options.aiDetection,
  });
  
  // ... rest of existing code ...
}
```

**Step 3: Run all tests**

```bash
npm test
```
Expected: PASS

**Step 4: Commit**

```bash
git add src/index.js src/engine.js tests/index.test.js
git commit -m "feat(ai): integrate AI detector into plugin lifecycle"
git push origin feature/ai-detection
```

---

## Task 7: Add Configuration Examples and Documentation

**Files:**
- Modify: `vibeguard.config.json.example`
- Modify: `README.md`
- Create: `docs/AI_DETECTION.md`

**Step 1: Update config example**

Add to `vibeguard.config.json.example`:
```json
{
  "detection": {
    "parallel": true,
    "ai_detection": false,
    "ai_provider": "local",
    "ai_timeout_ms": 500,
    "ai_api_key": null,
    "ai_endpoint": null,
    "ai_model": null
  }
}
```

**Step 2: Create AI detection documentation**

`docs/AI_DETECTION.md`:
```markdown
# AI Detection

OpenCode Guard supports AI-based sensitive data detection to complement regex patterns.

## When to Use AI Detection

AI detection is useful for:
- **Contextual secrets**: Free-form passwords in sentences ("my password is xyz")
- **Novel patterns**: Detecting secrets that don't match known regex patterns
- **False positive reduction**: Better understanding of context

## Configuration

### Local Provider (Default)

Uses Transformers.js with local models - no API key required.

```json
{
  "detection": {
    "ai_detection": true,
    "ai_provider": "local",
    "ai_timeout_ms": 1000
  }
}
```

**Pros:**
- No data leaves your machine
- No API costs
- Works offline

**Cons:**
- Requires `@xenova/transformers` package
- Slower on first run (model download)
- Less accurate than cloud models

**Installation:**
```bash
npm install @xenova/transformers
```

### OpenAI Provider

Uses OpenAI API for detection.

```json
{
  "detection": {
    "ai_detection": true,
    "ai_provider": "openai",
    "ai_api_key": "sk-your-key",
    "ai_model": "gpt-4o-mini",
    "ai_timeout_ms": 3000
  }
}
```

### Custom Provider

For self-hosted models (Ollama, LocalAI, etc.).

```json
{
  "detection": {
    "ai_detection": true,
    "ai_provider": "custom",
    "ai_endpoint": "http://localhost:11434/api/analyze",
    "ai_timeout_ms": 5000
  }
}
```

## How It Works

1. **Regex detection** runs first (fast, deterministic)
2. **AI detection** runs in parallel if enabled
3. **Results are merged** with conflict resolution:
   - Prefer longer matches
   - Then prefer higher confidence
   - Regex wins ties (lower latency)

## Performance Considerations

- AI detection adds latency (100ms-3000ms depending on provider)
- Use `ai_timeout_ms` to cap maximum wait time
- Consider disabling AI for real-time streaming scenarios
- Local provider caches models after first download

## Troubleshooting

**"AI detection failed" warnings:**
- Check provider configuration
- Increase `ai_timeout_ms`
- Enable debug mode: `OPENCODE_GUARD_DEBUG=1`

**Local model download slow:**
- First run downloads ~100MB-500MB model
- Subsequent runs use cached model

**High API costs (OpenAI):**
- Reduce `ai_timeout_ms` to fail faster
- Consider local provider for high-volume usage
```

**Step 3: Update README.md**

Add section to `README.md`:
```markdown
## AI Detection (Optional)

For enhanced detection of contextual secrets, enable AI detection:

```json
{
  "detection": {
    "ai_detection": true,
    "ai_provider": "local",
    "ai_timeout_ms": 500
  }
}
```

See [docs/AI_DETECTION.md](docs/AI_DETECTION.md) for full configuration options.
```

**Step 4: Commit**

```bash
git add vibeguard.config.json.example README.md docs/AI_DETECTION.md
git commit -m "docs(ai): add AI detection configuration examples and documentation"
git push origin feature/ai-detection
```

---

## Task 8: Add Package Dependencies (Optional)

**Files:**
- Modify: `package.json`

**Step 1: Add optional dependency**

`package.json`:
```json
{
  "optionalDependencies": {
    "@xenova/transformers": "^2.17.2"
  },
  "peerDependenciesMeta": {
    "@xenova/transformers": {
      "optional": true
    }
  }
}
```

**Step 2: Commit**

```bash
git add package.json
git commit -m "chore(deps): add optional dependency for local AI provider"
git push origin feature/ai-detection
```

---

## Task 9: Final Integration Test

**Files:**
- Create: `tests/ai-integration.test.js`

**Step 1: Create comprehensive integration test**

```javascript
import { test } from 'node:test';
import assert from 'node:assert';
import { detectSensitiveData } from '../src/detector.js';
import { buildPatternSet } from '../src/patterns.js';
import { AIDetector } from '../src/ai-detector/index.js';

test('AI + Regex detection combined', async () => {
  const text = 'Email: user@example.com and password is secret123';
  const patterns = buildPatternSet({ builtin: ['email'] });
  
  // Mock AI detector
  const mockAI = {
    detect: async () => [{
      start: 32,
      end: 41,
      text: 'secret123',
      category: 'PASSWORD',
      confidence: 0.95,
    }]
  };
  
  const results = await detectSensitiveData(text, patterns, {
    aiDetection: true,
    aiDetector: mockAI,
  });
  
  // Should detect both email (regex) and password (AI)
  assert.ok(results.some(r => r.category === 'EMAIL'));
  assert.ok(results.some(r => r.category === 'PASSWORD'));
});

test('AI detection respects timeout', async () => {
  const text = 'Some text';
  const patterns = buildPatternSet({});
  
  // Mock AI that takes too long
  const slowAI = {
    detect: async () => new Promise(resolve => setTimeout(resolve, 10000)),
  };
  
  // Should timeout and return regex results only (empty in this case)
  const results = await detectSensitiveData(text, patterns, {
    aiDetection: true,
    aiDetector: slowAI,
  });
  
  // Should not hang, returns empty array
  assert.strictEqual(results.length, 0);
});
```

**Step 2: Run integration test**

```bash
npm test tests/ai-integration.test.js
```

**Step 3: Run full test suite**

```bash
npm test
```

**Step 4: Commit**

```bash
git add tests/ai-integration.test.js
git commit -m "test(ai): add AI detection integration tests"
git push origin feature/ai-detection
```

---

## Completion Checklist

- [ ] All providers implemented (local, openai, custom)
- [ ] AI detection integrated into detector pipeline
- [ ] Plugin hooks updated to use AI detector
- [ ] Merge logic handles overlaps correctly
- [ ] Timeout handling works
- [ ] Tests cover all major paths
- [ ] Documentation updated
- [ ] Config examples added
- [ ] All tests passing

## Next Steps After Implementation

1. **Test with real data** - Verify detection quality on actual sensitive data samples
2. **Performance tuning** - Adjust default timeout based on real-world usage
3. **Model selection** - Evaluate different models for accuracy vs speed trade-offs
4. **Additional providers** - Consider adding Anthropic, Google, or other providers

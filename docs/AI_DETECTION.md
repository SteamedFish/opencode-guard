# AI Detection Feature

OpenCode Guard now includes AI-powered sensitive data detection that can identify secrets and PII that traditional regex patterns might miss.

## Overview

AI Detection uses machine learning models to contextually analyze text and identify:
- Passwords and secrets in natural language
- API keys in code snippets
- Credentials embedded in logs
- PII mentioned in conversation

This complements the existing regex-based detection by catching edge cases and context-dependent sensitive information.

## Providers

Three AI provider options are available:

### 1. Local (Default) - Transformers.js

Uses `@xenova/transformers` for on-device inference. No data leaves your machine.

**Pros:**
- 100% private - no API calls
- No network latency
- Works offline
- Free

**Cons:**
- Requires model download (~100MB on first run)
- Slower than cloud APIs
- Lower accuracy than GPT-4

**Setup:**

Option 1 - Manual installation:
```bash
npm install @xenova/transformers
```

Option 2 - Auto-installation (automatically installs package on first use):
```json
{
  "detection": {
    "ai_detection": true,
    "ai_provider": "local",
    "auto_install_deps": true,
    "ai_timeout_ms": 500
  }
}
```

**Configuration:**
```json
{
  "detection": {
    "ai_detection": true,
    "ai_provider": "local",
    "local_model": "SoelMgd/bert-pii-detection",
    "auto_install_deps": false,
    "ai_timeout_ms": 500
  }
}
```

**Model Downloads:**

The first time you use a local model, it will be automatically downloaded and cached:
- **Location**: `~/.cache/huggingface/hub/` (can be changed via `HF_HOME` environment variable)
- **Size**: ~100MB per model
- **Offline use**: Once downloaded, models work offline
- **Cleanup**: Delete the cache directory to remove models

#### Recommended Local Models

The local provider uses token classification models. **Important: You need PII-specific models, not general NER models.**

**What's the difference?**
- **PII Models**: Detect passwords, API keys, credit cards, SSNs, emails, secrets
- **NER Models**: Only detect names, organizations, locations (PER, ORG, LOC, MISC)

**Why smaller models work better:**
- Large language models (7B+ parameters) may "overthink" and try to interpret content instead of just identifying patterns
- They might generate explanatory text or "help" in unexpected ways
- Smaller, task-specific models are trained for exactly one job: detecting sensitive data

**Recommended PII Detection Models (All Compatible with Transformers.js):**

| Model | Size | Architecture | Best For | Password/Secret Detection | Notes |
|-------|------|--------------|----------|---------------------------|-------|
| `SoelMgd/bert-pii-detection` | ~66MB | DistilBERT | **General PII** | ✅ Yes | **Recommended default**. 56 PII categories, AI4Privacy dataset |
| `gneeraj/deeppass2-bert` | ~560MB | XLM-RoBERTa | **Passwords, secrets, API keys** | ✅ Yes | Specifically trained for secret detection in code |
| `iiiorg/piiranha-v1-detect-personal-information` | ~400MB | DeBERTa-v3 | **PII-heavy content** | ✅ Yes (98% precision on passwords) | 17 PII types, 99.44% accuracy |
| `gravitee-io/bert-small-pii-detection` | ~30MB | BERT-small | **General PII** | ✅ Yes | Lightweight option for resource-constrained environments |

**Model Details:**

**SoelMgd/bert-pii-detection** (Recommended Default)
- **Architecture**: DistilBERT (fully compatible with transformers.js)
- **Size**: ~66MB download
- **Training**: AI4Privacy PII-42k dataset
- **Categories**: 56 PII types including:
  - Credentials: PASSWORD, USERNAME, API_KEY, SECRET_KEY
  - Financial: CREDIT_CARD, BANK_ACCOUNT, SWIFT_BIC
  - Personal: EMAIL, PHONE_NUMBER, SSN, DATE_OF_BIRTH
  - Location: ADDRESS, CITY, ZIP_CODE, COUNTRY
  - Online: IP_ADDRESS, MAC_ADDRESS, URL

**gneeraj/deeppass2-bert**
- **Architecture**: XLM-RoBERTa (compatible with transformers.js)
- **Size**: ~560MB download
- **Training**: Focused on secret detection in code
- **Best For**: Detecting hardcoded passwords, API keys, tokens in source code
- **Blog**: [SpecterOps DeepPass2 announcement](https://specterops.io/blog/2025/07/31/whats-your-secret-secret-scanning-by-deeppass2/)

**iiiorg/piiranha-v1-detect-personal-information**
- **Architecture**: DeBERTa-v3 (supported by transformers.js)
- **Size**: ~400MB download
- **Training**: AI4Privacy PII-200k dataset
- **Categories**: 17 PII types across 6 languages
- **Accuracy**: 99.44% overall, 100% email accuracy, 98% password precision
- **Note**: Previously thought incompatible, but DeBERTa IS supported by @xenova/transformers

**gravitee-io/bert-small-pii-detection**
- **Architecture**: BERT-small (compatible with transformers.js)
- **Size**: ~30MB download
- **Training**: Combined multiple PII datasets
- **Best For**: Resource-constrained environments where speed matters

**⚠️ Models to AVOID:**

| Model | Why Avoid |
|-------|-----------|
| `Xenova/bert-base-NER` | **NER model only** - detects PER, ORG, LOC, MISC. Does NOT detect passwords or API keys |
| `dslim/bert-base-NER` | Same limitation - NER only |
| `joneauxedgar/pasteproof-pii-detector-v2` | Uses ModernBERT architecture - **NOT supported** by @xenova/transformers |
| Large conversational models (Llama, Mistral, etc.) | Unsuitable for token classification tasks |
| Code generation models | Trained for different tasks entirely |

**How to verify a model is PII vs NER:**

Check the model's label list:
- **PII labels**: PASSWORD, API_KEY, CREDIT_CARD, SSN, EMAIL, SECRET
- **NER labels**: PER, ORG, LOC, MISC (names, organizations, locations)

Example with SoelMgd/bert-pii-detection:
```javascript
const { pipeline } = require('@xenova/transformers');

const detector = await pipeline('token-classification', 'SoelMgd/bert-pii-detection');
const result = await detector('My password is SuperSecret123!');
// Detects: "SuperSecret123!" as PASSWORD
```

**Custom model configuration:**
```json
{
  "detection": {
    "ai_detection": true,
    "ai_provider": "local",
    "local_model": "SoelMgd/bert-pii-detection",
    "ai_timeout_ms": 500
  }
}
```

### 2. OpenAI

Uses OpenAI's GPT-4 for high-accuracy detection.

**Pros:**
- Highest accuracy
- Fast response times
- Good at understanding context

**Cons:**
- Data sent to OpenAI API
- Requires API key
- Costs money per request

**Configuration:**
```json
{
  "detection": {
    "ai_detection": true,
    "ai_provider": "openai",
    "ai_timeout_ms": 2000,
    "openai_api_key": "sk-...",
    "openai_model": "gpt-4"
  }
}
```

### 3. Custom / Self-Hosted

Use your own OpenAI-compatible API endpoint (Ollama, LocalAI, etc.)

**Pros:**
- Private if self-hosted
- No per-request costs
- Customizable models

**Cons:**
- Requires infrastructure setup
- Model quality varies

**Configuration:**
```json
{
  "detection": {
    "ai_detection": true,
    "ai_provider": "custom",
    "ai_timeout_ms": 5000,
    "custom_api_endpoint": "http://localhost:1234/v1",
    "custom_api_key": "optional-api-key"
  }
}
```

## Architecture Compatibility

### Supported by @xenova/transformers:
- ✅ BERT
- ✅ DistilBERT
- ✅ RoBERTa / XLM-RoBERTa
- ✅ DeBERTa / DeBERTa-v2 / DeBERTa-v3
- ✅ ELECTRA
- ✅ MobileBERT

### NOT Supported:
- ❌ ModernBERT
- ❌ GPT/LLaMA/Mistral (for token classification - different task)

## Examples

### Detecting passwords in natural language

Input:
```
My database password is SuperSecret123! and my API key is sk-abc123...
```

Regex detects: `sk-abc123...`
AI detects: `SuperSecret123!`

### Detecting secrets in code

Input:
```javascript
const config = {
  password: 'hunter2',
  apiKey: process.env.API_KEY
};
```

Regex detects: None (no obvious pattern)
AI detects: `hunter2` as a password

### Detecting PII in logs

Input:
```
User john@example.com logged in with password "MyP@ssw0rd!" from 192.168.1.100
```

Regex detects: `john@example.com`, `192.168.1.100`
AI detects: `MyP@ssw0rd!` as a password

## Troubleshooting

### Model fails to load

1. Check architecture compatibility - ensure model uses BERT/DistilBERT/RoBERTa/DeBERTa
2. Verify you're using a PII model, not an NER model:
   ```javascript
   // Check model labels
   const detector = await pipeline('token-classification', 'model-name');
   console.log(detector.model.config.id2label);
   // Should show: PASSWORD, API_KEY, etc. (not PER, ORG, LOC)
   ```
3. Check internet connection for initial download
4. Clear cache and retry: `rm -rf ~/.cache/huggingface/hub/`

### Model downloads but doesn't detect passwords

The model is likely an NER model, not a PII model:
- NER models detect: names, organizations, locations
- PII models detect: passwords, API keys, credit cards, secrets

Switch to a recommended PII model from the table above.

### "Architecture not supported" error

The model uses an architecture not supported by @xenova/transformers:
- ❌ ModernBERT (e.g., joneauxedgar/pasteproof-pii-detector-v2)
- ❌ GPT-style models for token classification

Use models from the recommended list above.

### Timeout errors

```
[opencode-guard] AI detection failed: AI detection timeout after 500ms
```

Solutions:
1. Increase `ai_timeout_ms` (default: 500ms)
2. Use a smaller model (e.g., gravitee-io/bert-small-pii-detection)
3. Reduce text length being analyzed
4. Consider using OpenAI provider for faster inference

### High latency

- Increase timeout if you can tolerate slower responses
- Consider using OpenAI provider for better performance
- Reduce `ai_timeout_ms` to fail faster (only regex detection will be used)
- Use smaller models (30-66MB vs 400-560MB)

### Memory usage (Local provider)

The local provider loads ML models into memory:
- First run: Downloads model (30-560MB depending on model)
- Runtime: Uses ~200-600MB RAM depending on model size

**Recommendations:**
- Low memory environment: Use `gravitee-io/bert-small-pii-detection` (30MB)
- Balanced: Use `SoelMgd/bert-pii-detection` (66MB)
- High accuracy: Use `iiiorg/piiranha-v1-detect-personal-information` (400MB)

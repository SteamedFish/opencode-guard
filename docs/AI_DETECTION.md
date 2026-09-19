# AI Detection Feature

OpenCode Guard now includes AI-powered sensitive data detection that can identify secrets and PII that traditional regex patterns might miss.

## Overview

AI Detection uses machine learning models to contextually analyze text and identify:
- Passwords and secrets in natural language
- API keys in code snippets
- Credentials embedded in logs
- PII mentioned in conversation

This complements the existing regex-based detection by catching edge cases and context-dependent sensitive information.

### Duplicate occurrences

When the model flags a value (e.g. an email) that appears several times in the same message, the plugin masks **every whole-token occurrence** of that value, not just the first one — otherwise the remaining copies would reach the provider in the clear. A copy embedded inside a longer ASCII identifier (`John` in `Johnson`, or `1234` in `ref1234x`) is not expanded, because it is a different token; the span the model actually detected is always masked.

Masking stays deterministic: every occurrence of the same value maps to the same masked token, so response restore is unaffected.

## Providers

Three AI provider options are available:

### 1. Local (Default) - Transformers.js

Uses `@huggingface/transformers` (v3+) for on-device inference. No data leaves your machine.

**Pros:**
- 100% private - no API calls
- No network latency
- Works offline (after first model download)
- Free

**Cons:**
- Requires model download (~300MB on first run)
- Slower than cloud APIs
- Lower accuracy than GPT-4

**Setup:**

Option 1 - Manual installation:
```bash
npm install @huggingface/transformers
```

Option 2 - Auto-installation (automatically installs package on first use):
```json
{
  "detection": {
    "ai_detection": true,
    "ai_provider": "local",
    "auto_install_deps": true,
    "ai_timeout_ms": 2000
  }
}
```

**Configuration:**
```json
{
  "detection": {
    "ai_detection": true,
    "ai_provider": "local",
    "local_model": "onnx-community/piiranha-v1-detect-personal-information-ONNX",
    "auto_install_deps": false,
    "ai_timeout_ms": 2000
  }
}
```

**Model Downloads:**

The first time you use a local model, it will be automatically downloaded and cached:
- **Location**: `.cache/` inside the installed `@huggingface/transformers` package directory (Transformers.js v3+ default)
- **Size**: ~300MB for the default quantized model
- **Offline use**: Once downloaded, models work offline
- **Cleanup**: Delete the cache directory to remove models
- **Mirror**: If huggingface.co is unreachable, set the standard `HF_ENDPOINT` environment variable (e.g. `https://hf-mirror.com`) before starting OpenCode; the plugin forwards it to Transformers.js

#### Recommended Local Models

The local provider uses token classification models. **Important requirements:**

1. **PII-specific models, not general NER models.**
   - **PII Models**: Detect passwords, API keys, credit cards, SSNs, emails, secrets
   - **NER Models**: Only detect names, organizations, locations (PER, ORG, LOC, MISC)
2. **The model repository must ship ONNX weights** (an `onnx/` directory). Repositories that only contain `model.safetensors` **cannot load** in Transformers.js. (This is why the former default `SoelMgd/bert-pii-detection` never worked.)

**Recommended:**

| Model | Size | Architecture | Notes |
|-------|------|--------------|-------|
| `onnx-community/piiranha-v1-detect-personal-information-ONNX` | ~300MB (quantized ONNX) | DeBERTa-v2 | **Default**. Official ONNX conversion of Piiranha; 17 PII categories (email, password, username, names, address, phone, SSN, credit card, DOB, ...) |

Other ONNX-converted PII models published under [`onnx-community`](https://hf.co/onnx-community?search=pii) (e.g. `bert-small-pii-detection-ONNX`, `multilang-pii-ner-ONNX`, OpenMed clinical PII variants) can be used via `local_model`; verify the repo has an `onnx/` folder first.

**Observed detection reliability (default model, quantized):**
- Reliable: street addresses, cities, building numbers, ZIP codes
- Inconsistent: emails, phone numbers, SSNs, passwords in free-form sentences (may be missed or returned as partial token fragments, which the plugin drops rather than risking wrong offsets)
- Regex detection remains the primary layer; AI detection is a complement

**⚠️ Models to AVOID:**

| Model | Why Avoid |
|-------|-----------|
| `Xenova/bert-base-NER` | **NER model only** - detects PER, ORG, LOC, MISC. Does NOT detect passwords or API keys |
| `dslim/bert-base-NER` | Same limitation - NER only |
| Any repo without an `onnx/` directory (e.g. `SoelMgd/bert-pii-detection`, `iiiorg/piiranha-v1-detect-personal-information`) | Cannot load in Transformers.js |
| Large conversational models (Llama, Mistral, etc.) | Unsuitable for token classification tasks |
| Code generation models | Trained for different tasks entirely |

**How to verify a model is PII vs NER:**

Check the model's label list:
- **PII labels**: PASSWORD, API_KEY, CREDIT_CARD, SSN, EMAIL, SECRET
- **NER labels**: PER, ORG, LOC, MISC (names, organizations, locations)

Example with the default model:
```javascript
import { pipeline } from '@huggingface/transformers';

const detector = await pipeline(
  'token-classification',
  'onnx-community/piiranha-v1-detect-personal-information-ONNX',
  { dtype: 'q8' } // quantized weights; replaces v2's `quantized: true`
);
const result = await detector('I live at 742 Evergreen Terrace, Springfield', { aggregation_strategy: 'simple' });
// Detects: "742" (I-BUILDINGNUM), "Evergreen Terrace" (I-STREET), "Springfield" (I-CITY)
```

**Custom model configuration:**
```json
{
  "detection": {
    "ai_detection": true,
    "ai_provider": "local",
    "local_model": "onnx-community/piiranha-v1-detect-personal-information-ONNX",
    "ai_timeout_ms": 2000
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
    "custom_api_endpoint": "http://localhost:11434/v1/chat/completions",
    "custom_api_key": "optional-key"
  }
}
```

## Supported Model Architectures

### Supported by @huggingface/transformers (v3+):
- ✅ BERT
- ✅ DistilBERT
- ✅ RoBERTa / XLM-RoBERTa
- ✅ DeBERTa / DeBERTa-v2 / DeBERTa-v3
- ✅ ELECTRA
- ✅ MobileBERT
- ✅ ModernBERT

...plus any architecture with token-classification support. Remember: the repo must also ship ONNX weights.

## Examples

### Detecting passwords in natural language

Input:
```
My database password is SuperSecret123! and my API key is sk-abc123...
```

Regex detects: `sk-abc123...`
AI detects: `SuperSecret123!` (when the model flags it — see reliability note above)

### Detecting PII in text

Input:
```
User john@example.com lives at 742 Evergreen Terrace, Springfield
```

Regex detects: `john@example.com`
AI detects: `742 Evergreen Terrace, Springfield` (address components)

## Troubleshooting

### Model fails to load

1. Check the repo ships ONNX weights (`onnx/` directory) — safetensors-only repos cannot load
2. Verify you're using a PII model, not an NER model:
   ```javascript
   const detector = await pipeline('token-classification', 'model-name');
   console.log(detector.model.config.id2label);
   // Should show: PASSWORD, API_KEY, etc. (not PER, ORG, LOC)
   ```
3. Check internet connection for initial download (or set `HF_ENDPOINT` to a mirror)
4. Clear cache and retry: delete the `.cache/` directory inside the installed `@huggingface/transformers` package

### Model loads but doesn't detect credentials

The default Piiranha model detects address-type PII most reliably; passwords and
emails in free-form text are detected inconsistently (see reliability note above).
If you need stronger credential detection, evaluate larger ONNX PII models or the
OpenAI provider.

### Timeout errors

```
[opencode-guard] AI detection failed: AI detection timeout after 2000ms
```

On timeout the request is still sent — with regex-based masking only. Entity types that only AI detection can find (e.g. street addresses, natural-language credentials) may reach the provider **unmasked**. This fail-open behavior is intentional (the plugin keeps working rather than breaking your session); if that is unacceptable, keep `ai_detection` off or budget a generous timeout.

Solutions:
1. Increase `ai_timeout_ms` (default: 2000ms)
2. Use a smaller model
3. Reduce text length being analyzed
4. Consider using OpenAI provider for faster inference

### High latency

- Increase timeout if you can tolerate slower responses
- Consider using OpenAI provider for better performance
- Reduce `ai_timeout_ms` to fail faster (only regex detection will be used)

### Memory usage (Local provider)

The local provider loads ML models into memory:
- First run: Downloads model (~300MB for the default)
- Runtime: Uses several hundred MB of RAM depending on model size

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
    "local_model": "joneauxedgar/pasteproof-pii-detector-v2",
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

The local provider uses token classification models. **Important: General NER models (like bert-base-NER) are NOT suitable for detecting passwords and secrets** - they're trained to recognize locations, organizations, and persons, not credentials.

**Why smaller models work better:**
- Large language models (7B+ parameters) may "overthink" and try to interpret content instead of just identifying patterns
- They might generate explanatory text or "help" in unexpected ways
- Smaller, task-specific models are trained for exactly one job: detecting sensitive data

**Recommended PII-specific models:**

| Model | Size | Best For | Password Detection | Notes |
|-------|------|----------|-------------------|-------|
| `joneauxedgar/pasteproof-pii-detector-v2` | ~100MB | **Passwords, secrets, API keys** | ✅ Yes (VUL_JXM) | **Recommended default**. 97.2% F1, ignores test data like `process.env.API_KEY` |
| `iiiorg/piiranha-v1-detect-personal-information` | ~400MB | **PII-heavy content** | ✅ Yes (98% precision) | Detects 17 PII types. 100% email accuracy |
| `dslim/bert-base-NER` | ~100MB | Names, organizations, locations | ❌ No | Only for general NER, NOT for passwords |

**⚠️ Models to AVOID for password detection:**
- `bert-base-NER` - Only detects LOC, ORG, PER, MISC. Does NOT detect passwords
- `distilbert-base-NER` - Same limitation as bert-base-NER
- Large conversational models (Llama, Mistral, etc.) - unsuitable for token classification
- Code generation models - trained for different tasks

**Custom model configuration:**
```json
{
  "detection": {
    "ai_detection": true,
    "ai_provider": "local",
    "local_model": "joneauxedgar/pasteproof-pii-detector-v2",
    "ai_timeout_ms": 500
  }
}
```

**Model details:**

**PasteProof PII Detector** (`joneauxedgar/pasteproof-pii-detector-v2`)
- Entities: `VUL_JXM` (vulnerable credentials), `EMAIL`, `CREDIT_CARD`, `PHONE_NUM`, etc.
- Trained on 120k examples with hard negatives (placeholders, test data)
- Correctly ignores: `process.env.API_KEY`, `123-45-6789` (example SSN), `test@example.com`
- 97.2% F1 score on validation set

**Piiranha** (`iiiorg/piiranha-v1-detect-personal-information`)
- Entities: `PASSWORD` (98% precision!), `USERNAME`, `EMAIL`, `CREDITCARDNUMBER`, etc.
- 17 PII types across 6 languages
- 99.44% overall classification accuracy
- Base model: microsoft/mdeberta-v3-base

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
    "custom_api_key": "optional-api-key",
    "custom_model": "llama2"
  }
}
```

**⚠️ Important: Model Selection for Self-Hosted**

When using Ollama or similar self-hosted solutions, **avoid large conversational models** (7B+ parameters like Llama 2, Mistral, etc.) for detection tasks.

**Why:**
- Large models may generate explanatory text instead of just returning detections
- They can be unpredictable with system prompts
- Higher resource usage without accuracy benefits for this use case

**Recommended for self-hosted:**
- Use OpenAI-compatible endpoints that wrap smaller NER models
- Consider LocalAI with `gpt-3.5-turbo` mimicking models
- For Ollama, test thoroughly with your specific use case before production use

## Configuration Options

Add to your `vibeguard.config.json`:

```json
{
  "detection": {
    "ai_detection": true,
    "ai_provider": "local",
    "ai_timeout_ms": 500
  }
}
```

| Option | Type | Default | Description |
|--------|------|---------|-------------|
| `ai_detection` | boolean | `false` | Enable AI detection |
| `ai_provider` | string | `"local"` | Provider: `"local"`, `"openai"`, or `"custom"` |
| `ai_timeout_ms` | number | `500` | Timeout for AI detection in milliseconds |

### Provider-Specific Options

**OpenAI Provider:**
- `openai_api_key` - Your OpenAI API key
- `openai_model` - Model to use (default: `"gpt-4"`)

**Custom Provider:**
- `custom_api_endpoint` - API endpoint URL
- `custom_api_key` - API key (if required)
- `custom_model` - Model name

## How It Works

1. **Regex Detection First**: Traditional patterns detect obvious secrets (emails, API keys with known prefixes)
2. **AI Detection**: ML model analyzes text contextually for additional secrets
3. **Result Merging**: Results are merged with conflict resolution (prefers longer matches, then higher confidence)
4. **Masking**: Detected values are masked using format-preserving algorithms

## Performance Considerations

### Timeout Behavior

AI detection has a configurable timeout (default 500ms). If detection exceeds this:
- The operation is cancelled
- Only regex results are used
- A debug warning is logged (if `OPENCODE_GUARD_DEBUG=1`)

### Recommendation by Use Case

| Use Case | Recommended Provider | Timeout |
|----------|---------------------|---------|
| Local development | Local | 1000ms |
| CI/CD pipelines | Local | 2000ms |
| High-volume production | OpenAI | 1000ms |
| Privacy-critical | Local or Custom | 2000ms |

## Privacy Notes

- **Local provider**: No data leaves your machine. Models run locally.
- **OpenAI provider**: Text is sent to OpenAI's API. Review their privacy policy.
- **Custom provider**: Depends on your infrastructure. Can be fully private if self-hosted.

## Troubleshooting

### AI detection not working

1. Check if AI detection is enabled in config:
   ```bash
   export OPENCODE_GUARD_DEBUG=1
   ```
   Look for: `[opencode-guard] AI detection enabled (local)`

2. For local provider, check if `@xenova/transformers` is installed:
   ```bash
   npm ls @xenova/transformers
   ```

3. Check for timeout errors:
   ```
   [opencode-guard] AI detection failed: AI detection timeout after 500ms
   ```
   Increase `ai_timeout_ms` if needed.

### High latency

- Increase timeout if you can tolerate slower responses
- Consider using OpenAI provider for better performance
- Reduce `ai_timeout_ms` to fail faster (only regex detection will be used)

### Memory usage (Local provider)

The local provider loads ML models into memory:
- First run: Downloads ~100MB model
- Runtime: Uses ~200-400MB RAM

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
  password: "hunter2",
  apiKey: process.env.KEY
};
```

Regex detects: None (no obvious pattern)
AI detects: `hunter2` as a password

### Detecting PII in logs

Input:
```
User john.doe@example.com logged in with password "MyP@ssw0rd!" from 192.168.1.1
```

Regex detects: `john.doe@example.com`, `192.168.1.1`
AI detects: `MyP@ssw0rd!` as a password

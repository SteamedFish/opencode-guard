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
```bash
npm install @xenova/transformers
```

**Configuration:**
```json
{
  "detection": {
    "ai_detection": true,
    "ai_provider": "local",
    "ai_timeout_ms": 500
  }
}
```

#### Recommended Local Models

The local provider uses token classification models for Named Entity Recognition (NER). **Note: Smaller, focused models often outperform larger ones for this specific task.**

**Why smaller models work better:**
- Large language models (7B+ parameters) may "overthink" and try to interpret the content instead of just identifying sensitive patterns
- They might attempt to "help" by generating additional text or explanations
- Smaller NER models are trained specifically for entity extraction, making them more predictable

**Recommended models:**

| Model | Size | Best For | Notes |
|-------|------|----------|-------|
| `Xenova/bert-base-NER` | ~100MB | General purpose | Default. Good balance of speed and accuracy |
| `Xenova/distilbert-base-NER` | ~60MB | Speed priority | Faster, slightly less accurate |
| `dslim/bert-base-NER` | ~100MB | Production use | HuggingFace standard for NER |

**Models to avoid:**
- Large conversational models (Llama, Mistral, etc.) - unsuitable for token classification
- Code generation models - trained for different tasks
- Multimodal models - unnecessary overhead

**Custom model configuration:**
```json
{
  "detection": {
    "ai_detection": true,
    "ai_provider": "local",
    "local_model": "Xenova/distilbert-base-NER",
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

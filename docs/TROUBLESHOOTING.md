# Troubleshooting Guide

Common issues and solutions for OpenCode Guard.

## Table of Contents

- [Plugin Not Working](#plugin-not-working)
- [Git Commits Contain Masked Values](#git-commits-contain-masked-values)
- [MCP Tool Calls Failing](#mcp-tool-calls-failing)
- [AI Detection Issues](#ai-detection-issues)
- [Performance Issues](#performance-issues)
- [Debug Mode](#debug-mode)

---

## Plugin Not Working

### Symptom
Sensitive data (emails, API keys) are being sent to LLM providers without masking.

### Common Causes

1. **No config file found**
   - The plugin requires a config file to work
   - Solution: Create `opencode-guard.config.json` (see [Configuration Guide](CONFIGURATION.md))

2. **`global_salt` missing**
   - The plugin won't work without `global_salt` set
   - Solution: Add `"global_salt": "your-salt-here"` to your config

3. **`enabled: false`**
   - Make sure `enabled` is set to `true` in your config

### Debug Steps

```bash
# Enable debug logging to see what's happening
export OPENCODE_GUARD_DEBUG=1
opencode
```

Look for messages like:
- `[opencode-guard] config: not found (plugin disabled)` — Config file missing
- `[opencode-guard] config: /path/to/config, enabled=false` — Plugin disabled in config
- `[opencode-guard] masked N sensitive values` — Working correctly

### Verify Config Location

```bash
# Check if config exists in one of the expected locations
ls -la ~/.config/opencode/opencode-guard.config.json
ls -la ./opencode-guard.config.json
ls -la ./.opencode/opencode-guard.config.json
```

### Quick Checklist

- [ ] Config file exists in one of the [expected locations](CONFIGURATION.md#configuration-file-locations)
- [ ] `enabled: true` is set in config
- [ ] `global_salt` is set and is a non-empty string
- [ ] Salt is at least 32 characters for security
- [ ] Config is valid JSON (no syntax errors)

---

## Git Commits Contain Masked Values

### Symptom
Commit messages or file contents contain masked values like `ce_.rbgrrq@sisyphuslabs.ai` instead of the real email.

### Cause
The git MCP server is not in the `exclude_mcp_servers` list, so it receives masked data.

### Solution

Add your git MCP server to the exclusion list:

```json
{
  "exclude_mcp_servers": ["git", "github", "filesystem"]
}
```

### Important Notes

- OpenCode's built-in tools (`bash`, `read`, `write`, `edit`, etc.) are automatically treated as local
- Only MCP servers and MCP tools need explicit configuration
- Add to exclusions any MCP server that needs to work with original data

See [MCP Server Configuration Guide](MCP_SERVERS.md) for detailed explanation.

---

## MCP Tool Calls Failing

### Symptom
External API calls (email, Slack, webhooks) fail because they receive masked data.

### Understanding the Behavior

This is **intentional security behavior**. External servers should receive masked data to protect your secrets.

### Solutions

**Option 1: Add to exclusions (use with caution)**

For external APIs that legitimately need real data:

```json
{
  "exclude_mcp_servers": ["slack", "sendgrid"]
}
```

⚠️ **Warning**: Adding external APIs to exclusions exposes your sensitive data to third parties. Only do this for trusted services.

**Option 2: Use local tools instead**

For operations that must use real data, use OpenCode's built-in tools instead of MCP servers:

- Use `bash` tool instead of shell MCP server
- Use `write`/`read` tools instead of filesystem MCP server

---

## AI Detection Issues

### Model Fails to Load

**Symptoms**: AI detection is enabled but not working, or errors about model loading.

**Solutions**:

1. **Check architecture compatibility**
   - Ensure model uses BERT/DistilBERT/RoBERTa/DeBERTa
   - See [AI Detection Guide](AI_DETECTION.md) for supported architectures

2. **Verify you're using a PII model, not an NER model**
   - PII models detect: passwords, API keys, credit cards
   - NER models detect: names, organizations, locations
   - See [AI Detection Guide](AI_DETECTION.md#recommended-local-models)

3. **Check internet connection**
   - First run requires downloading the model

4. **Clear cache and retry**
   ```bash
   rm -rf ~/.cache/huggingface/hub/
   ```

### Timeout Errors

```
[opencode-guard] AI detection failed: AI detection timeout after 500ms
```

**Solutions**:

1. **Increase timeout**
   ```json
   {
     "detection": {
       "ai_timeout_ms": 2000
     }
   }
   ```

2. **Use a smaller model**
   - `gravitee-io/bert-small-pii-detection` (~30MB) instead of larger models

3. **Disable AI detection**
   If performance is critical:
   ```json
   {
     "detection": {
       "ai_detection": false
     }
   }
   ```

### "Architecture not supported" Error

The model uses an architecture not supported by `@xenova/transformers`:

- ❌ ModernBERT (e.g., `joneauxedgar/pasteproof-pii-detector-v2`)
- ❌ GPT-style models for token classification

**Solution**: Use models from the [recommended list](AI_DETECTION.md#recommended-local-models).

---

## Performance Issues

### High Memory Usage (Local AI Provider)

The local provider loads ML models into memory:

- **First run**: Downloads model (30-560MB depending on model)
- **Runtime**: Uses ~200-600MB RAM depending on model size

**Recommendations**:

| Environment | Recommended Model | Size |
|-------------|-------------------|------|
| Low memory | `gravitee-io/bert-small-pii-detection` | ~30MB |
| Balanced | `SoelMgd/bert-pii-detection` | ~66MB |
| High accuracy | `iiiorg/piiranha-v1-detect-personal-information` | ~400MB |

**Alternative**: Use OpenAI provider (no local memory overhead)

### Slow Response Times

**Causes and solutions**:

1. **AI detection timeout too low**
   - Increase `ai_timeout_ms`
   - Or disable AI detection if not needed

2. **Large model loading**
   - Switch to a smaller model
   - Models are cached after first load

3. **Too many patterns**
   - Review custom patterns for complexity
   - Remove unused patterns

---

## Debug Mode

Enable debug logging to diagnose issues:

```bash
export OPENCODE_GUARD_DEBUG=1
opencode
```

### Debug Output Explained

| Message | Meaning |
|---------|---------|
| `config: not found (plugin disabled)` | No config file found in any location |
| `config: /path/to/config, enabled=false` | Config found but plugin disabled |
| `config: /path/to/config, enabled=true` | Config loaded successfully |
| `masked N sensitive values` | Successfully masked N values |
| `AI detection failed: ...` | AI detection error (may fall back to regex) |
| `pattern compiled: ...` | Custom pattern loaded successfully |

### Getting More Help

If issues persist:

1. Check [AI Detection Guide](AI_DETECTION.md) for AI-specific issues
2. Check [MCP Server Guide](MCP_SERVERS.md) for MCP-specific issues
3. Review [Configuration Guide](CONFIGURATION.md) for setup issues
4. File an issue with debug output included

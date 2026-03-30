# Configuration Guide

Complete guide for configuring OpenCode Guard.

## Table of Contents

- [Quick Setup](#quick-setup)
- [Configuration File Locations](#configuration-file-locations)
- [Full Configuration Options](#full-configuration-options)
- [Environment Variables](#environment-variables)
- [Custom Patterns](#custom-patterns)
- [Custom Maskers](#custom-maskers)

---

## Quick Setup

**You MUST create a `opencode-guard.config.json` file** in one of these locations:

### Option 1: Global Config (Recommended)

First, generate a secure salt (choose one method):

```bash
# Method 1: OpenSSL (recommended)
openssl rand -base64 32

# Method 2: /dev/urandom
head -c 32 /dev/urandom | base64

# Method 3: Node.js
node -e "console.log(require('crypto').randomBytes(32).toString('base64'))"
```

Then create the config file:

```bash
mkdir -p ~/.config/opencode
cat > ~/.config/opencode/opencode-guard.config.json << 'EOF'
{
  "enabled": true,
  "global_salt": "YOUR_GENERATED_SALT_HERE"
}
EOF
```

> **Security tip**: Use a long, random salt (at least 32 bytes). Treat it like a password - don't share it or commit it to version control.

### Option 2: Project-Specific Config

Create `opencode-guard.config.json` in the same directory as your `opencode.json` (your OpenCode project root).

> **Note**: The plugin does NOT work out-of-the-box. The `global_salt` is required for deterministic masking and must be provided by you.

---

## Configuration File Locations

The plugin searches for config in this order (first found wins):

1. **`OPENCODE_GUARD_CONFIG`** environment variable (explicit path)
2. **`./opencode-guard.config.json`** — Project root (where your `opencode.json` is)
3. **`./.opencode/opencode-guard.config.json`** — Project's `.opencode/` subdirectory
4. **`~/.config/opencode/opencode-guard.config.json`** — Global user config

**Important**: Currently, configs do **NOT** merge. The first config file found is used as-is. If you have both global and project configs, only the project config will be loaded.

---

## Full Configuration Options

```json
{
  "enabled": true,
  "debug": false,
  "global_salt": "your-secret-salt-change-this",
  "session_ttl": "1h",
  "max_mappings": 100000,
  "masking": {
    "format_preserving": true,
    "preserve_domains": true,
    "preserve_prefixes": true
  },
  "detection": {
    "parallel": true,
    "ai_detection": false,
    "ai_provider": "local",
    "ai_timeout_ms": 500
  },
  "exclude_llm_endpoints": [
    "http://localhost:11434"
  ],
  "exclude_mcp_servers": [
    "local-filesystem"
  ],
  "exclude_mcp_tools": [
    "submit_plan",
    "schedule_job",
    "list_jobs",
    "get_version",
    "get_skill",
    "install_skill",
    "get_job",
    "update_job",
    "delete_job",
    "cleanup_global",
    "run_job",
    "job_logs"
  ],
  "patterns": {
    "keywords": [],
    "regex": [
      { "pattern": "sk-[A-Za-z0-9]{48}", "category": "OPENAI_KEY", "mask_as": "sk_token" }
    ],
    "builtin": ["email", "uuid", "ipv4"],
    "exclude": ["example.com", "localhost"]
  },
  "custom_maskers": {}
}
```

### Option Reference

| Option | Description | Default |
|--------|-------------|---------|
| `enabled` | Enable/disable the plugin. **Note:** Plugin is disabled if no config file exists | `true` (when config present) |
| `debug` | Enable debug logging | `false` |
| `global_salt` | **Required.** Secret salt for deterministic masking. Plugin won't work without this | (none — must be set) |
| `session_ttl` | Session timeout (e.g., "1h", "30m") | `"1h"` |
| `max_mappings` | Maximum cached mappings per session | `100000` |
| `masking.format_preserving` | Enable format-preserving masking | `true` |
| `masking.preserve_domains` | Preserve email domains when masking | `true` |
| `masking.preserve_prefixes` | Preserve token prefixes (e.g., `sk-`, `ghp_`) | `true` |
| `detection.parallel` | Run regex and AI detection in parallel | `true` |
| `detection.ai_detection` | Enable AI-based detection | `false` |
| `detection.ai_provider` | AI provider: "local", "openai", or "custom" | `"local"` |
| `detection.ai_timeout_ms` | Timeout for AI detection in milliseconds | `500` |
| `exclude_llm_endpoints` | LLM endpoints to skip masking | `[]` |
| `exclude_mcp_servers` | MCP servers to treat as "local" | `[]` |
| `exclude_mcp_tools` | MCP tools to treat as "local" by tool name | Built-in tools |

---

## Environment Variables

| Variable | Description |
|----------|-------------|
| `OPENCODE_GUARD_CONFIG` | Explicit path to config file |
| `OPENCODE_GUARD_DEBUG` | Enable debug mode (set to `1`) |

---

## Custom Patterns

Add your own regex patterns for detecting custom sensitive data:

```json
{
  "patterns": {
    "regex": [
      {
        "pattern": "myapp-[a-z0-9]{32}",
        "category": "MYAPP_TOKEN",
        "mask_as": "token"
      }
    ]
  }
}
```

### Pattern Options

- `pattern`: Regular expression string (required)
- `category`: Label for the type of sensitive data (optional)
- `mask_as`: Which masker to use for this pattern (optional, defaults to generic)

---

## Custom Maskers

Define custom masking behavior for specific data types:

```json
{
  "custom_maskers": {
    "my_token": {
      "type": "prefixed_token",
      "prefix": "myapp-",
      "suffix_length": 32,
      "suffix_chars": "alphanumeric"
    }
  }
}
```

### Masker Types

- `prefixed_token`: Masks everything after a prefix
- `regex`: Applies regex-based masking
- `fixed`: Replaces with a fixed string

See [Pattern Guide](PATTERNS.md) for more details on custom patterns and maskers.

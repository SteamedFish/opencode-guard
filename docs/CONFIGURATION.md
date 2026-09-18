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

**No config file is required to get started** — on the first run, the plugin automatically generates one (see [Configuration File Locations](#configuration-file-locations)). The steps below are only needed if you want to customize settings or use your own salt.

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

> **Note**: The plugin works out-of-the-box — if no config file exists, a minimal one with a random `global_salt` is auto-generated on first run. However, if you create a config file yourself, it **must** contain `global_salt`: an existing config without it disables the plugin (fail-safe).

---

## Configuration File Locations

The plugin searches for config in this order (first found wins):

1. **`OPENCODE_GUARD_CONFIG`** environment variable (explicit path)
2. **`./opencode-guard.config.json`** — Project root (where your `opencode.json` is)
3. **`./.opencode/opencode-guard.config.json`** — Project's `.opencode/` subdirectory
4. **`~/.config/opencode/opencode-guard.config.json`** — Global user config

**Important**: Currently, configs do **NOT** merge. The first config file found is used as-is. If you have both global and project configs, only the project config will be loaded.

**Auto-generation on first run**: If no config file is found in any of the locations above, the plugin automatically creates a minimal config at location 4 (`~/.config/opencode/opencode-guard.config.json`) containing a randomly generated `global_salt` (permissions `0600`), and enables itself immediately. You can edit the generated file at any time. If the file cannot be written, the plugin falls back to an in-memory random salt (mappings are lost on restart), prints a warning, and stays enabled.

**Malformed config = fail-closed**: if a config file *exists* but cannot be parsed (invalid JSON), the plugin prints an error and disables itself. It does NOT auto-generate a replacement — auto-generation only happens when no config file exists at all. Fix or delete the malformed file.

---

## Full Configuration Options

```json
{
  "enabled": true,
  "debug": false,
  "debug_file": "",
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
| `enabled` | Enable/disable the plugin. The plugin is enabled by default; only an explicit `enabled: false` disables it. If no config file exists at all, a minimal one is auto-generated on first run (see [Configuration File Locations](#configuration-file-locations)) | `true` |
| `debug` | Enable debug logging | `false` |
| `debug_file` | Append debug output to this file (only used when `debug` is on). Useful under OpenCode v2 where console output is invisible. **Warning:** contains plaintext secrets (masked→original mappings). The path must be absolute (relative paths are rejected with a warning); the file is truncated on every startup and created with permissions `0600`; a startup warning is printed whenever file logging activates. Enable only temporarily and delete the file after debugging | `""` (off) |
| `global_salt` | **Required.** Secret salt for deterministic masking. Plugin won't work without this. Overridden by the `OPENCODE_GUARD_SALT` environment variable (highest priority). The plugin warns if the config file containing the salt is readable by group/others (expected permissions: `0600`) | (none — must be set) |
| `session_ttl` | Session timeout (e.g., "1h", "30m") | `"1h"` |
| `max_mappings` | Maximum cached mappings per session | `100000` |
| `masking.format_preserving` | Enable format-preserving masking | `true` |
| `masking.preserve_domains` | Preserve email domains when masking | `true` |
| `masking.preserve_prefixes` | Preserve token prefixes (e.g., `sk-`, `ghp_`) | `true` |
| `detection.parallel` | Run regex and AI detection in parallel | `true` |
| `detection.ai_detection` | Enable AI-based detection. **This is the only feature disabled by default** — everything else works out of the box | `false` |
| `detection.ai_provider` | AI provider: "local", "openai", or "custom" | `"local"` |
| `detection.ai_timeout_ms` | Timeout for AI detection in milliseconds | `500` |
| `exclude_llm_endpoints` | LLM endpoints to skip masking. Hostname or `host:port` entries (scheme optional). A domain entry matches the exact host and its subdomains (e.g. `api.example.com` covers `v2.api.example.com`), but never unrelated suffixes (e.g. `api.example.com.evil.tld` is NOT excluded). Empty entries are rejected with a warning | `[]` |
| `exclude_mcp_servers` | MCP servers to treat as "local" | `[]` |
| `exclude_mcp_tools` | MCP tools to treat as "local". **Server-scoped:** bare tool names apply only to servers listed in `exclude_mcp_servers` (they never match external servers). Use a qualified entry `server/tool` (or the effective `server_tool` name) to exempt a specific tool on a specific server | Built-in tools |

---

## Environment Variables

| Variable | Description |
|----------|-------------|
| `OPENCODE_GUARD_CONFIG` | Explicit path to config file |
| `OPENCODE_GUARD_DEBUG` | Enable debug mode (set to `1`) |
| `OPENCODE_GUARD_DEBUG_FILE` | Debug log file path (overrides `debug_file`; only used when debug is on) |
| `OPENCODE_GUARD_SALT` | Overrides `global_salt` from the config file (highest priority) |

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

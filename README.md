# OpenCode Guard

[![License: GPL v3](https://img.shields.io/badge/License-GPLv3-blue.svg)](https://www.gnu.org/licenses/gpl-3.0)

> **Privacy-first OpenCode plugin with format-preserving masking**

[中文文档](README.zh-CN.md)

## Overview

OpenCode Guard is a privacy-focused plugin for [OpenCode](https://opencode.ai) that automatically masks sensitive data before it reaches LLM providers and MCP servers. Unlike traditional placeholder-based masking, this plugin uses **format-preserving masking** - masked values retain the format and structure of the original data, making them indistinguishable from real values.

**Key Features:**
- 🎭 **Format-Preserving Masking**: Masked emails look like emails, tokens look like tokens
- 🔒 **Deterministic**: Same input + same salt = same masked output
- ⚡ **Parallel Detection**: Regex + AI detection run simultaneously
- 🔌 **LLM + MCP Support**: Masks both LLM API calls and MCP tool invocations
- 🚫 **Excluded Endpoints**: Configure specific endpoints to skip masking
- 💾 **In-Memory Storage**: No SQLite, no persistent storage of secrets

## How It Works

```
┌─────────────┐     ┌──────────────┐     ┌─────────────┐
│   Original  │────▶│    Mask      │────▶│    LLM      │
│   Text      │     │   Engine     │     │   Provider  │
└─────────────┘     └──────────────┘     └─────────────┘
                           │
                           ▼
                    ┌──────────────┐
                    │  Deterministic│
                    │  Masked Value │
                    └──────────────┘
```

### Masking Examples

| Data Type | Original | Masked | Strategy |
|-----------|----------|--------|----------|
| Email | `john@example.com` | `a3f7@example.com` | Preserve domain |
| OpenAI Key | `sk-abc123...` | `sk-x9m2p5q...` | Preserve prefix |
| GitHub Token | `ghp_xxxxxx` | `ghp_yyyyyy` | Preserve prefix |
| IPv4 | `192.168.1.100` | `192.168.x.x` | Keep network prefix |
| IPv6 | `fe80::1` | `fe80:0:0:0::xxxx` | Keep network prefix |
| DB URL | `postgres://user:pass@host` | `postgres://****:****@host` | Mask credentials |
| Password | `password=secret` | `password=********` | Mask value |
| Username | `username=admin` | `username=********` | Mask value |

## Installation

### Method 1: NPM Package (Recommended)

```bash
npm install opencode-guard
```

Add to your `opencode.json`:

```json
{
  "$schema": "https://opencode.ai/config.json",
  "plugins": [
    "opencode-guard"
  ]
}
```

### Method 2: Local Development

1. Clone this repository:
```bash
git clone https://github.com/SteamedFish/opencode-guard.git
```

2. Add to your `opencode.json`:
```json
{
  "$schema": "https://opencode.ai/config.json",
  "plugins": [
    "file://./opencode-guard/src/index.js"
  ]
}
```

## Configuration

Create a `vibeguard.config.json` file in your project root:

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

### Configuration Options

| Option | Description | Default |
|--------|-------------|---------|
| `enabled` | Enable/disable the plugin | `true` |
| `debug` | Enable debug logging | `false` |
| `global_salt` | Secret salt for deterministic masking | (required) |
| `session_ttl` | Session timeout (e.g., "1h", "30m") | `"1h"` |
| `max_mappings` | Maximum cached mappings per session | `100000` |
| `detection.parallel` | Run regex and AI detection in parallel | `true` |
| `detection.ai_detection` | Enable AI-based detection | `false` |
| `exclude_llm_endpoints` | LLM endpoints to skip masking | `[]` |
| `exclude_mcp_servers` | MCP servers to skip masking | `[]` |

### Config File Locations (in order of priority)

1. Path specified by `OPENCODE_VIBEGUARD_CONFIG` environment variable
2. `./vibeguard.config.json` (project root)
3. `./.opencode/vibeguard.config.json`
4. `~/.config/opencode/vibeguard.config.json`

## Supported Patterns

### Built-in Detection

- **Emails**: `user@example.com`
- **API Keys**: `sk-...`, `sk-proj-...`, `sk-or-v1-...`, `sk-litellm-...`, `sk-kimi-...`, `sk-ant-...`
- **GitHub Tokens**: `ghp_...`, `gho_...`, `ghu_...`, `ghs_...`, `ghr_...`
- **AWS Keys**: `AKIA...`, `ASIA...`
- **HTTP Basic Auth**: `https://user:pass@host`, `Basic base64...`
- **Database URLs**: `postgres://...`, `mysql://...`, `mongodb://...`, `mongodb+srv://...`
- **Environment Variables**: `DATABASE_URL=...`, `CONNECTION_STRING=...`
- **Generic Credentials**: `api_key=...`, `secret_key=...`, `access_token=...`, etc.
- **Passwords**: `password=...`, `passwd=...`, `pwd=...`
- **Usernames**: `username=...`, `user=...`
- **IPs**: IPv4, IPv6 (preserves network prefix)
- **UUIDs**: Standard UUID format

### Custom Patterns

Add your own patterns in the config:

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

### Custom Maskers

Define custom masking behavior:

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

## Security Notes

1. **Global Salt**: The `global_salt` is the key to deterministic masking. Keep it secret and consistent.
2. **No Persistent Storage**: All mappings are stored in memory only. Plugin restart = fresh sessions.
3. **Format Compliance**: Masked values maintain valid format (emails pass email regex, IPs are valid, etc.)
4. **Cryptographic Security**: Uses HMAC-SHA256 for seed generation. Irreversible without the salt.

## License

This project is licensed under the GNU General Public License v3.0 or later - see the [LICENSE](LICENSE) file for details.

## Contributing

Contributions are welcome! Please feel free to submit a Pull Request.

## Acknowledgments

- Inspired by [VibeGuard](https://github.com/inkdust2021/VibeGuard)
- Built for [OpenCode](https://opencode.ai)

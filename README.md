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
- 🔧 **Smart MCP Handling**: Different treatment for local vs external MCP servers ([see docs](docs/MCP_SERVERS.md))
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
| MAC Address | `00:1b:44:11:3a:b7` | `00:1b:44:xx:xx:xx` | Preserve OUI prefix |
| DB URL | `postgres://user:pass@host` | `postgres://****:****@host` | Mask credentials |
| Password | `password=secret` | `password=********` | Mask value |
| Username | `username=admin` | `username=********` | Mask value |

## AI Detection (Optional)

OpenCode Guard includes optional AI-powered detection that can identify sensitive data that regex patterns might miss:

- Passwords mentioned in natural language
- Secrets embedded in code comments
- Context-dependent credentials

### Quick Start

```bash
# Install optional AI dependency
npm install @xenova/transformers

# Enable in your config
{
  "detection": {
    "ai_detection": true,
    "ai_provider": "local",
    "ai_timeout_ms": 500
  }
}
```

Three provider options available:
- **Local** (default): On-device inference with Transformers.js - private and free
- **OpenAI**: Cloud-based with GPT-4 - highest accuracy
- **Custom**: Self-hosted endpoints (Ollama, LocalAI, etc.)

See [docs/AI_DETECTION.md](docs/AI_DETECTION.md) for detailed configuration.

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

**⚠️ After installation, you MUST create a config file** (see [Configuration](#configuration) below). The plugin is disabled by default until configured.

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

> ⚠️ **IMPORTANT: Plugin is DISABLED by default without configuration!**
>
> For security reasons, the plugin requires **both**:
> 1. A configuration file to exist
> 2. `enabled: true` and `global_salt` to be set
>
> If no config file is found, or if these values are missing, the plugin will silently do nothing.
> Use `OPENCODE_GUARD_DEBUG=1` to see what's happening.

### Quick Setup

**You MUST create a `vibeguard.config.json` file** in one of these locations:

**Option 1: Global Config (Recommended)**

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
cat > ~/.config/opencode/vibeguard.config.json << 'EOF'
{
  "enabled": true,
  "global_salt": "YOUR_GENERATED_SALT_HERE"
}
EOF
```

> 💡 **Security tip**: Use a long, random salt (at least 32 bytes). Treat it like a password - don't share it or commit it to version control.

**Option 2: Project-Specific Config**
Create `vibeguard.config.json` in the same directory as your `opencode.json` (your OpenCode project root).

> **Note**: The plugin does NOT work out-of-the-box. The `global_salt` is required for deterministic masking and must be provided by you.

### Full Example

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
| `enabled` | Enable/disable the plugin. **Note:** Plugin is disabled if no config file exists | `true` (when config present) |
| `debug` | Enable debug logging | `false` |
| `global_salt` | **Required.** Secret salt for deterministic masking. Plugin won't work without this | (none — must be set) |
| `session_ttl` | Session timeout (e.g., "1h", "30m") | `"1h"` |
| `max_mappings` | Maximum cached mappings per session | `100000` |
| `detection.parallel` | Run regex and AI detection in parallel | `true` |
| `detection.ai_detection` | Enable AI-based detection | `false` |
| `exclude_llm_endpoints` | LLM endpoints to skip masking | `[]` |
| `exclude_mcp_servers` | MCP servers to treat as "local" (see [MCP Server Guide](docs/MCP_SERVERS.md)) | `[]` |

### Config File Locations (in order of priority)

The plugin searches for config in this order (first found wins):

1. **`OPENCODE_VIBEGUARD_CONFIG`** environment variable (explicit path)
2. **`./vibeguard.config.json`** — Project root (where your `opencode.json` is)
3. **`./.opencode/vibeguard.config.json`** — Project's `.opencode/` subdirectory
4. **`~/.config/opencode/vibeguard.config.json`** — Global user config

**Important**: Currently, configs do **NOT** merge. The first config file found is used as-is. If you have both global and project configs, only the project config will be loaded.

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
- **MAC Addresses**: `aa:bb:cc:dd:ee:ff`, `aa-bb-cc-dd-ee-ff`, `AABBCCDDEEFF` (preserves OUI prefix)
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

## Troubleshooting

### Plugin is not masking anything

**Symptom**: Sensitive data (emails, API keys) are being sent to LLM providers without masking.

**Common causes**:
1. **No config file found**: The plugin requires a config file to work. Check the [Configuration](#configuration) section.
2. **`global_salt` missing**: The plugin won't work without `global_salt` set.
3. **`enabled: false`**: Make sure `enabled` is set to `true` in your config.

**Debug steps**:
```bash
# Enable debug logging to see what's happening
export OPENCODE_GUARD_DEBUG=1
opencode
```

Look for messages like:
- `[opencode-guard] config: not found (plugin disabled)` — Config file missing
- `[opencode-guard] config: /path/to/config, enabled=false` — Plugin disabled in config
- `[opencode-guard] masked N sensitive values` — Working correctly

**Verify config location**:
```bash
# Check if config exists in one of the expected locations
ls -la ~/.config/opencode/vibeguard.config.json
ls -la ./vibeguard.config.json
ls -la ./.opencode/vibeguard.config.json
```

### Git commits contain masked values

**Symptom**: Commit messages or file contents contain masked values like `ce_.rbgrrq@sisyphuslabs.ai` instead of the real email.

**Cause**: The git MCP server is not in the `exclude_mcp_servers` list, so it receives masked data.

**Solution**: Add your git MCP server to the exclusion list:
```json
{
  "exclude_mcp_servers": ["git", "github", "filesystem"]
}
```

See [MCP Server Configuration Guide](docs/MCP_SERVERS.md) for detailed explanation.

### MCP tool calls failing with masked data

**Symptom**: External API calls (email, Slack, webhooks) fail because they receive masked data.

**Cause**: This is **intentional security behavior**. External servers should receive masked data to protect your secrets.

**Solution**: 
- For external APIs that legitimately need real data: Add to `exclude_mcp_servers` (use with caution)
- For operations that must use real data: Use local tools (git, filesystem) instead

⚠️ **Warning**: Adding external APIs to exclusions exposes your sensitive data to third parties.

## Security Notes

1. **Global Salt**: The `global_salt` is the key to deterministic masking. Keep it secret and consistent.
   - Generate using cryptographically secure methods (OpenSSL, `/dev/urandom`, or Node.js `crypto.randomBytes`)
   - Use at least 32 bytes of entropy
   - Never commit the salt to version control
   - Backup your salt - losing it means you cannot restore previously masked values
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

# OpenCode Guard

[![License: GPL v3](https://img.shields.io/badge/License-GPLv3-blue.svg)](https://www.gnu.org/licenses/gpl-3.0)

> **Privacy-first OpenCode plugin with format-preserving masking**

[中文文档](README.zh-CN.md)

## Overview

OpenCode Guard is a privacy-focused plugin for [OpenCode](https://opencode.ai) that automatically masks sensitive data before it reaches LLM providers and MCP servers. Unlike traditional placeholder-based masking, this plugin uses **format-preserving masking** — masked values retain the format and structure of the original data, making them indistinguishable from real values.

**Key Features:**
- 🎭 **Format-Preserving Masking**: Masked emails look like emails, tokens look like tokens
- 🔒 **Deterministic**: Same input + same salt = same masked output
- ⚡ **Parallel Detection**: Regex + AI detection run simultaneously
- 🔌 **LLM + MCP Support**: Masks both LLM API calls and MCP tool invocations
- 🚫 **Excluded Endpoints**: Configure specific endpoints to skip masking
- 💾 **In-Memory Storage**: No persistent storage of secrets

## Disclaimer

[![Vibe Coded](https://img.shields.io/badge/Vibe_Coded-100%25-blueviolet)](https://x.com/karpathy/status/1915000668776960013)

This project is **100% vibe coded** by [Kimi K2.5 for Coding](https://www.moonshot.cn/). The author doesn't understand JavaScript and hasn't read a single line of the code — but hey, it works! 🎉

## Quick Start

### 1. Install

> ⚠️ **Not yet on NPM**: This package has not been published to NPM. A beta release will be published after more extensive testing to verify stability.

Clone to a location of your choice:

```bash
git clone https://github.com/SteamedFish/opencode-guard.git ~/opencode-guard
```

Add to your `opencode.json`:

```json
{
  "$schema": "https://opencode.ai/config.json",
  "plugins": [
    "file:///home/username/opencode-guard/src/index.js"
  ]
}
```

> **Note on paths**: You can use either absolute paths (`file:///home/...`) or relative paths. Relative paths are resolved from the **location of your `opencode.json` file**, not your current working directory.

### 2. Configure

Generate a secure salt:

```bash
openssl rand -base64 32
```

Create config file at `~/.config/opencode/opencode-guard.config.json`:

```json
{
  "enabled": true,
  "global_salt": "YOUR_GENERATED_SALT_HERE"
}
```

> ⚠️ **The plugin is disabled by default without configuration.** See [Configuration Guide](docs/CONFIGURATION.md) for all options.

### 3. Done

OpenCode Guard now automatically masks sensitive data in all LLM and MCP interactions.

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

## Built-in Detection

- **Emails**, **API Keys** (OpenAI, GitHub, AWS), **HTTP Basic Auth**
- **Database URLs** (PostgreSQL, MySQL, MongoDB)
- **IPs** (IPv4, IPv6 with network prefix preservation)
- **MAC Addresses**, **UUIDs**
- **Credentials** (password=..., username=..., api_key=...)

See [Pattern Guide](docs/PATTERNS.md) for custom patterns.

## Optional AI Detection

For detecting sensitive data that regex might miss:

```bash
npm install @xenova/transformers
```

```json
{
  "detection": {
    "ai_detection": true,
    "ai_provider": "local"
  }
}
```

See [AI Detection Guide](docs/AI_DETECTION.md) for detailed setup.

## Documentation

| Guide | Description |
|-------|-------------|
| [Configuration](docs/CONFIGURATION.md) | Complete configuration reference |
| [Patterns](docs/PATTERNS.md) | Built-in patterns and custom detection |
| [AI Detection](docs/AI_DETECTION.md) | AI-powered detection setup |
| [MCP Servers](docs/MCP_SERVERS.md) | MCP server configuration |
| [Troubleshooting](docs/TROUBLESHOOTING.md) | Common issues and solutions |

## Security Notes

1. **Global Salt**: Keep your `global_salt` secret and consistent. Losing it means you cannot restore previously masked values.
2. **No Persistent Storage**: All mappings are stored in memory only. Plugin restart = fresh sessions.
3. **Format Compliance**: Masked values maintain valid format (emails pass email regex, IPs are valid, etc.)
4. **Cryptographic Security**: Uses HMAC-SHA256 for seed generation. Irreversible without the salt.

## Troubleshooting

**Plugin not masking?**

```bash
export OPENCODE_GUARD_DEBUG=1
opencode
```

Common causes:
- No config file found
- `global_salt` not set
- `enabled: false`

See [Troubleshooting Guide](docs/TROUBLESHOOTING.md) for detailed solutions.

## License

This project is licensed under the GNU General Public License v3.0 or later — see the [LICENSE](LICENSE) file for details.

## Acknowledgments

- Inspired by [VibeGuard](https://github.com/inkdust2021/VibeGuard) and [OpenCode-VibeGuard](https://github.com/inkdust2021/opencode-vibeguard)
- Built for [OpenCode](https://opencode.ai)

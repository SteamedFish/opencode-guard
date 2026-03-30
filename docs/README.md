# OpenCode Guard Documentation

Complete documentation for OpenCode Guard.

## Quick Links

| Document | English | 中文 |
|----------|---------|------|
| **Configuration** | [CONFIGURATION.md](CONFIGURATION.md) | [CONFIGURATION.zh-CN.md](CONFIGURATION.zh-CN.md) |
| **Patterns** | [PATTERNS.md](PATTERNS.md) | [PATTERNS.zh-CN.md](PATTERNS.zh-CN.md) |
| **AI Detection** | [AI_DETECTION.md](AI_DETECTION.md) | - |
| **MCP Servers** | [MCP_SERVERS.md](MCP_SERVERS.md) | [MCP_SERVERS.zh-CN.md](MCP_SERVERS.zh-CN.md) |
| **Troubleshooting** | [TROUBLESHOOTING.md](TROUBLESHOOTING.md) | [TROUBLESHOOTING.zh-CN.md](TROUBLESHOOTING.zh-CN.md) |

## Getting Started

1. **Install** the plugin: `npm install opencode-guard`
2. **Configure**: Follow the [Configuration Guide](CONFIGURATION.md)
3. **Test**: Enable debug mode if needed (see [Troubleshooting](TROUBLESHOOTING.md))

## Documentation Overview

### [Configuration Guide](CONFIGURATION.md)
Complete configuration reference including:
- Quick setup instructions
- All configuration options
- Environment variables
- Custom patterns and maskers

### [Patterns Guide](PATTERNS.md)
Everything about detection patterns:
- Built-in detection types
- Masking strategies
- Creating custom patterns
- Exclusions and false positive prevention

### [AI Detection](AI_DETECTION.md)
Optional AI-powered detection:
- Provider options (Local, OpenAI, Custom)
- Model recommendations
- Performance tuning
- Troubleshooting

### [MCP Servers](MCP_SERVERS.md)
MCP server configuration:
- Understanding local vs external servers
- Exclusion configuration
- Security implications

### [Troubleshooting](TROUBLESHOOTING.md)
Common issues and solutions:
- Plugin not working
- Git commits with masked values
- MCP tool failures
- Performance optimization

## Development Docs

- [design.md](design.md) - Architecture and design decisions
- [AI_DETECTION_PLAN.md](AI_DETECTION_PLAN.md) - AI detection implementation plan
- [fix-plan.md](fix-plan.md) - Fix planning document
- [plan.md](plan.md) - Original project plan

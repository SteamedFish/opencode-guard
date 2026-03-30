# OPENCODE GUARD KNOWLEDGE BASE

**Generated:** 2026-03-29 14:20 UTC  
**Version:** 0.1.0  
**License:** GPL-3.0-or-later

## OVERVIEW
Privacy-focused OpenCode plugin using **format-preserving masking**. Masks sensitive data (emails, API keys, passwords) before it reaches LLM providers and MCP servers. Masked values retain original format - emails look like emails, tokens look like tokens.

## STRUCTURE
```
./
├── src/
│   ├── index.js           # Plugin entry point - OpenCode hooks
│   ├── engine.js          # Redact/redactDeep - core masking logic
│   ├── detector.js        # Pattern-based sensitive data detection
│   ├── patterns.js        # Built-in patterns (email, uuid, ipv4, etc.)
│   ├── session.js         # MaskSession - deterministic masking storage
│   ├── config.js          # Configuration loading from multiple sources
│   ├── restore.js         # restoreText/restoreDeep - unmasking
│   ├── utils.js           # createSeededRNG, hash utilities
│   ├── streaming-unmasker.js  # Streaming response unmasking
│   └── maskers/           # Specialized maskers per data type
│       ├── index.js       # Masker registry and dispatch
│       ├── email.js       # Email masking (preserve domain)
│       ├── token.js       # API key masking (preserve prefix)
│       ├── ip.js          # IPv4/IPv6 masking (preserve network)
│       ├── uuid.js        # UUID masking
│       ├── mac.js         # MAC address masking
│       ├── basicAuth.js   # HTTP Basic Auth masking
│       ├── database.js    # Database URL masking
│       ├── credential.js  # Password/username masking
│       ├── generic.js     # Fallback pattern-based masking
│       └── custom.js      # Custom masker registry
├── tests/                 # Mirror of src/ structure
├── docs/                  # Additional documentation
├── opencode-guard.config.json.example  # Configuration template
├── package.json           # ES module, Node >=18
└── README.md / README.zh-CN.md
```

## WHERE TO LOOK

| Task | Location | Notes |
|------|----------|-------|
| Add new data type masker | `src/maskers/` | Create new file + export in `index.js` |
| Add detection pattern | `src/patterns.js` | Add to `BUILTIN` Map or via config |
| Change masking behavior | `src/maskers/*.js` | Each type has dedicated masker |
| Plugin hooks | `src/index.js` | 5 OpenCode lifecycle hooks |
| Configuration schema | `opencode-guard.config.json.example` | All options documented |
| Tests | `tests/` | Mirror structure - one test per source file |

## CONVENTIONS

### Code Style
- **ES Modules**: `"type": "module"` in package.json - use `import/export`
- **Node.js >=18**: Modern JS features available (structuredClone, etc.)
- **JSDoc**: Functions have JSDoc comments with `@param` types
- **Named exports**: Prefer `export function` over default exports

### Error Handling
- Silent failures in config loading (catch + console.warn)
- Invalid regex patterns are skipped (try/catch in pattern compilation)
- Missing config = plugin disabled (not error)

### Testing
- Node.js built-in test runner: `node --test`
- Test files: `*.test.js` alongside source or in `tests/`
- Run: `npm test`

### Masking Strategy
1. **Deterministic**: Same input + salt = same output (via HMAC-SHA256 seed)
2. **Format-preserving**: Emails have @, IPs have dots, etc.
3. **Prefix preservation**: API keys keep prefixes (`sk-`, `ghp_`)
4. **Domain preservation**: Emails keep domain part
5. **Network preservation**: IPs keep subnet prefix

## ANTI-PATTERNS (THIS PROJECT)

**DO NOT:**
- Use `require()` - ES modules only
- Add persistent storage (SQLite, files) - in-memory only by design
- Change masking to be non-deterministic - breaks restore functionality
- Skip overlap handling in detector - causes double-masking bugs
- Mask excluded values - always check `patterns.exclude` first

## COMMANDS

```bash
# Run tests
npm test

# Test specific file
node --test tests/engine.test.js

# Debug mode
OPENCODE_GUARD_DEBUG=1 npm test

# Install locally for development
# Add to opencode.json (absolute or relative path - relative paths resolve from opencode.json location):
# "plugins": ["file:///home/username/opencode-guard/src/index.js"]
```

## NOTES

### OpenCode Plugin Lifecycle
1. **Load**: `OpenCodeGuard(ctx)` called, config loaded
2. **Transform**: `experimental.chat.messages.transform` - mask outgoing
3. **Complete**: `experimental.text.complete` - restore incoming
4. **MCP Before**: `mcp.tool.call.before` - mask tool args
5. **MCP After**: `mcp.tool.call.after` - restore tool result

### Session Management
- Sessions keyed by `sessionID` from OpenCode context
- Each session has independent mapping storage
- TTL cleanup on access (lazy expiration)
- Max mappings limit prevents memory leaks

### Configuration Priority (highest to lowest)
1. `OPENCODE_GUARD_CONFIG` env var (explicit path)
2. `./opencode-guard.config.json` (project root)
3. `./.opencode/opencode-guard.config.json`
4. `~/.config/opencode/opencode-guard.config.json`

### Security Model
- `global_salt` required - shared secret for deterministic masking
- No salt = plugin disabled (fail-safe)
- HMAC-SHA256 for seed generation (irreversible without salt)
- In-memory only - no persistence of sensitive mappings

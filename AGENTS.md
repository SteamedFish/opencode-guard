# OPENCODE GUARD KNOWLEDGE BASE

**Generated:** 2026-03-29 14:20 UTC  
**Version:** 0.2.0  
**License:** GPL-3.0-or-later

## OVERVIEW
Privacy-focused OpenCode plugin using **format-preserving masking**. Masks sensitive data (emails, API keys, passwords) before it reaches LLM providers and MCP servers. Masked values retain original format - emails look like emails, tokens look like tokens.

## STRUCTURE
```
./
├── src/
│   ├── index.js           # Plugin entry point - dual-compat { id, setup (v2), server (v1) }
│   ├── guard-core.js      # createGuardCore - shared init (config, patterns, sessions, exclusions)
│   ├── v2.js              # setupV2 + createV2Handlers - OpenCode v2 hook registrations
│   ├── response-unmasker.js  # wrapResponse / JSON-safe session view for v2 HTTP streams
│   ├── engine.js          # Redact/redactDeep - core masking logic
│   ├── detector.js        # Pattern-based sensitive data detection
│   ├── patterns.js        # Built-in patterns (email, uuid, ipv4, etc.)
│   ├── session.js         # MaskSession - deterministic masking storage
│   ├── config.js          # Configuration loading from multiple sources
│   ├── logger.js          # createLogger - debug console mirror + opt-in debug file (v2 console is invisible)
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
├── scripts/e2e/           # capture-server.py - fake provider for E2E masking tests
├── .opencode/skills/guard-e2e-testing/  # Testing playbook skill for future sessions
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
| Plugin hooks | `src/index.js` (v1 entry), `src/v2.js` (v2 hooks), `src/guard-core.js` (shared init) |
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
- Missing config = auto-generate minimal config with random salt (plugin enabled); generation failure = in-memory salt fallback + warning

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
6. **All-occurrence masking**: a value flagged by AI detection is masked at every whole-token occurrence in the same message, not just the first-bound one (see `src/ai-detector/expand.js`)

## DOCUMENTATION CONVENTIONS

### Bilingual Documentation
- All documentation exists in English (`.md`) and Chinese (`.zh-CN.md`) versions
- **Cross-linking rule**: Chinese documents MUST link to Chinese versions (`.zh-CN.md`)
  - Exception: If no Chinese version exists, link to English and note "(暂无中文版)"
- English documents link to English versions
- Language switch link (e.g., "[English Documentation]") is the only exception

### File Naming
- English: `FILENAME.md`
- Chinese: `FILENAME.zh-CN.md`

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

# Install locally for development (v2: auto-discovered, hot-reloaded; no config change needed):
#   mkdir -p ~/.config/opencode/plugins
#   ln -s /home/username/opencode-guard/src ~/.config/opencode/plugins/opencode-guard
# Or register explicitly in opencode.json (v1 and v2; relative paths resolve from opencode.json location):
#   "plugins": ["file:///home/username/opencode-guard/src/index.js"]
```

## NOTES

### OpenCode Plugin Lifecycle
The plugin has a dual-compat entry point (`export default { id, setup, server }`):
- **v1** (OpenCode >=1.18.29) calls `server(ctx)` → returns a hooks object:
  1. **Transform**: `experimental.chat.messages.transform` - mask outgoing
  2. **Complete**: `experimental.text.complete` - restore incoming
  3. **Streaming**: `experimental.text.chunk` / `experimental.stream.end` - streaming restore
  4. **MCP Before/After**: `mcp.tool.call.before` / `mcp.tool.call.after` - mask tool args / results
  5. **Tool Before/After**: `tool.execute.before` / `tool.execute.after` - restore built-in tool args, mask results
- **v2** calls `setup(ctx)` (in `src/v2.js`) and registers hooks via domain methods:
  1. `ctx.session.hook('context'|'compaction'|'generate'|'title', maskRequest)` - mask outgoing (per request; persisted history keeps originals)
  2. `ctx.tool.hook('execute.before'|'execute.after', ...)` - built-in + MCP tools (MCP tools are named `<server>_<tool>`)
  3. `ctx.session.hook('http.response', ...)` - wraps the provider Response stream for restoration (JSON-safe originals only). SSE-aware restore handles two provider stream shapes: OpenAI `chat.completion.chunk` (`choices[].delta.content` / `reasoning_content` / streamed `tool_calls[].function.arguments`) and Anthropic Messages API `type`-tagged events (`content_block_delta.delta.text` / `partial_json` / `thinking`, `content_block_start.text` / `thinking` / tool_use `name`); held-back remainders flush at `content_block_stop` / `message_delta` / `message_stop` / stream end. Unknown SSE shapes pass through byte-identical WITHOUT restore — fail-safe (no leak) but masked values stay masked.
  4. `ctx.session.hook('experimental.ws.handshake'|'experimental.ws.receive', ...)` - best-effort per-frame WS restore
  5. v2 baseURL exclusion resolved via `ctx.provider.get({ providerID })` → `data?.settings?.baseURL` (cached per providerID)
  6. v2 MCP server names via `ctx.mcp.list()` (cached 5s); sanitize = `s.replace(/[^a-zA-Z0-9_-]/g, '_')`
  7. v2 (>=2.0.6) MCP tools default to `codemode: true` — they are nested inside the `execute` Code Mode tool and are NOT sent in the provider request's `tools` array (they appear in the system-prompt catalog as `tools.<server>.<tool>`). Direct exposure needs native config format `mcp.servers.<name>.codemode: false`; the legacy `"mcp": {"<name>": {...}}` format silently strips `codemode` (strict decode + excess-key ignore). Wire/tool-hook name is `<server>_<tool>` sanitized (e.g. `fake_lookup_secret`); the dotted form is only the Code Mode catalog path. Also: opencode sends the round-1 request BEFORE MCP finishes connecting — MCP tools only appear in the tools array from round 2 onward.

### Debug Logging
- Under OpenCode **v2**, plugin `console.log`/`console.warn` output is invisible (not in server log, `--print-logs`, or standalone serve stdout) — `debug_file` / `OPENCODE_GUARD_DEBUG_FILE` is the only way to observe the plugin.
- The debug file persists masked→original mappings and other sensitive values — enable only temporarily and delete after debugging.
- Logger appends are fire-and-forget with `.catch(() => {})` — a failing log file must never break the plugin.

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

On first run, if no config exists in any location, a minimal config `{ "global_salt": "<64 random hex>" }` (permissions 0600) is auto-generated at location 4 and the plugin is enabled out-of-the-box. If writing fails, fall back to an in-memory random salt (mappings lost on restart) with a warning; plugin stays enabled. Only an explicit `"enabled": false` disables the plugin.

### Security Model
- `global_salt` required - shared secret for deterministic masking
- No config file = auto-generated random salt (plugin enabled); existing config missing salt = plugin disabled (fail-safe)
- HMAC-SHA256 for seed generation (irreversible without salt)
- In-memory only - no persistence of sensitive mappings

## GIT WORKFLOW (agreed 2026-09-18)
- Worktree + topic branch for non-trivial work (`.slim/worktrees/<slug>`, branch `omos/<slug>`); direct edits on `main` acceptable for trivial one-liners
- GPG-signed atomic commits, committed per logical lane; commit only your own changes
- After verification (full `npm test` green), merge to `main` and push automatically - no need to ask
- Commit scope includes project meta (AGENTS.md, plan/, CHANGELOG, docs)

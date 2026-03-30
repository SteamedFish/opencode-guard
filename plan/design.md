# OpenCode Guard Design Document

**Date**: 2025-03-29  
**Project**: opencode-guard  
**Status**: Ready for Implementation (Format-Preserving Version)

## Overview

OpenCode Guard is a privacy-focused OpenCode plugin that masks sensitive data before it reaches LLM providers and MCP servers. Unlike hash-based placeholders, this implementation uses **format-preserving masking** - masked values retain the format and structure of the original data, making them indistinguishable from real values to upstream systems.

## Key Requirements

1. **Format-Preserving Masking**: Masked data looks like the real thing (emails look like emails, tokens like tokens)
2. **Deterministic**: Same input + same salt = same masked output
3. **Parallel Detection**: Regex + AI detection run in parallel
4. **LLM + MCP Support**: Mask/unmask both LLM API calls and MCP tool invocations
5. **Excluded Endpoints**: Configure specific LLM endpoints and MCP servers to skip
6. **In-Memory Storage**: No SQLite, use memory-based session management

## Architecture

### Core Components

```
┌─────────────────────────────────────────────────────────────────┐
│                    OpenCode Guard Plugin                        │
├─────────────────────────────────────────────────────────────────┤
│  ┌──────────────┐  ┌──────────────┐  ┌──────────────────────┐  │
│  │   Config     │  │   Patterns   │  │   Session Manager    │  │
│  │   Loader     │  │   Builder    │  │   (In-Memory)        │  │
│  └──────────────┘  └──────────────┘  └──────────────────────┘  │
│         │                 │                    │                │
│         ▼                 ▼                    ▼                │
│  ┌──────────────────────────────────────────────────────────┐  │
│  │              Detection Pipeline (Parallel)               │  │
│  │  ┌─────────────┐      ┌─────────────┐                   │  │
│  │  │   Regex     │ ────▶│   Merge &   │                   │  │
│  │  │   Engine    │      │ Deduplicate │                   │  │
│  │  └─────────────┘      └─────────────┘                   │  │
│  │         ▲                    ▲                          │  │
│  │         │                    │                          │  │
│  │  ┌─────────────┐      ┌─────────────┐                   │  │
│  │  │  AI-based   │ ────▶│   Format    │                   │  │
│  │  │  Detection  │      │  Preserving │                   │  │
│  │  └─────────────┘      │   Masker    │                   │  │
│  │                       └─────────────┘                   │  │
│  └──────────────────────────────────────────────────────────┘  │
│                              │                                  │
│         ┌────────────────────┼────────────────────┐             │
│         ▼                    ▼                    ▼             │
│  ┌──────────────┐    ┌──────────────┐    ┌──────────────┐      │
│  │  LLM Hooks   │    │  MCP Hooks   │    │ Tool Restore │      │
│  │  (mask)      │    │  (mask/unmask)│    │  (unmask)    │      │
│  └──────────────┘    └──────────────┘    └──────────────┘      │
└─────────────────────────────────────────────────────────────────┘
```

### Format-Preserving Masking Strategy

Each data type has a format-aware masker that generates realistic-looking replacement:

| Data Type | Original Example | Masked Example | Strategy |
|-----------|------------------|----------------|----------|
| **Email** | `john.doe@company.com` | `a3f7.k9@company.com` | Preserve domain, mask local part |
| **API Key (OpenAI)** | `sk-abc123def456` | `sk-x9m2p5q8r3t6` | Preserve prefix, regenerate suffix |
| **OpenAI Project Key** | `sk-proj-abc123...` | `sk-proj-x9m2p5q...` | Preserve sk-proj- prefix |
| **OpenRouter Key** | `sk-or-v1-abc123...` | `sk-or-v1-x9m2p5...` | Preserve sk-or-v1- prefix |
| **LiteLLM Key** | `sk-litellm-abc123...` | `sk-litellm-x9m2...` | Preserve sk-litellm- prefix |
| **Kimi Key** | `sk-kimi-abc123...` | `sk-kimi-x9m2p5q...` | Preserve sk-kimi- prefix |
| **Anthropic Key** | `sk-ant-abc123...` | `sk-ant-x9m2p5q8...` | Preserve sk-ant- prefix |
| **GitHub Token** | `ghp_xxxxxxxxxxxx` | `ghp_yyyyyyyyyyyy` | Preserve prefix, regenerate suffix |
| **AWS Key** | `AKIAIOSFODNN7EXAMPLE` | `AKIA3F9K2M8P1Q7R4T6` | Preserve AKIA prefix, regenerate rest |
| **HTTP Basic Auth URL** | `https://user:pass@api.com` | `https://masked:****@api.com` | Mask both user and password |
| **Basic Auth Header** | `Basic dXNlcjpwYXNz` | `Basic REDACTED` | Replace entire credential |
| **Database URL** | `postgres://user:pass@db:5432` | `postgres://masked:****@db:5432` | Mask both user and password |
| **Generic Credential** | `API_KEY=secret123` | `API_KEY=********` | Mask value after = or : |
| **Password** | `password=secret123` | `password=********` | Mask entire value |
| **Username** | `username=admin` | `username=********` | Mask entire value |
| **User** | `user=john` | `user=********` | Mask entire value |
| **IPv4** | `192.168.1.100` | `192.168.x.x` | Keep /16 prefix, mask host |
| **IPv6** | `fe80::1` | `fe80:0:0:0::x` | Keep /64 prefix, mask interface ID |
| **UUID** | `550e8400-e29b-41d4-a716-446655440000` | `a1b2c3d4-e5f6-4a7b-8c9d-0e1f2a3b4c5d` | Valid UUID v4 |
| **MAC** | `00:1b:44:11:3a:b7` | `02:af:3c:8d:5e:1f` | Random valid MAC |
| **Phone (CN)** | `13812345678` | `15987654321` | Valid format, random digits |
| **Credit Card** | `4532-1234-5678-9012` | `4111-2222-3333-4444` | Valid format, random digits |
| **Generic** | `my-secret-value` | `masked_a7k9p2m4` | Deterministic hash-based |

### Masking Algorithm

For each detected sensitive value:

1. **Check session**: If already masked, return cached masked value
2. **Identify format**: Determine data type from pattern/category
3. **Generate mask**: Use HMAC-based RNG seeded with (global_salt + original_value) to generate format-compliant replacement
4. **Store mapping**: original → masked (and reverse for restore)
5. **Return masked value**

### Deterministic Generation

All masked values are deterministically generated using:

```javascript
// Seed = HMAC(salt, original)
const seed = generateHmacHash(globalSalt, originalValue);

// Use seed to drive RNG for format-preserving generation
const rng = createSeededRNG(seed);
const masked = generateFormatCompliantValue(rng, formatType, originalValue);
```

**Benefits:**
- Same input always produces same masked output (within session)
- No lookup table needed for masking (but we keep one for restore)
- Cryptographically irreversible without the salt

### Configuration Structure

```json
{
  "enabled": true,
  "debug": false,
  "global_salt": "user-provided-secret-string",
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
    "http://localhost:11434",
    "https://api.private.company.com"
  ],
  "exclude_mcp_servers": [
    "local-filesystem",
    "dev-server"
  ],
  "patterns": {
    "keywords": [
      { "value": "my-api-key-123", "category": "API_KEY", "mask_as": "token" }
    ],
    "regex": [
      { "pattern": "sk-[A-Za-z0-9]{48}", "category": "OPENAI_KEY", "mask_as": "sk_token" },
      { "pattern": "(ghp|gho|ghu|ghs|ghr)_[A-Za-z0-9]+", "category": "GITHUB_TOKEN", "mask_as": "gh_token" }
    ],
    "builtin": ["email", "phone", "uuid", "ipv4"],
    "exclude": ["example.com", "localhost", "127.0.0.1", "0.0.0.0"]
  },
  "custom_maskers": {
    "sk_proj_token": {
      "type": "prefixed_token",
      "prefix": "sk-proj-",
      "suffix_length": 48,
      "suffix_chars": "alphanumeric"
    },
    "sk_or_token": {
      "type": "prefixed_token",
      "prefix": "sk-or-v1-",
      "suffix_length": 48,
      "suffix_chars": "alphanumeric"
    },
    "sk_litellm_token": {
      "type": "prefixed_token",
      "prefix": "sk-litellm-",
      "suffix_length": 48,
      "suffix_chars": "alphanumeric"
    },
    "sk_kimi_token": {
      "type": "prefixed_token",
      "prefix": "sk-kimi-",
      "suffix_length": 32,
      "suffix_chars": "alphanumeric"
    },
    "sk_ant_token": {
      "type": "prefixed_token",
      "prefix": "sk-ant-",
      "suffix_length": 32,
      "suffix_chars": "alphanumeric"
    }
  }
}
```

## Masker Modules

### Email Masker

```javascript
// user@example.com → a3f7.k9@example.com
function maskEmail(email, rng) {
  const [local, domain] = email.split('@');
  const maskedLocal = generateRandomString(rng, local.length, 
    /[a-z]/.test(local) ? 'lower' : 
    /[A-Z]/.test(local) ? 'upper' : 'mixed'
  );
  return `${maskedLocal}@${domain}`;
}
```

### Token Masker (Prefix-Aware)

The token masker automatically detects common prefixes and preserves them:

```javascript
// Detects and preserves prefixes like sk-, sk-proj-, sk-or-v1-, etc.
function maskToken(token, rng) {
  const prefixes = [
    'sk-proj-', 'sk-or-v1-', 'sk-litellm-', 
    'sk-kimi-', 'sk-ant-', 'sk-'
  ];
  
  const prefix = prefixes.find(p => token.startsWith(p)) || '';
  const suffix = token.slice(prefix.length);
  const maskedSuffix = generateRandomAlphanumeric(rng, suffix.length);
  return `${prefix}${maskedSuffix}`;
}

// Examples:
// sk-abc123 → sk-x9m2p5q
// sk-proj-abc123 → sk-proj-x9m2p5q
// sk-or-v1-abc123 → sk-or-v1-x9m2p5q
```

**Supported Token Prefixes:**
- `sk-` - Standard OpenAI keys
- `sk-proj-` - OpenAI project keys
- `sk-or-v1-` - OpenRouter keys
- `sk-litellm-` - LiteLLM keys
- `sk-kimi-` - Kimi keys
- `sk-ant-` - Anthropic keys
- `sk-{custom}-` - Any other sk- prefixed variants (dynamic detection)
- `ghp_`, `gho_`, `ghu_`, `ghs_`, `ghr_` - GitHub tokens
- `AKIA`, `ASIA` - AWS keys
- `Bearer ` - Bearer tokens

### IP Masker

```javascript
// 192.168.1.100 → 192.168.x.x (keep /16 prefix, mask host portion)
// Keeps the network category (private/public) intact
function maskIPv4(ip, rng) {
  const parts = ip.split('.');
  // Keep first two octets (/16), mask last two (host portion)
  const maskedOctet3 = rng(0, 255);
  const maskedOctet4 = rng(1, 254);
  return `${parts[0]}.${parts[1]}.${maskedOctet3}.${maskedOctet4}`;
}

// fe80::1 → fe80:0:0:0::xxxx (keep /64 prefix, mask interface ID)
function maskIPv6(ip, rng) {
  const expanded = expandIPv6(ip);
  const groups = expanded.split(':');
  // Keep first 4 groups (/64 network prefix), mask last 4 (interface ID)
  const maskedGroups = [];
  for (let i = 0; i < 4; i++) {
    maskedGroups.push(rng(0, 65535).toString(16).padStart(4, '0'));
  }
  return `${groups.slice(0, 4).join(':')}:${maskedGroups.join(':')}`;
}
```

### UUID Masker

```javascript
// Generates valid UUID v4 with seeded RNG
function maskUUID(uuid, rng) {
  // UUID v4 format: xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx
  // where y is 8, 9, a, or b
  return generateUUIDv4(rng);
}
```

### Generic Masker (Fallback)

For unknown formats, use hash-based masking with configurable alphabet:

```javascript
// my-secret-value → masked_a7k9p2m4
default: generateDeterministicPlaceholder(rng, length, prefix = 'masked_')
```

## Extensible Pattern System

The plugin supports easy extension via configuration. Users can define **custom patterns** and **custom maskers** without modifying code.

### Custom Patterns via Config

Add new detection patterns and associate them with maskers:

```json
{
  "patterns": {
    "regex": [
      {
        "pattern": "sk-proj-[A-Za-z0-9]{48}",
        "category": "OPENAI_PROJECT_KEY",
        "mask_as": "sk_proj_token"
      },
      {
        "pattern": "sk-or-v1-[A-Za-z0-9]{48}",
        "category": "OPENROUTER_KEY",
        "mask_as": "sk_or_token"
      },
      {
        "pattern": "sk-litellm-[A-Za-z0-9]{48}",
        "category": "LITELLM_KEY",
        "mask_as": "sk_litellm_token"
      },
      {
        "pattern": "sk-kimi-[A-Za-z0-9]{32}",
        "category": "KIMI_KEY",
        "mask_as": "sk_kimi_token"
      },
      {
        "pattern": "sk-ant-[A-Za-z0-9]{32}",
        "category": "ANTHROPIC_KEY",
        "mask_as": "sk_ant_token"
      }
    ]
  }
}
```

### Custom Maskers via Config

Define new masker behaviors without code changes:

```json
{
  "custom_maskers": {
    "my_custom_token": {
      "type": "prefixed_token",
      "prefix": "myapp-",
      "suffix_length": 32,
      "suffix_chars": "alphanumeric"
    },
    "my_custom_pattern": {
      "type": "pattern_preserving",
      "char_sets": {
        "uppercase": true,
        "lowercase": true,
        "digits": true,
        "special": "_-"
      }
    },
    "fixed_length_token": {
      "type": "fixed_length",
      "length": 40,
      "chars": "alphanumeric",
      "prefix": "tk_"
    }
  }
}
```

### Masker Types

| Type | Description | Config Options |
|------|-------------|----------------|
| `prefixed_token` | Preserve prefix, mask suffix | `prefix`, `suffix_length`, `suffix_chars` |
| `pattern_preserving` | Preserve character types | `char_sets` (uppercase, lowercase, digits, special) |
| `fixed_length` | Generate fixed-length token | `length`, `chars`, `prefix` |
| `email` | Built-in email masker | (none) |
| `uuid` | Built-in UUID v4 generator | (none) |
| `ipv4` | Built-in IPv4 generator | (none) |
| `ipv6` | Built-in IPv6 generator | (none) |
| `basic_auth_url` | Mask URL credentials | (none) |
| `basic_auth_header` | Mask Basic auth header | (none) |
| `db_connection` | Mask DB connection strings | `mask_password_only` (default: true) |
| `generic_credential` | Mask key=value patterns | (none) |
| `password` | Mask password values | (none) |

### Built-in Token Patterns

The following token patterns are **built-in** and automatically available:

```javascript
const BUILTIN_TOKEN_PATTERNS = [
  // OpenAI variants
  { pattern: /sk-[A-Za-z0-9]{48}/, maskAs: 'sk_token' },
  { pattern: /sk-proj-[A-Za-z0-9]{48}/, maskAs: 'sk_proj_token' },
  { pattern: /sk-or-v1-[A-Za-z0-9-]{64,}/, maskAs: 'sk_or_token' },
  { pattern: /sk-litellm-[A-Za-z0-9]{48}/, maskAs: 'sk_litellm_token' },
  { pattern: /sk-kimi-[A-Za-z0-9]{32}/, maskAs: 'sk_kimi_token' },
  { pattern: /sk-ant-[A-Za-z0-9]{32}/, maskAs: 'sk_ant_token' },
  { pattern: /sk-[a-z]+-[A-Za-z0-9_-]{20,}/, maskAs: 'sk_variant_token' },
  
  // GitHub tokens
  { pattern: /ghp_[A-Za-z0-9]{36}/, maskAs: 'gh_token' },
  { pattern: /gho_[A-Za-z0-9]{36}/, maskAs: 'gh_token' },
  { pattern: /ghu_[A-Za-z0-9]{36}/, maskAs: 'gh_token' },
  { pattern: /ghs_[A-Za-z0-9]{36}/, maskAs: 'gh_token' },
  { pattern: /ghr_[A-Za-z0-9]{36}/, maskAs: 'gh_token' },
  
  // AWS
  { pattern: /AKIA[0-9A-Z]{16}/, maskAs: 'aws_token' },
  { pattern: /ASIA[0-9A-Z]{16}/, maskAs: 'aws_token' },
  
  // HTTP Basic Auth
  { pattern: /https?:\/\/[^:]+:[^@]+@[^\s]+/, maskAs: 'basic_auth_url' },
  { pattern: /Basic\s+[A-Za-z0-9+/]{20,}=*/, maskAs: 'basic_auth_header' },
  
  // Database connection strings
  { pattern: /(?:postgres|postgresql|mysql|mongodb|redis|amqp|mqtt|ldap):\/\/[^:]+:[^@]+@[^\s]+/, maskAs: 'db_connection', flags: 'i' },
  { pattern: /DATABASE_URL\s*=\s*[^\s]+/, maskAs: 'db_env_var' },
  { pattern: /CONNECTION_STRING\s*=\s*[^\s]+/, maskAs: 'db_env_var' },
  { pattern: /mongodb\+srv:\/\/[^\s]+/, maskAs: 'db_connection', flags: 'i' },
  
  // Generic API key patterns (key=value style)
  { pattern: /(?:api[_-]?key|secret[_-]?key|access[_-]?token|client[_-]?secret|auth[_-]?token|master[_-]?key|private[_-]?key|signing[_-]?key|encryption[_-]?key|webhook[_-]?secret)\s*[:=]\s*\S{8,}/i, maskAs: 'generic_credential' },
  { pattern: /(?:apikey|secretkey|accesstoken|clientsecret|authtoken|masterkey|privatekey|signingkey|encryptionkey|webhooksecret)\s*[:=]\s*\S{8,}/i, maskAs: 'generic_credential' },
  
  // Common API key patterns
  { pattern: /[Bb]earer\s+[A-Za-z0-9_-]{20,}/, maskAs: 'bearer_token' },
  { pattern: /[Bb]asic\s+[A-Za-z0-9+/]{20,}=*/, maskAs: 'basic_auth_header' },
  
   // Raw password candidates (contextual patterns)
   // These are harder to detect with regex alone - AI detection recommended
   { pattern: /password\s*[:=]\s*\S{8,}/i, maskAs: 'password' },
   { pattern: /passwd\s*[:=]\s*\S{8,}/i, maskAs: 'password' },
   { pattern: /pwd\s*[:=]\s*\S{8,}/i, maskAs: 'password' },
   { pattern: /pass\s*[:=]\s*\S{8,}/i, maskAs: 'password' },
   
   // Username patterns
   { pattern: /username\s*[:=]\s*\S{3,}/i, maskAs: 'username' },
   { pattern: /user\s*[:=]\s*\S{3,}/i, maskAs: 'username' },
];
```

**Note on Password Detection**: Raw passwords are difficult to detect reliably with regex alone. The patterns above catch common `key=value` style password declarations, but free-form passwords in text require AI-based detection. Enable `detection.ai_detection: true` for better password detection.

**Note on Database URLs**: Connection strings often contain embedded credentials. The patterns above detect common database URL formats (PostgreSQL, MySQL, MongoDB, Redis, RabbitMQ, MQTT, LDAP) and mask the entire URL or just the credentials portion depending on the masker configuration.

**Note**: Built-in patterns use **prefix detection** for masking. When a token like `sk-proj-abc123` is detected, the masker:
1. Identifies the prefix (`sk-proj-`)
2. Masks only the suffix (`abc123`)
3. Generates a deterministic suffix of the same length
4. Reconstructs: `sk-proj-` + masked_suffix

## Hook Implementations

### 1. LLM Request Hook (`experimental.chat.messages.transform`)

**Purpose**: Mask sensitive data before sending to LLM provider

**Flow:**
1. Check if endpoint is in `exclude_llm_endpoints` → skip if yes
2. Get or create session for `sessionID`
3. For each message in messages array:
   - Detect sensitive data using patterns
   - Generate format-preserving masked values
   - Replace originals with masked versions
4. Log debug info (count and types of masked values)

### 2. LLM Response Hook (`experimental.text.complete`)

**Purpose**: Restore masked values in LLM response to original values

**Flow:**
1. Get session for `sessionID`
2. Find all masked values using pattern matching
3. Lookup originals in session reverse map
4. Replace masked → original

### 3. MCP Tool Call Before Hook (`mcp.tool.call.before`)

**Purpose**: Mask sensitive data in tool arguments before MCP server receives them

**Flow:**
1. Check if MCP server is in `exclude_mcp_servers` → skip if yes
2. Get session for `sessionID`
3. Deep scan and mask `output.args` object
4. MCP server receives format-compliant masked values

### 4. MCP Tool Call After Hook (`mcp.tool.call.after`)

**Purpose**: Restore masked values in MCP response before UI displays it

**Flow:**
1. Get session for `sessionID`
2. Deep restore `output.result` object/string
3. UI receives original values

### 5. Tool Execute Before Hook (`tool.execute.before`)

**Purpose**: Restore masked values before local tool execution

**Flow:**
1. Get session for `sessionID`
2. Deep restore `output.args` object
3. Tool executes with real values

## Detection Pipeline

### Stage 1: Regex Detection

- Pre-compiled RegExp objects from patterns
- Returns: `[{start, end, category, matched_text, mask_as}]`

### Stage 2: AI Detection (Optional)

- Only runs if `detection.ai_detection === true`
- Returns: `[{start, end, category, confidence}]`
- AI-detected values use generic masker or category-based masker

### Stage 3: Merge & Deduplication

1. Combine regex and AI results
2. Sort by position
3. Remove overlapping matches (keep longest match)
4. Apply exclude patterns

### Stage 4: Format-Preserving Masking

For each match:
1. Determine masker type from `mask_as` or auto-detect from pattern
2. Generate deterministic masked value using seeded RNG
3. Store mapping for restore

## Session Management

### In-Memory Storage

```javascript
const sessions = new Map();

class Session {
  constructor(globalSalt, options) {
    this.globalSalt = globalSalt;
    this.ttlMs = options.ttlMs;
    this.maxMappings = options.maxMappings;
    
    // Maps for bidirectional lookup
    this.originalToMasked = new Map(); // original -> masked
    this.maskedToOriginal = new Map(); // masked -> original
    this.timestamps = new Map(); // masked -> created_at
    
    // Cache for deterministic generation
    this.generationCache = new Map(); // key -> masked
  }
  
  // Methods: cleanup(), evictOldest(), getOrCreateMasked(), lookupOriginal()
}
```

### TTL & Cleanup

- Cleanup runs on every operation
- Remove entries older than `session_ttl`
- If size exceeds `max_mappings`, evict oldest entries (LRU)

## Security Considerations

1. **Global Salt**: User-provided, stored in config file
   - Not exposed to LLM/MCP
   - Same salt = deterministic masking across sessions
   - Changing salt invalidates all existing mappings

2. **No Persistent Storage**: All mappings in memory only
   - Plugin restart = fresh sessions
   - No risk of secret leakage via filesystem

3. **Format-Preserving Benefits**:
   - Upstream can't easily detect masking is happening
   - Masked values pass format validation
   - LLM can reason about structure (e.g., "the email address")

4. **Cryptographic Security**:
   - HMAC-SHA256 based RNG seeding
   - Irreversible without the salt
   - No statistical correlation between original and masked

## Error Handling

| Error Scenario | Behavior |
|---------------|----------|
| Config file missing | Plugin no-op (safe fallback) |
| Config `enabled: false` | Plugin no-op |
| AI detection timeout | Use regex results only |
| AI detection fails | Use regex results only |
| Invalid regex pattern | Skip pattern, log warning |
| Session limit reached | Evict oldest entries (LRU) |
| Unknown format | Use generic hash-based masker |

## Testing Strategy

1. **Unit Tests**:
   - Each masker type (email, token, IP, UUID, etc.)
   - Pattern matching with various formats
   - Deterministic generation (same input = same output)
   - Session management (TTL, eviction)
   - Config loading

2. **Integration Tests**:
   - End-to-end masking/unmasking
   - LLM hook transformations
   - MCP hook transformations
   - Tool restore functionality

3. **Format Compliance Tests**:
   - Emails pass email regex
   - IPs are valid IP addresses
   - UUIDs are valid UUID v4
   - Tokens preserve prefix structure

## File Structure

```
src/
├── index.js              # Plugin entry point
├── config.js             # Config loading
├── patterns.js           # Pattern compilation
├── detector.js           # Detection pipeline
├── session.js            # Session management
├── engine.js             # Masking orchestration
├── restore.js            # Restore logic
├── utils.js              # Utilities (HMAC, RNG, etc.)
└── maskers/
    ├── index.js          # Masker registry
    ├── email.js          # Email format masker
    ├── token.js          # API token maskers (sk-, sk-proj-, ghp_, etc.)
    ├── custom.js         # Extensible custom masker system
    ├── ip.js             # IPv4/IPv6 masker
    ├── uuid.js           # UUID masker
    ├── phone.js          # Phone number masker
    ├── credit-card.js    # Credit card masker
    └── generic.js        # Fallback masker
```

## Next Steps

1. ✅ Design document completed (format-preserving version)
2. ⬜ Update implementation plan
3. ⬜ Implement masker modules
4. ⬜ Implement core components
5. ⬜ Write comprehensive tests
6. ⬜ Documentation

## References

- Original VibeGuard: https://github.com/inkdust2021/VibeGuard
- OpenCode Plugin API: https://opencode.ai/docs/plugins
- MCP Specification: https://modelcontextprotocol.io
- Format-Preserving Encryption: https://en.wikipedia.org/wiki/Format-preserving_encryption

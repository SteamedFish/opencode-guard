# OpenCode Guard Implementation Plan

> **REQUIRED SUB-SKILL:** Use executing-plans to implement this plan task-by-task.  
> **CRITICAL:** Work MUST be done on a feature branch, NEVER on main/master.  
> Use using-git-worktrees to create isolated workspace with new branch.

**Goal:** Build an OpenCode plugin with format-preserving masking - sensitive data is replaced with realistic-looking values that maintain the original format.

**Architecture:** Plugin uses format-specific maskers (email, token, IP, UUID, etc.) to generate deterministic, realistic-looking replacements. Each masker uses HMAC-seeded RNG for reproducibility.

**Tech Stack:** Node.js (ES Modules), native crypto, OpenCode Plugin API

**Git Workflow:**
- Feature branch: `feature/opencode-guard-impl` (created by worktree)
- Push after EACH commit: `git push origin feature/opencode-guard-impl`
- Merge to main/master ONLY after ALL tests pass

---

## Pre-Implementation Setup

### Task 0: Initialize Project Structure

**Files:**
- Create: `package.json`
- Create: `src/` directory
- Create: `src/maskers/` directory
- Create: `tests/` directory
- Create: `tests/maskers/` directory
- Create: `docs/` directory (if not exists)
- Create: `opencode-guard.config.json.example`

**Step 1: Create package.json**

```json
{
  "name": "opencode-guard",
  "version": "0.1.0",
  "description": "OpenCode plugin with format-preserving masking for privacy",
  "type": "module",
  "main": "./src/index.js",
  "exports": "./src/index.js",
  "files": [
    "src",
    "README.md",
    "README.zh-CN.md",
    "opencode-guard.config.json.example"
  ],
  "scripts": {
    "test": "node --test",
    "prepack": "npm test"
  },
  "keywords": [
    "opencode",
    "opencode-plugin",
    "privacy",
    "redaction",
    "masking",
    "format-preserving",
    "pii",
    "mcp"
  ],
  "license": "GPL-3.0-or-later",
  "engines": {
    "node": ">=18.0.0"
  }
}
```

**Step 2: Create directory structure**

```bash
mkdir -p src/maskers tests/maskers
```

**Step 3: Create config example**

```json
{
  "enabled": true,
  "debug": false,
  "global_salt": "your-secret-salt-here-change-this",
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
  "exclude_llm_endpoints": [],
  "exclude_mcp_servers": [],
  "patterns": {
    "keywords": [],
    "regex": [
      // OpenAI and variants
      { "pattern": "sk-[A-Za-z0-9]{48}", "category": "OPENAI_KEY", "mask_as": "sk_token" },
      { "pattern": "sk-proj-[A-Za-z0-9-]{48,}", "category": "OPENAI_PROJECT_KEY", "mask_as": "sk_variant_token" },
      { "pattern": "sk-or-v1-[A-Za-z0-9-]{64,}", "category": "OPENROUTER_KEY", "mask_as": "sk_variant_token" },
      { "pattern": "sk-litellm-[A-Za-z0-9]{48}", "category": "LITELLM_KEY", "mask_as": "sk_variant_token" },
      { "pattern": "sk-kimi-[A-Za-z0-9]{32}", "category": "KIMI_KEY", "mask_as": "sk_variant_token" },
      { "pattern": "sk-ant-[A-Za-z0-9]{32}", "category": "ANTHROPIC_KEY", "mask_as": "sk_variant_token" },
      
      // GitHub and AWS
      { "pattern": "(ghp|gho|ghu|ghs|ghr)_[A-Za-z0-9]+", "category": "GITHUB_TOKEN", "mask_as": "gh_token" },
      { "pattern": "AKIA[0-9A-Z]{16}", "category": "AWS_KEY", "mask_as": "aws_token" },
      { "pattern": "ASIA[0-9A-Z]{16}", "category": "AWS_KEY", "mask_as": "aws_token" },
      
      // HTTP Basic Auth
      { "pattern": "https?://[^:]+:[^@]+@[^\\s]+", "category": "BASIC_AUTH_URL", "mask_as": "basic_auth_url" },
      { "pattern": "Basic\\s+[A-Za-z0-9+/]{20,}=*", "category": "BASIC_AUTH_HEADER", "mask_as": "basic_auth_header" },
      
      // Database connection strings
      { "pattern": "(?i)(?:postgres|postgresql|mysql|mongodb|redis|amqp|mqtt|ldap)://[^:]+:[^@]+@[^\\s]+", "category": "DB_CONNECTION", "mask_as": "db_connection" },
      { "pattern": "mongodb\\+srv://[^\\s]+", "category": "DB_CONNECTION", "mask_as": "db_connection" },
      { "pattern": "DATABASE_URL\\s*=\\s*[^\\s]+", "category": "DB_ENV_VAR", "mask_as": "db_env_var" },
      { "pattern": "CONNECTION_STRING\\s*=\\s*[^\\s]+", "category": "DB_ENV_VAR", "mask_as": "db_env_var" },
      
      // Generic API key patterns (key=value style)
      { "pattern": "(?i)(?:api[_-]?key|secret[_-]?key|access[_-]?token|client[_-]?secret|auth[_-]?token|master[_-]?key|private[_-]?key|signing[_-]?key|encryption[_-]?key|database[_-]?url|connection[_-]?string|webhook[_-]?secret)\\s*[:=]\\s*\\S{8,}", "category": "GENERIC_CREDENTIAL", "mask_as": "generic_credential" },
      { "pattern": "(?i)(?:apikey|secretkey|accesstoken|clientsecret|authtoken|masterkey|privatekey|signingkey|encryptionkey|webhooksecret)\\s*[:=]\\s*\\S{8,}", "category": "GENERIC_CREDENTIAL", "mask_as": "generic_credential" },
      
      // Password patterns (basic - AI detection recommended for better accuracy)
      { "pattern": "(?i)password\\s*[:=]\\s*\\S{8,}", "category": "PASSWORD", "mask_as": "password" },
      { "pattern": "(?i)passwd\\s*[:=]\\s*\\S{8,}", "category": "PASSWORD", "mask_as": "password" },
      { "pattern": "(?i)pwd\\s*[:=]\\s*\\S{8,}", "category": "PASSWORD", "mask_as": "password" }
    ],
    "builtin": ["email", "phone", "uuid", "ipv4"],
    "exclude": ["example.com", "localhost", "127.0.0.1", "0.0.0.0"]
  },
  "custom_maskers": {
    "my_custom_token": {
      "type": "prefixed_token",
      "prefix": "myapp-",
      "suffix_length": 32,
      "suffix_chars": "alphanumeric"
    }
  }
}
```

**Note**: The `sk_variant_token` masker automatically detects and preserves any `sk-{prefix}-` pattern.

**Step 4: Commit**

```bash
git add package.json opencode-guard.config.json.example
mkdir -p src/maskers tests/maskers
git add src tests
git commit -m "chore: initialize project structure with package.json"
git push origin feature/opencode-guard-impl
```

---

## Phase 1: Core Utilities

### Task 1: Create Utility Functions

**Files:**
- Create: `src/utils.js`
- Create: `tests/utils.test.js`

**Step 1: Write the failing test**

```javascript
import { test } from 'node:test';
import assert from 'node:assert';
import { generateHmacHash, createSeededRNG, sanitizeCategory } from '../src/utils.js';

test('generateHmacHash produces deterministic output', () => {
  const salt = 'test-salt';
  const value = 'sensitive-data';
  const hash1 = generateHmacHash(salt, value);
  const hash2 = generateHmacHash(salt, value);
  assert.strictEqual(hash1, hash2);
  assert.strictEqual(hash1.length, 64);
});

test('createSeededRNG produces deterministic numbers', () => {
  const rng1 = createSeededRNG('seed-123');
  const rng2 = createSeededRNG('seed-123');
  
  assert.strictEqual(rng1(1, 100), rng2(1, 100));
  assert.strictEqual(rng1(1, 100), rng2(1, 100));
});

test('createSeededRNG produces different sequences for different seeds', () => {
  const rng1 = createSeededRNG('seed-1');
  const rng2 = createSeededRNG('seed-2');
  
  assert.notStrictEqual(rng1(1, 100), rng2(1, 100));
});

test('sanitizeCategory normalizes category names', () => {
  assert.strictEqual(sanitizeCategory('API_KEY'), 'API_KEY');
  assert.strictEqual(sanitizeCategory('api-key'), 'API_KEY');
  assert.strictEqual(sanitizeCategory('email address'), 'EMAIL_ADDRESS');
  assert.strictEqual(sanitizeCategory(''), 'TEXT');
});
```

**Step 2: Run test to verify it fails**

```bash
npm test
```

Expected: FAIL with "Cannot find module"

**Step 3: Write minimal implementation**

```javascript
import { createHmac } from 'node:crypto';

/**
 * Generate HMAC-SHA256 hash
 * @param {string} salt
 * @param {string} value
 * @returns {string} hex string
 */
export function generateHmacHash(salt, value) {
  const hmac = createHmac('sha256', salt);
  hmac.update(String(value));
  return hmac.digest('hex');
}

/**
 * Create a seeded random number generator
 * Uses xorshift128+ algorithm seeded with HMAC hash
 * @param {string} seed
 * @returns {Function} (min, max) => random integer in [min, max]
 */
export function createSeededRNG(seed) {
  // Convert seed string to 64-bit integers
  const hash = generateHmacHash('rng-seed', seed);
  let s1 = BigInt('0x' + hash.slice(0, 16));
  let s0 = BigInt('0x' + hash.slice(16, 32));
  
  // xorshift128+
  return function random(min = 0, max = 1) {
    let x = s0;
    let y = s1;
    s0 = x;
    x ^= x << BigInt(23);
    s1 = x ^ y ^ (x >> BigInt(17)) ^ (y >> BigInt(26));
    
    // Convert to number in range [min, max]
    const uint64_max = BigInt('0xFFFFFFFFFFFFFFFF');
    const normalized = Number(s1 % uint64_max) / Number(uint64_max);
    return Math.floor(normalized * (max - min + 1)) + min;
  };
}

/**
 * Sanitize category name: uppercase, replace invalid chars with underscore
 * @param {string} input
 * @returns {string}
 */
export function sanitizeCategory(input) {
  const raw = String(input ?? '').trim();
  if (!raw) return 'TEXT';
  const upper = raw.toUpperCase();
  const safe = upper.replace(/[^A-Z0-9_]/g, '_').replace(/_+/g, '_');
  if (!safe) return 'TEXT';
  return safe;
}

/**
 * Generate random string with given length and character set
 * @param {Function} rng - Seeded RNG function
 * @param {number} length
 * @param {string} chars - Character set
 * @returns {string}
 */
export function randomString(rng, length, chars) {
  let result = '';
  for (let i = 0; i < length; i++) {
    result += chars[rng(0, chars.length - 1)];
  }
  return result;
}
```

**Step 4: Run test to verify it passes**

```bash
npm test
```

Expected: PASS

**Step 5: Commit**

```bash
git add src/utils.js tests/utils.test.js
git commit -m "feat: add utility functions with seeded RNG for deterministic masking"
git push origin feature/opencode-guard-impl
```

---

## Phase 2: Masker Modules

### Task 2: Create Email Masker

**Files:**
- Create: `src/maskers/email.js`
- Create: `tests/maskers/email.test.js`

**Step 1: Write the failing test**

```javascript
import { test } from 'node:test';
import assert from 'node:assert';
import { maskEmail } from '../../src/maskers/email.js';

test('maskEmail preserves domain and masks local part', () => {
  const rng = (min, max) => 5; // fixed for testing
  const result = maskEmail('john.doe@example.com', rng);
  assert.ok(result.endsWith('@example.com'));
  assert.ok(!result.includes('john.doe'));
  assert.strictEqual(result.split('@')[0].length, 'john.doe'.length);
});

test('maskEmail handles different local part lengths', () => {
  const rng = (min, max) => min;
  assert.ok(maskEmail('a@b.com', rng).endsWith('@b.com'));
  assert.ok(maskEmail('very.long.name@domain.org', rng).endsWith('@domain.org'));
});

test('maskEmail preserves length of local part', () => {
  const rng = (min, max) => Math.floor((min + max) / 2);
  const original = 'user@example.com';
  const result = maskEmail(original, rng);
  const originalLocal = original.split('@')[0];
  const resultLocal = result.split('@')[0];
  assert.strictEqual(originalLocal.length, resultLocal.length);
});
```

**Step 2: Run test to verify it fails**

```bash
npm test
```

Expected: FAIL

**Step 3: Write minimal implementation**

```javascript
import { randomString } from '../utils.js';

const LOWERCASE = 'abcdefghijklmnopqrstuvwxyz';
const UPPERCASE = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ';
const DIGITS = '0123456789';
const SPECIAL = '._-+';

/**
 * Mask an email address while preserving format
 * @param {string} email
 * @param {Function} rng - Seeded RNG
 * @returns {string}
 */
export function maskEmail(email, rng) {
  const [localPart, domain] = email.split('@');
  if (!domain) return email; // Invalid email, return as-is
  
  // Determine character set used in local part
  let chars = LOWERCASE;
  if (/[A-Z]/.test(localPart)) chars += UPPERCASE;
  if (/[0-9]/.test(localPart)) chars += DIGITS;
  if (/[._\-+]/.test(localPart)) chars += SPECIAL;
  
  // Generate masked local part with same length
  const maskedLocal = randomString(rng, localPart.length, chars);
  
  return `${maskedLocal}@${domain}`;
}

/**
 * Check if value looks like an email
 * @param {string} value
 * @returns {boolean}
 */
export function isEmail(value) {
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value);
}
```

**Step 4: Run test to verify it passes**

```bash
npm test
```

Expected: PASS

**Step 5: Commit**

```bash
git add src/maskers/email.js tests/maskers/email.test.js
git commit -m "feat: add email masker with format preservation"
git push origin feature/opencode-guard-impl
```

---

### Task 3: Create Token Maskers (Prefix-Aware)

**Files:**
- Create: `src/maskers/token.js`
- Create: `tests/maskers/token.test.js`

**Step 1: Write the failing test**

```javascript
import { test } from 'node:test';
import assert from 'node:assert';
import { 
  maskSkToken, 
  maskSkVariantToken,
  maskGhToken, 
  maskAwsKey,
  maskGenericToken,
  detectSkPrefix
} from '../../src/maskers/token.js';

test('maskSkToken preserves sk- prefix', () => {
  const rng = (min, max) => 5;
  const result = maskSkToken('sk-abc123def456', rng);
  assert.ok(result.startsWith('sk-'));
  assert.strictEqual(result.length, 'sk-abc123def456'.length);
  assert.ok(!result.includes('abc123'));
});

test('maskSkVariantToken preserves sk-proj- prefix', () => {
  const rng = (min, max) => 5;
  const result = maskSkVariantToken('sk-proj-abc123def456', rng);
  assert.ok(result.startsWith('sk-proj-'));
  assert.strictEqual(result.length, 'sk-proj-abc123def456'.length);
  assert.ok(!result.includes('abc123'));
});

test('maskSkVariantToken preserves sk-or-v1- prefix', () => {
  const rng = (min, max) => 5;
  const result = maskSkVariantToken('sk-or-v1-abc123def456ghi789', rng);
  assert.ok(result.startsWith('sk-or-v1-'));
  assert.ok(!result.includes('abc123'));
});

test('maskSkVariantToken preserves sk-litellm- prefix', () => {
  const rng = (min, max) => 5;
  const result = maskSkVariantToken('sk-litellm-abc123def456', rng);
  assert.ok(result.startsWith('sk-litellm-'));
});

test('maskSkVariantToken preserves sk-kimi- prefix', () => {
  const rng = (min, max) => 5;
  const result = maskSkVariantToken('sk-kimi-abc123', rng);
  assert.ok(result.startsWith('sk-kimi-'));
});

test('maskSkVariantToken preserves sk-ant- prefix', () => {
  const rng = (min, max) => 5;
  const result = maskSkVariantToken('sk-ant-abc123', rng);
  assert.ok(result.startsWith('sk-ant-'));
});

test('detectSkPrefix identifies all sk- variants', () => {
  assert.strictEqual(detectSkPrefix('sk-abc123'), 'sk-');
  assert.strictEqual(detectSkPrefix('sk-proj-abc123'), 'sk-proj-');
  assert.strictEqual(detectSkPrefix('sk-or-v1-abc123'), 'sk-or-v1-');
  assert.strictEqual(detectSkPrefix('sk-litellm-abc123'), 'sk-litellm-');
  assert.strictEqual(detectSkPrefix('sk-kimi-abc123'), 'sk-kimi-');
  assert.strictEqual(detectSkPrefix('sk-ant-abc123'), 'sk-ant-');
  assert.strictEqual(detectSkPrefix('sk-custom-abc123'), 'sk-custom-');
});

test('maskGhToken preserves ghp_ prefix', () => {
  const rng = (min, max) => 5;
  const result = maskGhToken('ghp_xxxxxxxxxxxx', rng);
  assert.ok(result.startsWith('ghp_'));
  assert.strictEqual(result.length, 'ghp_xxxxxxxxxxxx'.length);
});

test('maskAwsKey preserves AKIA prefix', () => {
  const rng = (min, max) => 5;
  const result = maskAwsKey('AKIAIOSFODNN7EXAMPLE', rng);
  assert.ok(result.startsWith('AKIA'));
  assert.strictEqual(result.length, 20);
});

test('maskGenericToken preserves custom prefix', () => {
  const rng = (min, max) => 5;
  const result = maskGenericToken('prefix_12345', rng, 'prefix_');
  assert.ok(result.startsWith('prefix_'));
  assert.strictEqual(result.length, 'prefix_12345'.length);
});
```

**Step 2: Run test to verify it fails**

```bash
npm test
```

Expected: FAIL

**Step 3: Write minimal implementation**

```javascript
import { randomString } from '../utils.js';

const ALPHANUMERIC = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789';
const UPPER_ALPHANUMERIC = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789';

// Known sk- prefixes in order of specificity (longest first)
const SK_PREFIXES = [
  'sk-litellm-',
  'sk-or-v1-',
  'sk-proj-',
  'sk-kimi-',
  'sk-ant-',
  'sk-',
];

/**
 * Detect the sk- prefix from a token
 * @param {string} token
 * @returns {string} - The detected prefix or 'sk-'
 */
export function detectSkPrefix(token) {
  for (const prefix of SK_PREFIXES) {
    if (token.startsWith(prefix)) {
      return prefix;
    }
  }
  // Dynamic detection for unknown sk-{custom}- patterns
  const match = token.match(/^(sk-[a-z]+-)/);
  if (match) {
    return match[1];
  }
  return 'sk-';
}

/**
 * Mask OpenAI-style token (sk-...)
 * @param {string} token
 * @param {Function} rng
 * @returns {string}
 */
export function maskSkToken(token, rng) {
  const prefix = 'sk-';
  const suffix = token.slice(prefix.length);
  const maskedSuffix = randomString(rng, suffix.length, ALPHANUMERIC);
  return `${prefix}${maskedSuffix}`;
}

/**
 * Mask any sk- prefixed variant (sk-proj-, sk-or-v1-, sk-litellm-, sk-kimi-, sk-ant-, etc.)
 * @param {string} token
 * @param {Function} rng
 * @returns {string}
 */
export function maskSkVariantToken(token, rng) {
  const prefix = detectSkPrefix(token);
  const suffix = token.slice(prefix.length);
  const maskedSuffix = randomString(rng, suffix.length, ALPHANUMERIC);
  return `${prefix}${maskedSuffix}`;
}

/**
 * Mask GitHub token (ghp_, gho_, ghu_, ghs_, ghr_)
 * @param {string} token
 * @param {Function} rng
 * @returns {string}
 */
export function maskGhToken(token, rng) {
  const match = token.match(/^(ghp|gho|ghu|ghs|ghr)_(.+)$/);
  if (!match) return token;
  
  const [, prefix, suffix] = match;
  const maskedSuffix = randomString(rng, suffix.length, ALPHANUMERIC);
  return `${prefix}_${maskedSuffix}`;
}

/**
 * Mask AWS access key (AKIA...)
 * @param {string} key
 * @param {Function} rng
 * @returns {string}
 */
export function maskAwsKey(key, rng) {
  const prefix = 'AKIA';
  const suffix = key.slice(prefix.length);
  const maskedSuffix = randomString(rng, suffix.length, UPPER_ALPHANUMERIC);
  return `${prefix}${maskedSuffix}`;
}

/**
 * Mask generic token with custom prefix
 * @param {string} token
 * @param {Function} rng
 * @param {string} prefix
 * @returns {string}
 */
export function maskGenericToken(token, rng, prefix = '') {
  const suffix = token.slice(prefix.length);
  const maskedSuffix = randomString(rng, suffix.length, ALPHANUMERIC);
  return `${prefix}${maskedSuffix}`;
}
```

**Step 4: Run test to verify it passes**

```bash
npm test
```

Expected: PASS

**Step 5: Commit**

```bash
git add src/maskers/token.js tests/maskers/token.test.js
git commit -m "feat: add prefix-aware token maskers (sk-, sk-proj-, sk-or-v1-, sk-litellm-, sk-kimi-, sk-ant-)"
git push origin feature/opencode-guard-impl
```

---

### Task 4: Create IP Masker

**Files:**
- Create: `src/maskers/ip.js`
- Create: `tests/maskers/ip.test.js`

**Step 1: Write the failing test**

```javascript
import { test } from 'node:test';
import assert from 'node:assert';
import { maskIPv4, maskIPv6, isIPv4, isIPv6 } from '../../src/maskers/ip.js';

test('maskIPv4 keeps /16 prefix, masks host portion', () => {
  const rng = (min, max) => Math.floor((min + max) / 2);
  const result = maskIPv4('192.168.1.100', rng);
  
  // Should keep first two octets (network prefix)
  assert.ok(result.startsWith('192.168.'), `Expected to start with 192.168., got ${result}`);
  
  // Check format
  const parts = result.split('.');
  assert.strictEqual(parts.length, 4);
  
  // Check last two octets are masked (different from original)
  assert.notStrictEqual(parts[2], '1');
  assert.notStrictEqual(parts[3], '100');
  
  // Check each part is valid
  for (const part of parts) {
    const num = parseInt(part, 10);
    assert.ok(num >= 0 && num <= 255);
  }
});

test('maskIPv4 keeps private IP range intact', () => {
  const rng = (min, max) => 50;
  
  // Private ranges should stay private
  const private1 = maskIPv4('192.168.5.20', rng);
  assert.ok(private1.startsWith('192.168.'), 'Should keep 192.168.x.x private range');
  
  const private2 = maskIPv4('10.0.100.50', rng);
  assert.ok(private2.startsWith('10.0.'), 'Should keep 10.0.x.x private range');
  
  const private3 = maskIPv4('172.16.25.30', rng);
  assert.ok(private3.startsWith('172.16.'), 'Should keep 172.16.x.x private range');
});

test('maskIPv4 produces different masked hosts', () => {
  const rng1 = (min, max) => min + 10;
  const rng2 = (min, max) => max - 10;
  
  const result1 = maskIPv4('192.168.1.1', rng1);
  const result2 = maskIPv4('192.168.1.1', rng2);
  
  // Last two octets should be different
  const parts1 = result1.split('.');
  const parts2 = result2.split('.');
  assert.notStrictEqual(parts1[2], parts2[2]);
});

test('isIPv4 correctly identifies IPv4 addresses', () => {
  assert.strictEqual(isIPv4('192.168.1.1'), true);
  assert.strictEqual(isIPv4('10.0.0.1'), true);
  assert.strictEqual(isIPv4('256.1.1.1'), false);
  assert.strictEqual(isIPv4('not-an-ip'), false);
});

test('isIPv6 correctly identifies IPv6 addresses', () => {
  assert.strictEqual(isIPv6('::1'), true);
  assert.strictEqual(isIPv6('fe80::1'), true);
  assert.strictEqual(isIPv6('2001:db8::1'), true);
  assert.strictEqual(isIPv6('192.168.1.1'), false);
});

test('maskIPv6 keeps /64 prefix, masks interface ID', () => {
  const rng = (min, max) => Math.floor((min + max) / 2);
  const result = maskIPv6('2001:db8:85a3::8a2e:370:7334', rng);
  
  // Should keep first 4 groups (network prefix)
  assert.ok(result.startsWith('2001:db8:85a3:'), `Expected to keep network prefix, got ${result}`);
  
  // Interface ID should be masked
  assert.ok(!result.includes('8a2e:370:7334'), 'Should mask interface ID');
});
```

**Step 2: Run test to verify it fails**

```bash
npm test
```

Expected: FAIL

**Step 3: Write minimal implementation**

```javascript
/**
 * Mask IPv4 address - keep /16 prefix, mask host portion
 * Preserves network category (private/public) while masking host
 * @param {string} ip
 * @param {Function} rng
 * @returns {string}
 */
export function maskIPv4(ip, rng) {
  const parts = ip.split('.');
  if (parts.length !== 4) return ip;
  
  // Keep first two octets (/16 network prefix), mask last two (host)
  const maskedOctet3 = rng(0, 255);
  const maskedOctet4 = rng(1, 254);
  
  return `${parts[0]}.${parts[1]}.${maskedOctet3}.${maskedOctet4}`;
}

/**
 * Mask IPv6 address - keep /64 prefix, mask interface ID
 * Preserves network prefix while masking host identifier
 * @param {string} ip
 * @param {Function} rng
 * @returns {string}
 */
export function maskIPv6(ip, rng) {
  // Parse IPv6 and expand to 8 groups
  const expanded = expandIPv6(ip);
  const groups = expanded.split(':');
  if (groups.length !== 8) return ip;
  
  // Keep first 4 groups (/64 network prefix), mask last 4 (interface ID)
  const maskedInterfaceId = [];
  for (let i = 0; i < 4; i++) {
    const value = rng(0, 65535);
    maskedInterfaceId.push(value.toString(16).padStart(4, '0'));
  }
  
  return `${groups.slice(0, 4).join(':')}:${maskedInterfaceId.join(':')}`;
}

/**
 * Expand compressed IPv6 to full 8-group format
 * @param {string} ip
 * @returns {string}
 */
function expandIPv6(ip) {
  if (!ip.includes('::')) {
    // Already expanded or no compression
    return ip.split(':').map(g => g.padStart(4, '0')).join(':');
  }
  
  const [left, right] = ip.split('::');
  const leftGroups = left ? left.split(':') : [];
  const rightGroups = right ? right.split(':') : [];
  const missingGroups = 8 - leftGroups.length - rightGroups.length;
  
  const middleGroups = Array(missingGroups).fill('0000');
  const allGroups = [...leftGroups, ...middleGroups, ...rightGroups];
  
  return allGroups.map(g => g.padStart(4, '0')).join(':');
}

/**
 * Check if value is IPv4
 * @param {string} value
 * @returns {boolean}
 */
export function isIPv4(value) {
  const parts = value.split('.');
  if (parts.length !== 4) return false;
  
  return parts.every(part => {
    const num = parseInt(part, 10);
    return !isNaN(num) && num >= 0 && num <= 255 && String(num) === part;
  });
}

/**
 * Check if value is IPv6
 * @param {string} value
 * @returns {boolean}
 */
export function isIPv6(value) {
  // Basic IPv6 validation
  const ipv6Regex = /^([0-9a-fA-F]{1,4}:){7}[0-9a-fA-F]{1,4}$|^([0-9a-fA-F]{1,4}:){1,7}:|^([0-9a-fA-F]{1,4}:){1,6}:[0-9a-fA-F]{1,4}$|^([0-9a-fA-F]{1,4}:){1,5}(:[0-9a-fA-F]{1,4}){1,2}$|^([0-9a-fA-F]{1,4}:){1,4}(:[0-9a-fA-F]{1,4}){1,3}$|^([0-9a-fA-F]{1,4}:){1,3}(:[0-9a-fA-F]{1,4}){1,4}$|^([0-9a-fA-F]{1,4}:){1,2}(:[0-9a-fA-F]{1,4}){1,5}$|^[0-9a-fA-F]{1,4}:((:[0-9a-fA-F]{1,4}){1,6})$|^:((:[0-9a-fA-F]{1,4}){1,7}|:)$|^fe80:(:[0-9a-fA-F]{0,4}){0,4}%[0-9a-zA-Z]{1,}$|^(::([fF]{4}:)?)?((25[0-5]|2[0-4][0-9]|1[0-9][0-9]|[1-9]?[0-9])\.){3}(25[0-5]|2[0-4][0-9]|1[0-9][0-9]|[1-9]?[0-9])$|^([0-9a-fA-F]{1,4}:){1,4}:((25[0-5]|2[0-4][0-9]|1[0-9][0-9]|[1-9]?[0-9])\.){3}(25[0-5]|2[0-4][0-9]|1[0-9][0-9]|[1-9]?[0-9])$/;
  return ipv6Regex.test(value);
}
```

**Step 4: Run test to verify it passes**

```bash
npm test
```

Expected: PASS

**Step 5: Commit**

```bash
git add src/maskers/ip.js tests/maskers/ip.test.js
git commit -m "feat: add IP masker for IPv4 and IPv6"
git push origin feature/opencode-guard-impl
```

---

### Task 5: Create UUID Masker

**Files:**
- Create: `src/maskers/uuid.js`
- Create: `tests/maskers/uuid.test.js`

**Step 1: Write the failing test**

```javascript
import { test } from 'node:test';
import assert from 'node:assert';
import { maskUUID, isUUID } from '../../src/maskers/uuid.js';

test('maskUUID generates valid UUID v4', () => {
  const rng = (min, max) => Math.floor((min + max) / 2);
  const result = maskUUID('550e8400-e29b-41d4-a716-446655440000', rng);
  
  // Check format
  const uuidRegex = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
  assert.ok(uuidRegex.test(result), `Generated UUID ${result} is not valid v4`);
});

test('isUUID correctly identifies UUIDs', () => {
  assert.strictEqual(isUUID('550e8400-e29b-41d4-a716-446655440000'), true);
  assert.strictEqual(isUUID('not-a-uuid'), false);
  assert.strictEqual(isUUID(''), false);
});
```

**Step 2: Run test to verify it fails**

```bash
npm test
```

Expected: FAIL

**Step 3: Write minimal implementation**

```javascript
import { randomString } from '../utils.js';

const HEX = '0123456789abcdef';
const UUID_V4_VARIANT = '89ab'; // Valid variant for UUID v4

/**
 * Mask UUID with valid UUID v4
 * @param {string} uuid
 * @param {Function} rng
 * @returns {string}
 */
export function maskUUID(uuid, rng) {
  // UUID v4 format: xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx
  // where 4 is the version and y is 8, 9, a, or b
  
  const part1 = randomString(rng, 8, HEX);
  const part2 = randomString(rng, 4, HEX);
  const part3 = '4' + randomString(rng, 3, HEX); // Version 4
  const part4 = randomString(rng, 1, UUID_V4_VARIANT) + randomString(rng, 3, HEX);
  const part5 = randomString(rng, 12, HEX);
  
  return `${part1}-${part2}-${part3}-${part4}-${part5}`;
}

/**
 * Check if value is valid UUID
 * @param {string} value
 * @returns {boolean}
 */
export function isUUID(value) {
  const uuidRegex = /^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[1-5][0-9a-fA-F]{3}-[89abAB][0-9a-fA-F]{3}-[0-9a-fA-F]{12}$/;
  return uuidRegex.test(value);
}
```

**Step 4: Run test to verify it passes**

```bash
npm test
```

Expected: PASS

**Step 5: Commit**

```bash
git add src/maskers/uuid.js tests/maskers/uuid.test.js
git commit -m "feat: add UUID masker generating valid UUID v4"
git push origin feature/opencode-guard-impl
```

---

### Task 6: Create Generic Masker (Fallback)

**Files:**
- Create: `src/maskers/generic.js`
- Create: `tests/maskers/generic.test.js`

**Step 1: Write the failing test**

```javascript
import { test } from 'node:test';
import assert from 'node:assert';
import { maskGeneric, maskWithPattern } from '../../src/maskers/generic.js';

test('maskGeneric produces deterministic output', () => {
  const rng = (min, max) => 5;
  const result1 = maskGeneric('secret-value', 20, rng);
  const result2 = maskGeneric('secret-value', 20, rng);
  assert.strictEqual(result1, result2);
});

test('maskGeneric respects target length', () => {
  const rng = (min, max) => 5;
  const result = maskGeneric('any-value', 15, rng);
  assert.strictEqual(result.length, 15);
});

test('maskWithPattern preserves character types', () => {
  const rng = (min, max) => 2;
  // Abc123-Xyz → Xyz789-Abc (preserves uppercase, lowercase, digits, special)
  const result = maskWithPattern('Abc123-Xyz', rng);
  assert.strictEqual(result.length, 'Abc123-Xyz'.length);
  assert.ok(/[A-Z]/.test(result[0])); // First char should be uppercase
  assert.ok(/[a-z]/.test(result[1])); // Second char should be lowercase
  assert.ok(/[0-9]/.test(result[3])); // Should have digits
  assert.ok(result.includes('-')); // Should preserve hyphen
});
```

**Step 2: Run test to verify it fails**

```bash
npm test
```

Expected: FAIL

**Step 3: Write minimal implementation**

```javascript
import { randomString } from '../utils.js';

const LOWERCASE = 'abcdefghijklmnopqrstuvwxyz';
const UPPERCASE = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ';
const DIGITS = '0123456789';
const ALPHANUMERIC = LOWERCASE + UPPERCASE + DIGITS;

/**
 * Generic masker with fixed length
 * @param {string} value - Original value (ignored, just for seeding)
 * @param {number} length - Target length
 * @param {Function} rng
 * @param {string} prefix - Optional prefix
 * @returns {string}
 */
export function maskGeneric(value, length, rng, prefix = 'masked_') {
  const targetLength = Math.max(length - prefix.length, 8);
  const masked = randomString(rng, targetLength, ALPHANUMERIC);
  return `${prefix}${masked}`;
}

/**
 * Mask while preserving character pattern (uppercase stays uppercase, etc.)
 * @param {string} value
 * @param {Function} rng
 * @returns {string}
 */
export function maskWithPattern(value, rng) {
  return Array.from(value).map(char => {
    if (/[a-z]/.test(char)) {
      return randomString(rng, 1, LOWERCASE);
    } else if (/[A-Z]/.test(char)) {
      return randomString(rng, 1, UPPERCASE);
    } else if (/[0-9]/.test(char)) {
      return randomString(rng, 1, DIGITS);
    } else {
      // Preserve special characters as-is
      return char;
    }
  }).join('');
}
```

**Step 4: Run test to verify it passes**

```bash
npm test
```

Expected: PASS

**Step 5: Commit**

```bash
git add src/maskers/generic.js tests/maskers/generic.test.js
git commit -m "feat: add generic masker as fallback"
git push origin feature/opencode-guard-impl
```

---

### Task 6.1: Create HTTP Basic Auth Masker

**Files:**
- Create: `src/maskers/auth.js`
- Create: `tests/maskers/auth.test.js`

**Step 1: Write the failing test**

```javascript
import { test } from 'node:test';
import assert from 'node:assert';
import { maskBasicAuthUrl, maskBasicAuthHeader } from '../../src/maskers/auth.js';

test('maskBasicAuthUrl masks both user and password in URL', () => {
  const rng = (min, max) => 5;
  const result = maskBasicAuthUrl('https://user:secret123@api.example.com/path', rng);
  assert.ok(result.startsWith('https://'));
  assert.ok(result.includes(':****@api.example.com'));
  assert.ok(!result.includes('user'));
  assert.ok(!result.includes('secret123'));
});

test('maskBasicAuthUrl handles http URLs', () => {
  const rng = (min, max) => 5;
  const result = maskBasicAuthUrl('http://admin:password@localhost:8080', rng);
  assert.ok(result.startsWith('http://'));
  assert.ok(!result.includes('admin'));
  assert.ok(!result.includes('password'));
});

test('maskBasicAuthHeader masks base64 credential', () => {
  const rng = (min, max) => 5;
  const result = maskBasicAuthHeader('Basic dXNlcjpwYXNzd29yZA==', rng);
  assert.ok(result.startsWith('Basic '));
  assert.ok(!result.includes('dXNlcjpwYXNzd29yZA=='));
});

test('maskBasicAuthHeader handles different lengths', () => {
  const rng = (min, max) => 5;
  const longCredential = 'Basic ' + 'a'.repeat(100);
  const result = maskBasicAuthHeader(longCredential, rng);
  assert.strictEqual(result.startsWith('Basic '), true);
});
```

**Step 2: Run test to verify it fails**

```bash
npm test
```

Expected: FAIL

**Step 3: Write minimal implementation**

```javascript
import { randomString } from '../utils.js';

const ALPHANUMERIC = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789';

/**
 * Mask user and password in HTTP Basic Auth URL
 * @param {string} url
 * @param {Function} rng
 * @returns {string}
 */
export function maskBasicAuthUrl(url, rng) {
  // Match protocol://username:password@host pattern
  const match = url.match(/^(https?:\/\/)([^:]+):([^@]+)@(.+)$/);
  if (!match) return url;
  
  const [, protocol, username, password, rest] = match;
  // Generate masked username and password
  const maskedUsername = '*'.repeat(Math.min(username.length, 8)) || '****';
  const maskedPassword = '*'.repeat(Math.min(password.length, 16)) || '****';
  
  return `${protocol}${maskedUsername}:${maskedPassword}@${rest}`;
}

/**
 * Mask Basic auth header value
 * @param {string} header
 * @param {Function} rng
 * @returns {string}
 */
export function maskBasicAuthHeader(header, rng) {
  const match = header.match(/^(Basic\s+)(.+)$/);
  if (!match) return header;
  
  const [, prefix, credential] = match;
  // Replace credential with masked version
  const maskedLength = Math.min(credential.length, 16);
  const masked = randomString(rng, maskedLength, ALPHANUMERIC);
  
  return `${prefix}${masked}`;
}
```

**Step 4: Run test to verify it passes**

```bash
npm test
```

Expected: PASS

**Step 5: Commit**

```bash
git add src/maskers/auth.js tests/maskers/auth.test.js
git commit -m "feat: add HTTP Basic Auth masker for URLs and headers"
git push origin feature/opencode-guard-impl
```

---

### Task 6.2: Create Database Connection Masker

**Files:**
- Create: `src/maskers/database.js`
- Create: `tests/maskers/database.test.js`

**Step 1: Write the failing test**

```javascript
import { test } from 'node:test';
import assert from 'node:assert';
import { maskDatabaseUrl, maskEnvVar } from '../../src/maskers/database.js';

test('maskDatabaseUrl masks both user and password in postgres URL', () => {
  const rng = (min, max) => 5;
  const result = maskDatabaseUrl('postgres://user:secret123@localhost:5432/mydb', rng);
  assert.ok(result.includes('postgres://'));
  assert.ok(result.includes(':****@localhost:5432/mydb'));
  assert.ok(!result.includes('user'));
  assert.ok(!result.includes('secret123'));
});

test('maskDatabaseUrl handles mysql URLs', () => {
  const rng = (min, max) => 5;
  const result = maskDatabaseUrl('mysql://admin:password@db.example.com:3306/production', rng);
  assert.ok(result.includes('mysql://'));
  assert.ok(!result.includes('admin'));
  assert.ok(!result.includes('password'));
});

test('maskDatabaseUrl handles mongodb URLs', () => {
  const rng = (min, max) => 5;
  const result = maskDatabaseUrl('mongodb://user:pass@cluster0.mongodb.net/database', rng);
  assert.ok(result.includes('mongodb://'));
  assert.ok(!result.includes('user'));
  assert.ok(!result.includes('pass'));
});

test('maskDatabaseUrl handles mongodb+srv', () => {
  const rng = (min, max) => 5;
  const result = maskDatabaseUrl('mongodb+srv://user:secret@cluster.mongodb.net', rng);
  assert.ok(result.includes('mongodb+srv://'));
  assert.ok(!result.includes('user'));
  assert.ok(!result.includes('secret'));
});

test('maskEnvVar masks DATABASE_URL', () => {
  const rng = (min, max) => 5;
  const result = maskEnvVar('DATABASE_URL=postgres://u:p@host/db', rng);
  assert.ok(result.startsWith('DATABASE_URL='));
  assert.ok(!result.includes('p@host'));
});

test('maskEnvVar masks CONNECTION_STRING', () => {
  const rng = (min, max) => 5;
  const result = maskEnvVar('CONNECTION_STRING=Server=myServer;Pwd=secret;', rng);
  assert.ok(result.startsWith('CONNECTION_STRING='));
  assert.ok(!result.includes('secret'));
});
```

**Step 2: Run test to verify it fails**

```bash
npm test
```

Expected: FAIL

**Step 3: Write minimal implementation**

```javascript
/**
 * Mask user and password in database connection URL
 * @param {string} url
 * @param {Function} rng
 * @returns {string}
 */
export function maskDatabaseUrl(url, rng) {
  // Match protocol://username:password@host pattern
  // Handles: postgres, postgresql, mysql, mongodb, redis, amqp, mqtt, ldap
  const match = url.match(/^([a-z+]+:\/\/)([^:]+):([^@]+)@(.+)$/i);
  if (!match) return url;
  
  const [, protocol, username, password, rest] = match;
  // Generate masked username and password
  const maskedUsername = '*'.repeat(Math.min(username.length, 8)) || '****';
  const maskedPassword = '*'.repeat(Math.min(password.length, 16)) || '****';
  
  return `${protocol}${maskedUsername}:${maskedPassword}@${rest}`;
}

/**
 * Mask environment variable with connection string
 * @param {string} envVar
 * @param {Function} rng
 * @returns {string}
 */
export function maskEnvVar(envVar, rng) {
  const match = envVar.match(/^([A-Z_]+URL|CONNECTION_STRING)\s*=\s*(.+)$/i);
  if (!match) return envVar;
  
  const [, varName, value] = match;
  
  // Check if value looks like a URL
  if (value.includes('://')) {
    const maskedValue = maskDatabaseUrl(value, rng);
    return `${varName}=${maskedValue}`;
  }
  
  // For non-URL values, mask the whole thing
  return `${varName}=********`;
}
```

**Step 4: Run test to verify it passes**

```bash
npm test
```

Expected: PASS

**Step 5: Commit**

```bash
git add src/maskers/database.js tests/maskers/database.test.js
git commit -m "feat: add database connection string masker"
git push origin feature/opencode-guard-impl
```

---

### Task 6.3: Create Generic Credential & Password Masker

**Files:**
- Create: `src/maskers/credential.js`
- Create: `tests/maskers/credential.test.js`

**Step 1: Write the failing test**

```javascript
import { test } from 'node:test';
import assert from 'node:assert';
import { maskGenericCredential, maskPassword, maskUsername } from '../../src/maskers/credential.js';

test('maskGenericCredential masks API_KEY=value', () => {
  const rng = (min, max) => 5;
  const result = maskGenericCredential('API_KEY=secret123', rng);
  assert.ok(result.startsWith('API_KEY='));
  assert.ok(!result.includes('secret123'));
});

test('maskGenericCredential handles colon separator', () => {
  const rng = (min, max) => 5;
  const result = maskGenericCredential('api_key: secret123', rng);
  assert.ok(result.includes('api_key:'));
  assert.ok(!result.includes('secret123'));
});

test('maskGenericCredential handles various key names', () => {
  const rng = (min, max) => 5;
  assert.ok(maskGenericCredential('secret_key=val', rng).includes('secret_key='));
  assert.ok(maskGenericCredential('access_token=val', rng).includes('access_token='));
  assert.ok(maskGenericCredential('client_secret=val', rng).includes('client_secret='));
});

test('maskPassword masks password= value', () => {
  const rng = (min, max) => 5;
  const result = maskPassword('password=secret123', rng);
  assert.ok(result.startsWith('password='));
  assert.ok(!result.includes('secret123'));
});

test('maskPassword handles passwd and pwd variants', () => {
  const rng = (min, max) => 5;
  const result1 = maskPassword('passwd=secret', rng);
  const result2 = maskPassword('pwd=secret', rng);
  assert.ok(result1.startsWith('passwd='));
  assert.ok(result2.startsWith('pwd='));
  assert.ok(!result1.includes('secret'));
  assert.ok(!result2.includes('secret'));
});

test('maskUsername masks username= value', () => {
  const rng = (min, max) => 5;
  const result = maskUsername('username=admin', rng);
  assert.ok(result.startsWith('username='));
  assert.ok(!result.includes('admin'));
});

test('maskUsername handles user= variant', () => {
  const rng = (min, max) => 5;
  const result = maskUsername('user=john', rng);
  assert.ok(result.startsWith('user='));
  assert.ok(!result.includes('john'));
});

test('maskUsername handles colon separator', () => {
  const rng = (min, max) => 5;
  const result = maskUsername('username: admin', rng);
  assert.ok(result.includes('username:'));
  assert.ok(!result.includes('admin'));
});
```

**Step 2: Run test to verify it fails**

```bash
npm test
```

Expected: FAIL

**Step 3: Write minimal implementation**

```javascript
/**
 * Mask generic key=value or key:value credential patterns
 * @param {string} text
 * @param {Function} rng
 * @returns {string}
 */
export function maskGenericCredential(text, rng) {
  // Match common credential patterns: KEY=value or KEY: value
  const patterns = [
    /^(api[_-]?key|secret[_-]?key|access[_-]?token|client[_-]?secret|auth[_-]?token|master[_-]?key|private[_-]?key|signing[_-]?key|encryption[_-]?key|webhook[_-]?secret|database[_-]?url|connection[_-]?string)(\s*[:=]\s*)(\S+)$/i,
    /^(apikey|secretkey|accesstoken|clientsecret|authtoken|masterkey|privatekey|signingkey|encryptionkey|webhooksecret)(\s*[:=]\s*)(\S+)$/i,
  ];
  
  for (const pattern of patterns) {
    const match = text.match(pattern);
    if (match) {
      const [, key, separator, value] = match;
      const maskedValue = '*'.repeat(Math.min(value.length, 16)) || '****';
      return `${key}${separator}${maskedValue}`;
    }
  }
  
  return text;
}

/**
 * Mask password patterns
 * @param {string} text
 * @param {Function} rng
 * @returns {string}
 */
export function maskPassword(text, rng) {
  // Match password, passwd, pwd patterns
  const pattern = /^(password|passwd|pwd|pass)(\s*[:=]\s*)(\S+)$/i;
  const match = text.match(pattern);
  
  if (match) {
    const [, key, separator, value] = match;
    const maskedValue = '*'.repeat(Math.min(value.length, 16)) || '****';
    return `${key}${separator}${maskedValue}`;
  }
  
  return text;
}

/**
 * Mask username patterns
 * @param {string} text
 * @param {Function} rng
 * @returns {string}
 */
export function maskUsername(text, rng) {
  // Match username, user patterns
  const pattern = /^(username|user)(\s*[:=]\s*)(\S+)$/i;
  const match = text.match(pattern);
  
  if (match) {
    const [, key, separator, value] = match;
    const maskedValue = '*'.repeat(Math.min(value.length, 8)) || '****';
    return `${key}${separator}${maskedValue}`;
  }
  
  return text;
}
```

**Step 4: Run test to verify it passes**

```bash
npm test
```

Expected: PASS

**Step 5: Commit**

```bash
git add src/maskers/credential.js tests/maskers/credential.test.js
git commit -m "feat: add generic credential, password, and username maskers"
git push origin feature/opencode-guard-impl
```

---

### Task 7: Create Extensible Pattern System

**Files:**
- Create: `src/maskers/custom.js`
- Create: `tests/maskers/custom.test.js`

**Step 1: Write the failing test**

```javascript
import { test } from 'node:test';
import assert from 'node:assert';
import { createCustomMasker, CustomMaskerRegistry } from '../../src/maskers/custom.js';

test('createCustomMasker handles prefixed_token type', () => {
  const rng = (min, max) => 5;
  const masker = createCustomMasker({
    type: 'prefixed_token',
    prefix: 'myapp-',
    suffix_length: 10,
    suffix_chars: 'alphanumeric'
  });
  
  const result = masker('myapp-secret123', rng);
  assert.ok(result.startsWith('myapp-'));
  assert.strictEqual(result.length, 'myapp-secret123'.length);
});

test('createCustomMasker handles pattern_preserving type', () => {
  const rng = (min, max) => 5;
  const masker = createCustomMasker({
    type: 'pattern_preserving',
    char_sets: { uppercase: true, lowercase: true, digits: true }
  });
  
  const result = masker('AbC123', rng);
  assert.strictEqual(result.length, 6);
  assert.ok(/[A-Z]/.test(result[0])); // First char uppercase
  assert.ok(/[a-z]/.test(result[1])); // Second char lowercase
  assert.ok(/[0-9]/.test(result[3])); // Has digits
});

test('createCustomMasker handles fixed_length type', () => {
  const rng = (min, max) => 5;
  const masker = createCustomMasker({
    type: 'fixed_length',
    length: 20,
    chars: 'alphanumeric',
    prefix: 'tk_'
  });
  
  const result = masker('anything', rng);
  assert.ok(result.startsWith('tk_'));
  assert.strictEqual(result.length, 20);
});

test('CustomMaskerRegistry loads maskers from config', () => {
  const registry = new CustomMaskerRegistry();
  const config = {
    my_token: { type: 'prefixed_token', prefix: 'app-', suffix_length: 16 }
  };
  
  registry.loadFromConfig(config);
  const masker = registry.get('my_token');
  
  assert.ok(typeof masker === 'function');
});
```

**Step 2: Run test to verify it fails**

```bash
npm test
```

Expected: FAIL

**Step 3: Write minimal implementation**

```javascript
import { randomString } from '../utils.js';

const CHAR_SETS = {
  alphanumeric: 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789',
  numeric: '0123456789',
  hex: '0123456789abcdef',
  hex_upper: '0123456789ABCDEF',
  alpha: 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz',
  lower: 'abcdefghijklmnopqrstuvwxyz',
  upper: 'ABCDEFGHIJKLMNOPQRSTUVWXYZ',
};

/**
 * Create a custom masker from config
 * @param {Object} config
 * @returns {Function} - (value, rng) => maskedValue
 */
export function createCustomMasker(config) {
  const type = config?.type || 'pattern_preserving';
  
  switch (type) {
    case 'prefixed_token':
      return createPrefixedTokenMasker(config);
    case 'pattern_preserving':
      return createPatternPreservingMasker(config);
    case 'fixed_length':
      return createFixedLengthMasker(config);
    default:
      throw new Error(`Unknown custom masker type: ${type}`);
  }
}

function createPrefixedTokenMasker(config) {
  const prefix = config.prefix || '';
  const suffixLength = config.suffix_length || 16;
  const suffixChars = CHAR_SETS[config.suffix_chars] || CHAR_SETS.alphanumeric;
  
  return (value, rng) => {
    const suffix = randomString(rng, suffixLength, suffixChars);
    return `${prefix}${suffix}`;
  };
}

function createPatternPreservingMasker(config) {
  const charSets = config.char_sets || { uppercase: true, lowercase: true, digits: true };
  
  const getCharSet = (char) => {
    if (/[a-z]/.test(char) && charSets.lowercase) return CHAR_SETS.lower;
    if (/[A-Z]/.test(char) && charSets.uppercase) return CHAR_SETS.upper;
    if (/[0-9]/.test(char) && charSets.digits) return CHAR_SETS.numeric;
    if (charSets.special && charSets.special.includes(char)) return charSets.special;
    return CHAR_SETS.alphanumeric;
  };
  
  return (value, rng) => {
    return Array.from(value).map(char => {
      const charSet = getCharSet(char);
      return randomString(rng, 1, charSet);
    }).join('');
  };
}

function createFixedLengthMasker(config) {
  const length = config.length || 16;
  const prefix = config.prefix || '';
  const chars = CHAR_SETS[config.chars] || CHAR_SETS.alphanumeric;
  const suffixLength = Math.max(0, length - prefix.length);
  
  return (value, rng) => {
    const suffix = randomString(rng, suffixLength, chars);
    return `${prefix}${suffix}`;
  };
}

/**
 * Registry for custom maskers loaded from config
 */
export class CustomMaskerRegistry {
  constructor() {
    this.maskers = new Map();
  }
  
  /**
   * Load custom maskers from config
   * @param {Object} config - custom_maskers section from config
   */
  loadFromConfig(config) {
    if (!config || typeof config !== 'object') return;
    
    for (const [name, maskerConfig] of Object.entries(config)) {
      try {
        this.maskers.set(name, createCustomMasker(maskerConfig));
      } catch (err) {
        console.warn(`[opencode-guard] Failed to load custom masker '${name}': ${err.message}`);
      }
    }
  }
  
  /**
   * Get a custom masker by name
   * @param {string} name
   * @returns {Function|null}
   */
  get(name) {
    return this.maskers.get(name) || null;
  }
  
  /**
   * Check if a custom masker exists
   * @param {string} name
   * @returns {boolean}
   */
  has(name) {
    return this.maskers.has(name);
  }
}
```

**Step 4: Run test to verify it passes**

```bash
npm test
```

Expected: PASS

**Step 5: Commit**

```bash
git add src/maskers/custom.js tests/maskers/custom.test.js
git commit -m "feat: add extensible custom masker system"
git push origin feature/opencode-guard-impl
```

---

### Task 8: Create Masker Registry

**Files:**
- Create: `src/maskers/index.js`

**Step 1: Write the implementation**

```javascript
import { createSeededRNG } from '../utils.js';
import { maskEmail, isEmail } from './email.js';
import { maskSkToken, maskSkVariantToken, maskGhToken, maskAwsKey, maskGenericToken } from './token.js';
import { maskIPv4, maskIPv6, isIPv4, isIPv6 } from './ip.js';
import { maskUUID, isUUID } from './uuid.js';
import { maskGeneric, maskWithPattern } from './generic.js';
import { maskBasicAuthUrl, maskBasicAuthHeader } from './auth.js';
import { maskDatabaseUrl, maskEnvVar } from './database.js';
import { maskGenericCredential, maskPassword } from './credential.js';
import { CustomMaskerRegistry } from './custom.js';

// Global custom masker registry
const customRegistry = new CustomMaskerRegistry();

/**
 * Mask a value based on its detected type
 * @param {string} value - Original sensitive value
 * @param {string} category - Category/type of the value
 * @param {string} maskAs - Specific masker to use (optional)
 * @param {string} globalSalt - Global salt for seeding
 * @returns {string} - Masked value
 */
/**
 * Initialize custom maskers from config
 * @param {Object} customMaskersConfig
 */
export function initializeCustomMaskers(customMaskersConfig) {
  customRegistry.loadFromConfig(customMaskersConfig);
}

export function maskValue(value, category, maskAs, globalSalt) {
  // Create seeded RNG for deterministic output
  const seed = `${globalSalt}:${value}:${category}`;
  const rng = createSeededRNG(seed);
  
  // Check if this is a custom masker first
  if (maskAs && customRegistry.has(maskAs)) {
    const customMasker = customRegistry.get(maskAs);
    return customMasker(value, rng);
  }
  
  // Use specific masker if specified
  switch (maskAs) {
    case 'email':
      return maskEmail(value, rng);
    case 'sk_token':
      return maskSkToken(value, rng);
    case 'sk_variant_token':
      return maskSkVariantToken(value, rng);
    case 'gh_token':
      return maskGhToken(value, rng);
    case 'aws_token':
      return maskAwsKey(value, rng);
    case 'ipv4':
      return maskIPv4(value, rng);
    case 'ipv6':
      return maskIPv6(value, rng);
    case 'uuid':
      return maskUUID(value, rng);
    case 'pattern':
      return maskWithPattern(value, rng);
    case 'basic_auth_url':
      return maskBasicAuthUrl(value, rng);
    case 'basic_auth_header':
      return maskBasicAuthHeader(value, rng);
    case 'db_connection':
      return maskDatabaseUrl(value, rng);
    case 'db_env_var':
      return maskEnvVar(value, rng);
    case 'generic_credential':
      return maskGenericCredential(value, rng);
    case 'password':
      return maskPassword(value, rng);
    default:
      // Auto-detect based on value content
      if (isEmail(value)) {
        return maskEmail(value, rng);
      } else if (isIPv4(value)) {
        return maskIPv4(value, rng);
      } else if (isIPv6(value)) {
        return maskIPv6(value, rng);
      } else if (isUUID(value)) {
        return maskUUID(value, rng);
      } else if (value.startsWith('sk-')) {
        return maskSkVariantToken(value, rng);
      } else if (value.startsWith('gh')) {
        return maskGhToken(value, rng);
      } else {
        // Default: pattern-preserving mask
        return maskWithPattern(value, rng);
      }
  }
}

/**
 * Get the appropriate masker function for a category
 * @param {string} category
 * @returns {Function|null}
 */
export function getMaskerForCategory(category) {
  const cat = category.toUpperCase();
  
  if (cat.includes('EMAIL')) return maskEmail;
  if (cat.includes('OPENAI') || cat.includes('SK_TOKEN')) return maskSkToken;
  if (cat.includes('VARIANT') || cat.includes('PROJECT') || cat.includes('ROUTER') || cat.includes('LITELLM') || cat.includes('KIMI') || cat.includes('ANTHROPIC')) return maskSkVariantToken;
  if (cat.includes('GITHUB') || cat.includes('GH_TOKEN')) return maskGhToken;
  if (cat.includes('AWS')) return maskAwsKey;
  if (cat.includes('IPV4')) return maskIPv4;
  if (cat.includes('IPV6')) return maskIPv6;
  if (cat.includes('UUID')) return maskUUID;
  
  return null; // Use default
}

// Re-export all maskers
export {
  maskEmail,
  maskSkToken,
  maskSkVariantToken,
  maskGhToken,
  maskAwsKey,
  maskIPv4,
  maskIPv6,
  maskUUID,
  maskGeneric,
  maskWithPattern,
  initializeCustomMaskers,
  CustomMaskerRegistry,
};
```

**Step 2: Commit**

```bash
git add src/maskers/index.js
git commit -m "feat: add masker registry for dispatching to correct masker"
git push origin feature/opencode-guard-impl
```

---

## Phase 3: Configuration & Patterns

### Task 8: Create Config Loader

**Files:**
- Create: `src/config.js`
- Create: `tests/config.test.js`

**Step 1: Write implementation (adapted from original plan)**

```javascript
import { readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { existsSync } from 'node:fs';
import { homedir } from 'node:os';

export function parseDuration(duration) {
  if (typeof duration === 'number') return duration;
  const str = String(duration).trim();
  const match = str.match(/^(\d+)\s*([hms]?)$/i);
  if (!match) return parseInt(str, 10) || 3600000;
  const value = parseInt(match[1], 10);
  const unit = match[2].toLowerCase();
  switch (unit) {
    case 'h': return value * 60 * 60 * 1000;
    case 'm': return value * 60 * 1000;
    case 's': return value * 1000;
    default: return value;
  }
}

async function findConfigFile(projectRoot) {
  const envPath = process.env.OPENCODE_GUARD_CONFIG;
  if (envPath && existsSync(envPath)) {
    try {
      const content = JSON.parse(await readFile(envPath, 'utf-8'));
      return { path: envPath, content };
    } catch { }
  }

  const locations = [
    join(projectRoot, 'opencode-guard.config.json'),
    join(projectRoot, '.opencode', 'opencode-guard.config.json'),
    join(homedir(), '.config', 'opencode', 'opencode-guard.config.json'),
  ];

  for (const path of locations) {
    if (existsSync(path)) {
      try {
        const content = JSON.parse(await readFile(path, 'utf-8'));
        return { path, content };
      } catch { }
    }
  }

  return null;
}

export async function loadConfig(projectRoot) {
  const found = await findConfigFile(projectRoot);
  
  if (!found) {
    return { enabled: false, debug: false, loadedFrom: null };
  }

  const raw = found.content;
  
  return {
    enabled: Boolean(raw.enabled),
    debug: Boolean(raw.debug),
    loadedFrom: found.path,
    globalSalt: String(raw.global_salt || ''),
    ttlMs: parseDuration(raw.session_ttl || '1h'),
    maxMappings: Number(raw.max_mappings || 100000),
    masking: {
      formatPreserving: Boolean(raw.masking?.format_preserving ?? true),
      preserveDomains: Boolean(raw.masking?.preserve_domains ?? true),
      preservePrefixes: Boolean(raw.masking?.preserve_prefixes ?? true),
    },
    detection: {
      parallel: Boolean(raw.detection?.parallel ?? true),
      aiDetection: Boolean(raw.detection?.ai_detection ?? false),
      aiProvider: String(raw.detection?.ai_provider || 'local'),
      aiTimeoutMs: Number(raw.detection?.ai_timeout_ms || 500),
    },
    excludeLlmEndpoints: Array.isArray(raw.exclude_llm_endpoints) ? raw.exclude_llm_endpoints : [],
    excludeMcpServers: Array.isArray(raw.exclude_mcp_servers) ? raw.exclude_mcp_servers : [],
    patterns: raw.patterns || {},
    customMaskers: raw.custom_maskers || {},
  };
}
```

**Step 2: Commit**

```bash
git add src/config.js tests/config.test.js
git commit -m "feat: add config loader with format-preserving options"
git push origin feature/opencode-guard-impl
```

---

### Task 9: Create Pattern Builder

**Files:**
- Create: `src/patterns.js`
- Create: `tests/patterns.test.js`

**Step 1: Write implementation**

```javascript
import { sanitizeCategory } from './utils.js';

const BUILTIN = new Map([
  ['email', { pattern: String.raw`[a-z0-9._%+-]+@[a-z0-9.-]+\.[a-z]{2,}`, flags: 'i', category: 'EMAIL', maskAs: 'email' }],
  ['phone', { pattern: String.raw`(?<!\d)1[3-9]\d{9}(?!\d)`, flags: '', category: 'PHONE', maskAs: 'pattern' }],
  ['china_phone', { pattern: String.raw`(?<!\d)1[3-9]\d{9}(?!\d)`, flags: '', category: 'CHINA_PHONE', maskAs: 'pattern' }],
  ['china_id', { pattern: String.raw`(?<!\d)\d{17}[\dXx](?!\d)`, flags: '', category: 'CHINA_ID', maskAs: 'pattern' }],
  ['uuid', { pattern: String.raw`[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[1-5][0-9a-fA-F]{3}-[89abAB][0-9a-fA-F]{3}-[0-9a-fA-F]{12}`, flags: '', category: 'UUID', maskAs: 'uuid' }],
  ['ipv4', { pattern: String.raw`(?:\d{1,3}\.){3}\d{1,3}`, flags: '', category: 'IPV4', maskAs: 'ipv4' }],
  ['mac', { pattern: String.raw`(?:[0-9a-f]{2}:){5}[0-9a-f]{2}`, flags: 'i', category: 'MAC', maskAs: 'pattern' }],
  ['basic_auth_url', { pattern: String.raw`https?:\/\/[^:]+:[^@]+@[^\s]+`, flags: 'i', category: 'BASIC_AUTH_URL', maskAs: 'basic_auth_url' }],
  ['basic_auth_header', { pattern: String.raw`Basic\s+[A-Za-z0-9+/]{20,}=*`, flags: 'i', category: 'BASIC_AUTH_HEADER', maskAs: 'basic_auth_header' }],
  ['db_connection', { pattern: String.raw`(?:postgres|postgresql|mysql|mongodb|redis|amqp|mqtt|ldap):\/\/[^:]+:[^@]+@[^\s]+`, flags: 'i', category: 'DB_CONNECTION', maskAs: 'db_connection' }],
  ['db_connection_srv', { pattern: String.raw`mongodb\+srv:\/\/[^\s]+`, flags: 'i', category: 'DB_CONNECTION', maskAs: 'db_connection' }],
  ['generic_credential', { pattern: String.raw`(?:api[_-]?key|secret[_-]?key|access[_-]?token|client[_-]?secret|auth[_-]?token|master[_-]?key|private[_-]?key|signing[_-]?key|encryption[_-]?key|webhook[_-]?secret|database[_-]?url|connection[_-]?string)\s*[:=]\s*\S{8,}`, flags: 'i', category: 'GENERIC_CREDENTIAL', maskAs: 'generic_credential' }],
  ['password', { pattern: String.raw`(?:password|passwd|pwd)\s*[:=]\s*\S{8,}`, flags: 'i', category: 'PASSWORD', maskAs: 'password' }],
]);

export function buildPatternSet(patterns) {
  const raw = patterns && typeof patterns === 'object' ? patterns : {};
  
  const keywords = (raw.keywords || [])
    .map(k => {
      if (!k || typeof k !== 'object') return null;
      const value = String(k.value ?? '').trim();
      if (!value) return null;
      return {
        value,
        category: sanitizeCategory(k.category),
        maskAs: k.mask_as || 'pattern',
      };
    })
    .filter(Boolean);
  
  const regex = [];
  
  for (const r of (raw.regex || [])) {
    if (!r || typeof r !== 'object') continue;
    const pattern = String(r.pattern ?? '').trim();
    if (!pattern) continue;
    try {
      const flags = String(r.flags || '');
      regex.push({
        regex: new RegExp(pattern, flags.includes('g') ? flags : flags + 'g'),
        category: sanitizeCategory(r.category),
        maskAs: r.mask_as || 'pattern',
        pattern,
        flags,
      });
    } catch { }
  }
  
  for (const name of (raw.builtin || [])) {
    const builtin = BUILTIN.get(String(name).trim());
    if (builtin) {
      regex.push({
        regex: new RegExp(builtin.pattern, builtin.flags),
        category: builtin.category,
        maskAs: builtin.maskAs,
        pattern: builtin.pattern,
        flags: builtin.flags,
      });
    }
  }
  
  const exclude = new Set((raw.exclude || []).map(e => String(e)));
  
  return { keywords, regex, exclude };
}
```

**Step 2: Commit**

```bash
git add src/patterns.js tests/patterns.test.js
git commit -m "feat: add pattern builder with mask_as support"
git push origin feature/opencode-guard-impl
```

---

## Phase 4: Session & Detection

### Task 10: Create Session Manager

**Files:**
- Create: `src/session.js`
- Create: `tests/session.test.js`

**Step 1: Write implementation**

```javascript
import { maskValue } from './maskers/index.js';

export class MaskSession {
  constructor(globalSalt, options) {
    this.globalSalt = globalSalt;
    this.ttlMs = options.ttlMs;
    this.maxMappings = options.maxMappings;
    
    this.originalToMasked = new Map();
    this.maskedToOriginal = new Map();
    this.timestamps = new Map();
  }
  
  cleanup(now = Date.now()) {
    for (const [masked, createdAt] of this.timestamps) {
      if (now - createdAt > this.ttlMs) {
        const original = this.maskedToOriginal.get(masked);
        this.maskedToOriginal.delete(masked);
        this.timestamps.delete(masked);
        if (original) this.originalToMasked.delete(original);
      }
    }
  }
  
  evictOldest() {
    let oldestMasked = '';
    let oldestTime = Infinity;
    for (const [masked, createdAt] of this.timestamps) {
      if (createdAt < oldestTime) {
        oldestTime = createdAt;
        oldestMasked = masked;
      }
    }
    if (oldestMasked) {
      const original = this.maskedToOriginal.get(oldestMasked);
      this.maskedToOriginal.delete(oldestMasked);
      this.timestamps.delete(oldestMasked);
      if (original) this.originalToMasked.delete(original);
    }
  }
  
  getOrCreateMasked(original, category, maskAs) {
    const existing = this.originalToMasked.get(original);
    if (existing) return existing;
    
    this.cleanup();
    while (this.originalToMasked.size >= this.maxMappings) {
      this.evictOldest();
    }
    
    const masked = maskValue(original, category, maskAs, this.globalSalt);
    
    this.originalToMasked.set(original, masked);
    this.maskedToOriginal.set(masked, original);
    this.timestamps.set(masked, Date.now());
    
    return masked;
  }
  
  lookupOriginal(masked) {
    return this.maskedToOriginal.get(masked);
  }
}
```

**Step 2: Commit**

```bash
git add src/session.js tests/session.test.js
git commit -m "feat: add session manager for format-preserving masking"
git push origin feature/opencode-guard-impl
```

---

### Task 11: Create Streaming Unmasker

**Files:**
- Create: `src/streaming-unmasker.js`
- Create: `tests/streaming-unmasker.test.js`

**Step 1: Write implementation**

```javascript
/**
 * StreamingUnmasker handles unmasking of masked values that may span
 * multiple chunks in streaming LLM responses.
 * 
 * Uses a sliding window buffer to handle partial matches at chunk boundaries.
 */
export class StreamingUnmasker {
  constructor(session, options = {}) {
    this.session = session;
    this.maxMaskedLength = options.maxMaskedLength || 128;
    this.maskedPattern = options.maskedPattern || /msk-[a-z0-9]{16,64}/g;
    this.buffer = '';
    this.closed = false;
  }

  /**
   * Transform a chunk of streaming data.
   * Returns unmasked content that can be safely flushed.
   * Keeps a buffer for potential partial matches at the end.
   * 
   * @param {string} chunk - Input chunk from stream
   * @returns {string} - Unmasked content ready to output
   */
  transform(chunk) {
    if (this.closed) {
      throw new Error('StreamingUnmasker already closed');
    }

    // Append new chunk to buffer
    this.buffer += chunk;

    // Find all complete masked values in buffer
    const matches = [...this.buffer.matchAll(this.maskedPattern)];
    let result = this.buffer;

    // Replace masked values with originals (in reverse order to preserve indices)
    for (let i = matches.length - 1; i >= 0; i--) {
      const match = matches[i];
      const masked = match[0];
      const original = this.session.lookupOriginal(masked);
      
      if (original) {
        result = result.slice(0, match.index) + original + result.slice(match.index + masked.length);
      }
    }

    // Determine how much we can safely output
    // Keep up to maxMaskedLength chars as potential partial match buffer
    const flushPoint = Math.max(0, result.length - this.maxMaskedLength);
    const output = result.slice(0, flushPoint);
    this.buffer = result.slice(flushPoint);

    return output;
  }

  /**
   * Flush remaining buffer content.
   * Call this when the stream ends.
   * 
   * @returns {string} - Final unmasked content
   */
  flush() {
    if (this.closed) {
      return '';
    }

    this.closed = true;

    // Unmask any remaining content in buffer
    let result = this.buffer;
    const matches = [...result.matchAll(this.maskedPattern)];

    for (let i = matches.length - 1; i >= 0; i--) {
      const match = matches[i];
      const masked = match[0];
      const original = this.session.lookupOriginal(masked);
      
      if (original) {
        result = result.slice(0, match.index) + original + result.slice(match.index + masked.length);
      }
    }

    this.buffer = '';
    return result;
  }

  /**
   * Check if this unmasker has been closed.
   * @returns {boolean}
   */
  isClosed() {
    return this.closed;
  }
}

/**
 * Factory function to create a streaming unmasker for a session.
 * @param {MaskSession} session - The masking session
 * @param {object} options - Options for the unmasker
 * @returns {StreamingUnmasker}
 */
export function createStreamingUnmasker(session, options = {}) {
  return new StreamingUnmasker(session, options);
}
```

**Step 2: Write tests**

```javascript
import { describe, it } from 'node:test';
import assert from 'node:assert';
import { MaskSession } from '../src/session.js';
import { StreamingUnmasker } from '../src/streaming-unmasker.js';

describe('StreamingUnmasker', () => {
  const globalSalt = 'test-salt';
  
  function createTestSession() {
    return new MaskSession(globalSalt, { ttlMs: 3600000, maxMappings: 1000 });
  }

  it('should handle complete masked value in single chunk', () => {
    const session = createTestSession();
    // Simulate storing a masked value
    session.originalToMasked.set('secret123', 'msk-abc123def4567890');
    session.maskedToOriginal.set('msk-abc123def4567890', 'secret123');
    
    const unmasker = new StreamingUnmasker(session);
    const result = unmasker.transform('Your token is msk-abc123def4567890');
    
    assert.strictEqual(result, 'Your token is secret123');
    assert.strictEqual(unmasker.flush(), '');
  });

  it('should handle masked value split across chunks', () => {
    const session = createTestSession();
    session.originalToMasked.set('secret123', 'msk-abc123def4567890');
    session.maskedToOriginal.set('msk-abc123def4567890', 'secret123');
    
    const unmasker = new StreamingUnmasker(session);
    
    // First chunk contains partial masked value
    const chunk1 = unmasker.transform('Your token is msk-abc123');
    assert.strictEqual(chunk1, 'Your token is '); // Nothing unmasked yet
    
    // Second chunk completes the masked value
    const chunk2 = unmasker.transform('def4567890 and more');
    assert.strictEqual(chunk2, 'secret123 and more');
    
    assert.strictEqual(unmasker.flush(), '');
  });

  it('should handle multiple masked values in one chunk', () => {
    const session = createTestSession();
    session.originalToMasked.set('secret1', 'msk-abc123def4567890');
    session.originalToMasked.set('secret2', 'msk-xyz789uvw4561234');
    session.maskedToOriginal.set('msk-abc123def4567890', 'secret1');
    session.maskedToOriginal.set('msk-xyz789uvw4561234', 'secret2');
    
    const unmasker = new StreamingUnmasker(session);
    const result = unmasker.transform('Token1: msk-abc123def4567890, Token2: msk-xyz789uvw4561234');
    
    assert.strictEqual(result, 'Token1: secret1, Token2: secret2');
    assert.strictEqual(unmasker.flush(), '');
  });

  it('should flush remaining buffer on end', () => {
    const session = createTestSession();
    session.originalToMasked.set('secret123', 'msk-abc123def4567890');
    session.maskedToOriginal.set('msk-abc123def4567890', 'secret123');
    
    const unmasker = new StreamingUnmasker(session);
    unmasker.transform('Your token is msk-abc123def4567890');
    
    // Buffer may still hold content
    const final = unmasker.flush();
    assert.strictEqual(final + unmasker.buffer, 'Your token is secret123');
  });

  it('should throw when transforming after close', () => {
    const session = createTestSession();
    const unmasker = new StreamingUnmasker(session);
    unmasker.flush();
    
    assert.throws(() => {
      unmasker.transform('test');
    }, /already closed/);
  });
});
```

**Step 3: Commit**

```bash
git add src/streaming-unmasker.js tests/streaming-unmasker.test.js
git commit -m "feat: add streaming unmasker for chunked LLM responses"
git push origin feature/opencode-guard-impl
```

---

### Task 13: Create Detection Engine

**Files:**
- Create: `src/detector.js`
- Create: `tests/detector.test.js`

**Step 1: Write implementation**

```javascript
export async function detectSensitiveData(text, patterns, options = {}) {
  const results = [];
  const seen = new Set();
  
  // Regex detection
  for (const rule of (patterns.regex || [])) {
    const regex = new RegExp(rule.regex.source, rule.regex.flags);
    let match;
    while ((match = regex.exec(text)) !== null) {
      const matchedText = match[0];
      if (patterns.exclude?.has(matchedText)) continue;
      
      const key = `${match.index}-${match.index + matchedText.length}`;
      if (!seen.has(key)) {
        seen.add(key);
        results.push({
          start: match.index,
          end: match.index + matchedText.length,
          text: matchedText,
          category: rule.category,
          maskAs: rule.maskAs,
        });
      }
    }
  }
  
  // Keyword detection
  for (const keyword of (patterns.keywords || [])) {
    const value = keyword.value;
    let pos = 0;
    while ((pos = text.indexOf(value, pos)) !== -1) {
      if (patterns.exclude?.has(value)) continue;
      
      const key = `${pos}-${pos + value.length}`;
      if (!seen.has(key)) {
        seen.add(key);
        results.push({
          start: pos,
          end: pos + value.length,
          text: value,
          category: keyword.category,
          maskAs: keyword.maskAs,
        });
      }
      pos += value.length;
    }
  }
  
  results.sort((a, b) => a.start - b.start);
  
  // Remove overlaps
  const filtered = [];
  for (const result of results) {
    let overlaps = false;
    for (const existing of filtered) {
      if (result.start < existing.end && result.end > existing.start) {
        if (result.end - result.start > existing.end - existing.start) {
          filtered[filtered.indexOf(existing)] = result;
        }
        overlaps = true;
        break;
      }
    }
    if (!overlaps) filtered.push(result);
  }
  
  return filtered;
}
```

**Step 2: Commit**

```bash
git add src/detector.js tests/detector.test.js
git commit -m "feat: add detection engine with mask_as metadata"
git push origin feature/opencode-guard-impl
```

---

## Phase 5: Masking & Restore Engines

### Task 12: Create Masking Engine

**Files:**
- Create: `src/engine.js`
- Create: `tests/engine.test.js`

**Step 1: Write implementation**

```javascript
import { detectSensitiveData } from './detector.js';

export async function redactText(text, patterns, session) {
  if (typeof text !== 'string' || !text) {
    return { text, count: 0 };
  }
  
  const matches = await detectSensitiveData(text, patterns);
  if (matches.length === 0) {
    return { text, count: 0 };
  }
  
  let result = text;
  let count = 0;
  
  for (let i = matches.length - 1; i >= 0; i--) {
    const match = matches[i];
    const masked = session.getOrCreateMasked(match.text, match.category, match.maskAs);
    result = result.slice(0, match.start) + masked + result.slice(match.end);
    count++;
  }
  
  return { text: result, count };
}

export async function redactDeep(value, patterns, session) {
  if (typeof value === 'string') {
    const result = await redactText(value, patterns, session);
    return result.text;
  }
  
  if (Array.isArray(value)) {
    for (let i = 0; i < value.length; i++) {
      value[i] = await redactDeep(value[i], patterns, session);
    }
    return value;
  }
  
  if (value && typeof value === 'object') {
    for (const key of Object.keys(value)) {
      value[key] = await redactDeep(value[key], patterns, session);
    }
    return value;
  }
  
  return value;
}
```

**Step 2: Commit**

```bash
git add src/engine.js tests/engine.test.js
git commit -m "feat: add masking engine using format-preserving maskers"
git push origin feature/opencode-guard-impl
```

---

### Task 13: Create Restore Engine

**Files:**
- Create: `src/restore.js`
- Create: `tests/restore.test.js`

**Step 1: Write implementation**

```javascript
export function restoreText(text, session) {
  if (typeof text !== 'string' || !text) {
    return text;
  }
  
  // Find all potential masked values by looking up in session
  // This is trickier with format-preserving masking since we don't have
  // a clear placeholder pattern. We'll need to tokenize and check each token.
  
  // Strategy: Split by common delimiters and check each token
  const delimiters = /([\s\n\r\t\[\]{}(),;:'"`<>|&!@#$%^*+=~?/\\]+)/;
  const parts = text.split(delimiters);
  
  for (let i = 0; i < parts.length; i++) {
    const original = session.lookupOriginal(parts[i]);
    if (original !== undefined) {
      parts[i] = original;
    }
  }
  
  return parts.join('');
}

export function restoreDeep(value, session) {
  if (typeof value === 'string') {
    return restoreText(value, session);
  }
  
  if (Array.isArray(value)) {
    for (let i = 0; i < value.length; i++) {
      value[i] = restoreDeep(value[i], session);
    }
    return value;
  }
  
  if (value && typeof value === 'object') {
    for (const key of Object.keys(value)) {
      value[key] = restoreDeep(value[key], session);
    }
    return value;
  }
  
  return value;
}
```

**Step 2: Commit**

```bash
git add src/restore.js tests/restore.test.js
git commit -m "feat: add restore engine for format-preserving masked values"
git push origin feature/opencode-guard-impl
```

---

## Phase 6: Main Plugin

### Task 14: Create Plugin Entry Point

**Files:**
- Create: `src/index.js`

**Step 1: Write implementation**

```javascript
import { loadConfig } from './config.js';
import { buildPatternSet } from './patterns.js';
import { MaskSession } from './session.js';
import { redactText, redactDeep } from './engine.js';
import { restoreText, restoreDeep } from './restore.js';
import { initializeCustomMaskers } from './maskers/index.js';

export const OpenCodeGuard = async (ctx) => {
  const config = await loadConfig(ctx.directory);
  const debug = Boolean(process.env.OPENCODE_GUARD_DEBUG) || config.debug;

  if (debug) {
    const from = config.loadedFrom ? config.loadedFrom : 'not found (plugin disabled)';
    console.log(`[opencode-guard] config: ${from}, enabled=${config.enabled}`);
  }

  if (!config.enabled || !config.globalSalt) {
    return {};
  }

  // Initialize custom maskers from config
  initializeCustomMaskers(config.customMaskers);

  const patterns = buildPatternSet(config.patterns);
  const sessions = new Map();

  const getSession = (sessionID) => {
    const key = String(sessionID ?? '');
    if (!key) return null;
    
    let session = sessions.get(key);
    if (session) {
      session.cleanup();
      return session;
    }
    
    session = new MaskSession(config.globalSalt, {
      ttlMs: config.ttlMs,
      maxMappings: config.maxMappings,
    });
    sessions.set(key, session);
    return session;
  };

  const isExcludedEndpoint = (endpoint) => {
    if (!endpoint) return false;
    return config.excludeLlmEndpoints.some(excluded => 
      endpoint.includes(excluded) || excluded.includes(endpoint)
    );
  };

  const isExcludedMcpServer = (server) => {
    if (!server) return false;
    return config.excludeMcpServers.includes(server);
  };

  return {
    'experimental.chat.messages.transform': async (_input, output) => {
      const msgs = output?.messages;
      if (!Array.isArray(msgs) || msgs.length === 0) return;

      const sessionID = msgs[0]?.info?.sessionID ?? msgs[0]?.parts?.[0]?.sessionID;
      const endpoint = msgs[0]?.info?.endpoint;
      
      if (isExcludedEndpoint(endpoint)) {
        if (debug) console.log(`[opencode-guard] skipping excluded endpoint: ${endpoint}`);
        return;
      }
      
      const session = getSession(sessionID);
      if (!session) return;

      let changedCount = 0;

      for (const msg of msgs) {
        const parts = Array.isArray(msg?.parts) ? msg.parts : [];
        for (const part of parts) {
          if (!part) continue;

          if (part.type === 'text' || part.type === 'reasoning') {
            if (!part.text || typeof part.text !== 'string') continue;
            if (part.ignored) continue;
            const result = await redactText(part.text, patterns, session);
            if (result.count > 0) {
              part.text = result.text;
              changedCount += result.count;
            }
            continue;
          }

          if (part.type === 'tool') {
            const state = part.state;
            if (!state || typeof state !== 'object') continue;

            if (state.input && typeof state.input === 'object') {
              await redactDeep(state.input, patterns, session);
            }

            if (state.status === 'completed' && typeof state.output === 'string') {
              const result = await redactText(state.output, patterns, session);
              if (result.count > 0) {
                state.output = result.text;
                changedCount += result.count;
              }
            }

            if (state.status === 'error' && typeof state.error === 'string') {
              const result = await redactText(state.error, patterns, session);
              if (result.count > 0) {
                state.error = result.text;
                changedCount += result.count;
              }
            }
          }
        }
      }

      if (debug && changedCount > 0) {
        console.log(`[opencode-guard] masked ${changedCount} sensitive values`);
      }
    },

    'experimental.text.complete': async (input, output) => {
      if (!output || typeof output !== 'object') return;
      if (typeof output.text !== 'string' || !output.text) return;
      
      const session = getSession(input?.sessionID);
      if (!session) return;

      const before = output.text;
      output.text = restoreText(output.text, session);
      
      if (debug && output.text !== before) {
        console.log('[opencode-guard] restored masked values in response');
      }
    },

    'mcp.tool.call.before': async (input, output) => {
      const serverName = input?.serverName;
      if (isExcludedMcpServer(serverName)) {
        if (debug) console.log(`[opencode-guard] skipping excluded MCP server: ${serverName}`);
        return;
      }
      
      const session = getSession(input?.sessionID);
      if (!session) return;

      if (output?.args && typeof output.args === 'object') {
        await redactDeep(output.args, patterns, session);
      }
    },

    'mcp.tool.call.after': async (input, output) => {
      const session = getSession(input?.sessionID);
      if (!session) return;

      if (output?.result !== undefined) {
        restoreDeep(output.result, session);
      }
    },

    'tool.execute.before': async (input, output) => {
      const session = getSession(input?.sessionID);
      if (!session) return;

      if (output?.args && typeof output.args === 'object') {
        restoreDeep(output.args, session);
      }
    },
  };
};

export default OpenCodeGuard;
```

**Step 2: Commit**

```bash
git add src/index.js
git commit -m "feat: add main plugin entry point with format-preserving masking"
git push origin feature/opencode-guard-impl
```

---

## Phase 7: Documentation

### Task 16: Write README

**Files:**
- Create: `README.md`
- Create: `README.zh-CN.md`

**Step 1: Write README with format-preserving examples**

```markdown
# OpenCode Guard

Privacy-focused OpenCode plugin with **format-preserving masking** - sensitive data is replaced with realistic-looking values that maintain the original format.

## Features

- **Format-Preserving Masking**: Masked data looks realistic (emails like emails, IPs like IPs)
- **Deterministic**: Same input always produces same masked output
- **Parallel Detection**: Regex and AI-based detection run in parallel
- **LLM + MCP Support**: Masks both LLM API calls and MCP tool invocations
- **Endpoint Exclusions**: Skip specific LLM endpoints and MCP servers

## Installation

```bash
npm install opencode-guard
```

## Configuration

```json
{
  "enabled": true,
  "debug": false,
  "global_salt": "your-secret-salt",
  "patterns": {
    "regex": [
      { "pattern": "sk-[A-Za-z0-9]{48}", "mask_as": "sk_token" }
    ],
    "builtin": ["email", "ipv4", "uuid"]
  }
}
```

## Masking Examples

| Original | Masked |
|----------|--------|
| `user@example.com` | `a3f7.k9@example.com` |
| `sk-abc123def456` | `sk-x9m2p5q8r3t6` |
| `192.168.1.1` | `10.43.127.89` |
| `550e8400-e29b-41d4-a716-446655440000` | `a1b2c3d4-e5f6-4a7b-8c9d-0e1f2a3b4c5d` |

## License

MIT
```

**Step 2: Commit**

```bash
git add README.md README.zh-CN.md
git commit -m "docs: add README with format-preserving examples"
git push origin feature/opencode-guard-impl
```

---

## Summary

This updated plan implements **format-preserving masking** with:

1. **10 specialized maskers**: email, token (4 types including prefix-aware variants), IP (v4/v6), UUID, generic, custom
2. **Prefix-aware token masking**: Automatically detects and preserves `sk-`, `sk-proj-`, `sk-or-v1-`, `sk-litellm-`, `sk-kimi-`, `sk-ant-` prefixes
3. **Extensible custom maskers**: Define new maskers via config without code changes
4. **Seeded RNG** for deterministic generation
5. **Masker registry** for dispatching
6. **Updated detection** with `mask_as` metadata
7. **Bidirectional session** mapping for restore

**Total tasks**: 17
**Key innovations**:
- Masked data passes format validation and looks realistic to upstream systems
- Easy extension via config: add new token patterns without modifying code
- Built-in support for emerging token formats (OpenRouter, LiteLLM, Kimi, Anthropic)

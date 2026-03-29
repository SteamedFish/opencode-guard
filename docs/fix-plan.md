# OpenCode Guard - Fix Implementation Plan

**Generated:** 2026-03-29  
**Based on:** Comprehensive Code Review  
**Status:** Ready for Implementation

---

## Overview

This plan addresses 5 identified issues from the comprehensive code review. All fixes are low-risk, backward-compatible improvements that enhance correctness and code quality.

**Total Estimated Effort:** ~2 hours  
**Risk Level:** Low  
**Breaking Changes:** None

---

## Task 1: Fix Import Path in patterns.js

**Priority:** High  
**File:** `src/patterns.js:1`  
**Effort:** 1 line change

### Problem

The import uses an incorrect relative path:

```javascript
import { sanitizeCategory } from '../src/utils.js';  // ❌ Wrong
```

This works due to Node.js module resolution but is semantically incorrect and confusing.

### Solution

Change to proper relative path:

```javascript
import { sanitizeCategory } from './utils.js';  // ✅ Correct
```

### Acceptance Criteria

- [ ] Import path corrected
- [ ] All tests still pass (`npm test`)
- [ ] No other imports use `../src/` pattern

---

## Task 2: Add IPv6 Pattern to BUILTIN Patterns

**Priority:** Medium  
**File:** `src/patterns.js`  
**Effort:** 2 lines added

### Problem

IPv6 pattern detection is missing despite having full IPv6 masker implementation (`src/maskers/ip.js`).

### Solution

Add IPv6 pattern to BUILTIN Map (around line 9, after ipv4):

```javascript
['ipv6', { 
  pattern: String.raw`(?:[0-9a-fA-F]{1,4}:){7}[0-9a-fA-F]{1,4}|(?:[0-9a-fA-F]{1,4}:){1,7}:|(?:[0-9a-fA-F]{1,4}:){1,6}:[0-9a-fA-F]{1,4}|(?:[0-9a-fA-F]{1,4}:){1,5}(?::[0-9a-fA-F]{1,4}){1,2}|(?:[0-9a-fA-F]{1,4}:){1,4}(?::[0-9a-fA-F]{1,4}){1,3}|(?:[0-9a-fA-F]{1,4}:){1,3}(?::[0-9a-fA-F]{1,4}){1,4}|(?:[0-9a-fA-F]{1,4}:){1,2}(?::[0-9a-fA-F]{1,4}){1,5}|[0-9a-fA-F]{1,4}:(?::[0-9a-fA-F]{1,4}){1,6}|:(?::[0-9a-fA-F]{1,4}){1,7}|::`, 
  flags: 'i', 
  category: 'IPV6', 
  maskAs: 'ipv6' 
}],
```

### Acceptance Criteria

- [ ] IPv6 pattern added to BUILTIN Map
- [ ] Pattern matches valid IPv6 addresses (full and compressed forms)
- [ ] Add test case in `tests/patterns.test.js` for IPv6 detection
- [ ] All existing tests pass

---

## Task 3: Fix Streaming Unmasker Pattern

**Priority:** High  
**File:** `src/streaming-unmasker.js:5`  
**Effort:** 1 line change + tests

### Problem

The default pattern expects `msk-` prefix that doesn't exist in actual masked values:

```javascript
maskedPattern: options.maskedPattern || /msk-[a-z0-9]{16,64}/g,  // ❌ Wrong pattern
```

Actual masked values look like:
- `sk-AbC123...` (OpenAI tokens)
- `ghp_xxxxxxxx` (GitHub tokens)
- `a3f7@example.com` (Emails)
- `192.168.x.x` (IP addresses)

### Solution

Update pattern to match actual masked output formats. Since masked values vary by type, use a more flexible pattern:

```javascript
// Generic pattern that catches most masked tokens
maskedPattern: options.maskedPattern || /(?:sk-|ghp_|gho_|ghu_|ghs_|ghr_|AKIA|ASIA)[A-Za-z0-9_-]+|[^\s@]+@[^\s@]+\.[^\s@]+/g,
```

Also update documentation in README to explain that `maskedPattern` may need customization based on specific masking needs.

### Acceptance Criteria

- [ ] Pattern updated to match actual masked value formats
- [ ] Add unit tests in `tests/streaming-unmasker.test.js` for each masker type
- [ ] Update documentation in README about `maskedPattern` configuration
- [ ] All tests pass

---

## Task 4: Remove Duplicate Test Cases

**Priority:** Low  
**File:** `tests/maskers/mac.test.js`  
**Effort:** Delete 32 lines

### Problem

Lines 66-98 duplicate tests from lines 33-64:

| Duplicate Test | Line Range 1 | Line Range 2 |
|---------------|--------------|--------------|
| `maskMACAddress handles hyphen format` | 33-38 | 66-72 |
| `maskMACAddress handles compact format` | 40-45 | 74-80 |
| `maskMACAddress is deterministic with same seed` | 47-55 | 82-88 |
| `maskMACAddress produces different results for different MACs` | 57-64 | 90-98 |

### Solution

Remove duplicate tests (lines 66-98). Keep the versions from lines 33-64 as they have better RNG mocking (using counter pattern).

### Acceptance Criteria

- [ ] Duplicate tests removed (lines 66-98)
- [ ] ~64 lines remaining in file (currently 98)
- [ ] All tests still pass
- [ ] Test count reduces from 11 to 7 tests

---

## Task 5: Add Tests for Config Options (Optional Enhancement)

**Priority:** Low  
**File:** `tests/config.test.js`  
**Effort:** New test cases

### Problem

Config options `preserveDomains` and `preservePrefixes` are parsed in config but not verified to affect masker behavior.

### Solution

Add tests verifying these options are properly passed through the system:

```javascript
test('config parses preserveDomains option', () => {
  const mockConfig = {
    masking: {
      format_preserving: true,
      preserve_domains: false,
      preserve_prefixes: false,
    },
  };
  
  // Verify config loader correctly parses these options
});
```

**Note:** Full implementation would require modifying maskers to accept options parameter. If scope is too large, simply document these options as "reserved for future use" in the configuration schema.

### Acceptance Criteria

- [ ] Tests added for config option parsing
- [ ] OR: Document that options are reserved for future use in config example

---

## Implementation Order

Recommended sequence to minimize conflicts:

```
1. Task 1 (Import fix)          → No dependencies
2. Task 4 (Remove duplicates)   → No dependencies  
3. Task 2 (IPv6 pattern)        → Can parallel with 1 & 4
4. Task 3 (Streaming pattern)   → Requires understanding mask outputs
5. Task 5 (Config tests)        → Optional, lowest priority
```

---

## Verification Checklist

After all fixes:

- [ ] Run `npm test` - all 128+ tests pass
- [ ] Verify no `../src/` imports remain in codebase (`grep -r "../src/" src/`)
- [ ] Check no duplicate test names exist (`grep "test('" tests/**/*.test.js | sort | uniq -d`)
- [ ] Review streaming unmasker tests cover multiple masker types
- [ ] Final code review for style consistency
- [ ] Update CHANGELOG or AGENTS.md if project tracks changes

---

## Risk Assessment

| Task | Risk Level | Breaking Change | Rollback Complexity |
|------|------------|-----------------|---------------------|
| Import path fix | None | No | Trivial (1 line) |
| IPv6 pattern add | Low | No (new feature) | Trivial (delete lines) |
| Streaming pattern | Medium | No (bug fix) | Trivial (revert line) |
| Remove duplicates | None | No | N/A (test cleanup) |
| Config tests | None | No | Trivial (delete tests) |

All changes are backward-compatible improvements or bug fixes.

---

## Additional Notes

### Code Review Findings Summary

The codebase received an overall grade of **A (Production Ready)** with the following highlights:

- **128 tests** - all passing
- **Comprehensive masking** - 15+ data types supported
- **Security-focused** - in-memory only, HMAC-SHA256, no persistent storage
- **Well-documented** - bilingual README, clear AGENTS.md
- **Modern JavaScript** - ES modules, Node 18+, proper async/await

These fixes address minor issues that don't affect production usage but improve code correctness and maintainability.

### Future Considerations

Not in scope for this plan but worth tracking:

1. **Performance optimization** - Web Workers for large text processing
2. **Metrics/telemetry** - Optional hooks for masking statistics
3. **CLI tool** - Command-line utility for testing patterns
4. **Config option implementation** - Actually use `preserveDomains` and `preservePrefixes` in maskers

---

## References

- Source review: See `/home/steamedfish/work/opencode-guard/AGENTS.md`
- Test status: `npm test` - 128 passing
- Related files:
  - `src/patterns.js` - patterns and imports
  - `src/streaming-unmasker.js` - streaming pattern
  - `tests/maskers/mac.test.js` - duplicate tests
  - `src/config.js` - config parsing

# CHANGELOG

## 2026-09-19 — Deep review fixes (omos/fix-deep-review)

Full-repo 3-lane deep review (1 critical, 9 high, 14 medium findings) fixed in 4 parallel lanes. 321 tests green (was 249).

- **detector/patterns**: excluded-keyword infinite loop (C1); zero-width match recording; case-insensitive exclude matching; IPv4 octet/boundary tightening; duplicate china_phone removed; invalid custom regex now warns
- **masking core**: mixed-case DB/basic-auth silent miss (H1); maskAs dispatch mismatch (H2); masked-value collision corruption + self-mapping (H3, attempt re-seed); compressed IPv6 masking emitted invalid addresses (H4); sliding TTL (M5); substring-safe single-pass restore (M7/M11); unchanged-input tripwire warning; custom regex masker group handling
- **streaming**: session-key-driven restore for ALL masked types in streams (M1 — previously only tokens/IPs/emails); prefix-of-real-key hold-back (innocent trailing text no longer held); post-restore flush bug (L1); v1 stream.end flush (H5); wrapResponse strips stale content-length/content-encoding (M2)
- **integration/config**: setupV2 ReferenceError (H6); debug_file hardening — 0600, truncate-on-start, plaintext startup warning, relative paths rejected, mapping-table dump removed (H7); endpoint exclusion hostname semantics (H8); server-scoped MCP tool exclusions (H9); session LRU cap + unmasker idle TTL (M3); ephemeral-session masking on missing sessionID (M4, fail closed); malformed config fails closed with loud warning (M9); OPENCODE_GUARD_SALT env override + salt-file permission warning (M10); v1 error-field masking parity (M14)

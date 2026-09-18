---
name: guard-e2e-testing
description: How to test the opencode-guard plugin (unit + end-to-end masking/restore verification). Use when modifying src/, releasing, or verifying the plugin against a real OpenCode v2 runtime. Contains critical pitfalls that have caused wasted debugging time.
---

# Testing opencode-guard

## Unit tests

```bash
npm test                    # node --test, no external deps
node --test tests/v2.test.js # single file
```

## Install for manual testing (OpenCode v2)

```bash
ln -s "$PWD/src" ~/.config/opencode/plugins/opencode-guard
# plugin requires its own config, else it fail-safe disables:
# ~/.config/opencode/opencode-guard.config.json — { "enabled": true, "global_salt": "<random hex>" }
```

No `opencode.jsonc` change needed: v2 auto-discovers `~/.config/opencode/plugins/<dir>/index.js`.
Hot reload: `touch ~/.config/opencode/plugins/opencode-guard/index.js` (file watcher re-loads).
Confirm load: `grep "loading plugin" ~/.local/share/opencode/log/opencode.log | grep opencode-guard`.

## End-to-end verification with a capture server (the ONLY reliable way)

Why: by v2 design, persisted history and everything you see on screen are restored
to originals. The only place masking is observable is **what leaves the machine**.
Use the committed fake provider:

```bash
# 1. scratch project dir with a provider pointing at the capture server
mkdir -p .tmp/e2e && cd .tmp/e2e
python3 ../../scripts/e2e/capture-server.py 15151 capture.log &

# 2. write opencode.jsonc in .tmp/e2e (provider "capture", model "probe"):
#    package: "aisdk:@ai-sdk/openai-compatible"
#    settings: { baseURL: "http://127.0.0.1:15151/v1", apiKey: "sk-dummy" }
#    models.probe: { capabilities: { tools: false, input: ["text"], output: ["text"] } }
#    agents.title.model: "capture/probe"   (so the title request also goes here)

# 3. run with a UNIQUE email (reused values contaminate earlier mappings)
opencode run --standalone -m capture/probe "My email is <uniq42@example.com>. Reply with exactly: OK" > out.txt 2>&1

# 4. verify ON DISK (never by eye — see pitfalls):
grep -c '<uniq42@example.com>' capture.log   # MUST be 0  → original never left
grep -c '<uniq42@example.com>' out.txt       # MUST be 1  → response restored
grep -oE '[\w.+-]+@[\w.-]+' capture.log | sort -u   # the masked value(s)
```

The capture server echoes back the last email in the request body, which is the
masked token the plugin just registered — so the displayed `echo:` line proves the
`http.response` restore hook end-to-end.

## Pitfalls (all hit in practice, 2026-09-18)

1. **Your own session is also masked.** If the plugin is loaded in the opencode
   instance you are running inside, every tool result you read has already been
   masked (`tool.execute.after`), and values you type are restored before execution
   (`tool.execute.before`). Consequences:
   - NEVER compare sensitive values by eye; the same string can appear as different
     masked variants across reads.
   - Use `grep -c` on disk files: your grep pattern is restored to the real value
     before execution, and the numeric count is not maskable.
2. **Masks are per-session.** Offline precomputing a masked value with the same
   salt does NOT match a live session's mask (the seed incorporates sessionID).
   The capture server must echo dynamically from the request body, never a
   precomputed constant.
3. **Models refuse to echo API keys.** Probing with "repeat my key" triggers safety
   refusals. Use a harmless unique email instead; ask for the local part only if you
   need an unrestorable fragment.
4. **Plugin console output is invisible in v2.** `console.log` from a plugin does
   not reach the server log, `--print-logs`, or serve stdout. Use the `debug_file`
   config option (`debug_file` / `OPENCODE_GUARD_DEBUG_FILE`) and read the file.
   Remember the debug file can contain masked→original mappings; delete it after.
5. **`pkill -f <pattern>` self-matches** when the pattern appears in your own
   command line; it kills your shell mid-cleanup. Kill by exact PID, or use a
   self-excluding pattern like `pgrep -f "capture-serve[r]"`.
6. `opencode run` without `--standalone` talks to the background service, so env
   vars (e.g. `OPENCODE_GUARD_DEBUG=1`) of your shell do NOT reach the plugin —
   the service process has its own environment. Use `--standalone` or set
   `debug: true` / `debug_file` in the guard config file instead.
7. For a functional probe, **do not** rely on what the model prints: both the
   masked and unmasked paths can produce the same visible text. Wire-level capture
   (or `grep -c` on its log) is the only trustworthy evidence.

## Pitfalls — round 2 (all hit in practice, 2026-09-19)

8. **`grep -o`/`-oE` output is NOT trustworthy** when your own session's plugin is
   loaded: extracted email/token-shaped values in the OUTPUT get masked by
   `tool.execute.after` before you see them (observed: extraction output rendered
   as empty). Only `grep -c` counts (and `cat -A`/`tail` for STRUCTURE, never for
   value comparison) are reliable. Consequence of pitfall 1, easy to forget.
9. **Plugin id dedup: the global plugin shadows the sandbox one.** When both
   `~/.config/opencode/plugins/opencode-guard` and the sandbox opencode.jsonc
   `plugins: ["file:///...worktree/src"]` are present, they share the plugin id
   and only ONE loads — the global one. Your sandbox then silently runs the MAIN
   checkout's code, not the worktree's. During worktree E2E, repoint the global
   symlink at the worktree src (`ln -sfn .../worktree/src ~/.config/opencode/plugins/opencode-guard`)
   and **restore it to the main src when done**. First symptom of shadowing: code
   changes "have no effect" in probes.
10. **`debug_file` only writes when `debug: true` is also set**
    (`fileEnabled = debug && debugFile`). A config with `debug_file` but no
    `debug` produces no file at all — absence of the file is not proof the
    plugin didn't load.
11. **Capture-server restart procedure** (two real failures): `$!` from
    `nohup ... &` may not be the python PID; `pgrep -f "capture-serve[r]"`
    also matches your own `bash -c` wrapper. Correct procedure:
    `pgrep -af "capture-serve[r]" | grep python3` → `kill -9 <pid>` → confirm the
    port is free (`ss -tlnp | grep <port>` shows nothing) → start → confirm the
    new process args show the intended `--mode` before probing. A stale server
    answering in the wrong mode silently invalidates probe results.
12. **v2 byte-level restore cannot see values split across SSE events** (fixed
    by SSE-aware restore; if you ever revert it): two `delta.content` strings
    have JSON/SSE framing between them, so a key split across events is never
    contiguous in raw bytes. When testing restore, always include a probe where
    the masked value is split across two SSE events (capture-server `--mode=echo-split`).

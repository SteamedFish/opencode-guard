# E2E Test Helpers

Fake providers/servers used for end-to-end testing of opencode-guard. Together
with the `guard-e2e-testing` skill (`.opencode/skills/guard-e2e-testing/`) they
let you prove what did (masked) and did not (original) leave the machine.

[中文文档](README.zh-CN.md)

## capture-server.py — fake provider (OpenAI-compatible + Anthropic Messages)

Captures every request body to a log file and replies with an SSE stream:
OpenAI `chat.completion` chunks on `/v1/chat/completions`, or Anthropic
Messages API events (`message_start` / `content_block_*` / `message_delta` /
`message_stop`) on `/v1/messages` when the mode starts with `anthropic`.
stdlib only, single file.

```bash
python3 scripts/e2e/capture-server.py [port] [capture-log-path] [--mode=MODE] [flags...]
# defaults: port 15151, log ./capture.log, mode echo
```

### Modes

| Mode | Behavior |
|------|----------|
| `echo` (default) | One content chunk: `echo: <last-email-in-request>`, then `finish_reason: stop`, then `[DONE]`. |
| `echo-split` | The echoed email is split across two content chunks (roughly half/half); chunk 2 ends with a trailing `abcdef` suffix (6 hex chars, NOT part of the email) to test that the unmasker's hold-back logic does not swallow trailing text. Emails shorter than 4 chars are not split. |
| `echo-last` | First chunk is filler `working... `; the echo email appears only in the second (final content) chunk, immediately before the `finish_reason` chunk — tests flush-at-stream-end. |
| `tool` | Without a `"role":"tool"` message: replies with an OpenAI streaming `tool_call` for the first tool named `write` (else `bash`, else the first tool), with arguments embedding the last email in the request body (`write`/`bash` write it to `tool-probe-output.txt` in the sandbox cwd). With a `"role":"tool"` message (second round-trip): plain single-chunk echo plus a `=== TOOL-ROUND ===` marker line in the capture log. |
| `tool-split` | Like `tool`, but the tool-call `function.arguments` JSON string is split across TWO SSE delta chunks with the split point in the MIDDLE of the email value inside the arguments (fragment 1 ends mid-email, fragment 2 starts with the rest). If no email is found in the request, splits at half the arguments length. Second round-trip behaves exactly like `tool` mode (plain echo + `=== TOOL-ROUND ===` marker). |
| `echo-message` | Parses the request JSON and streams back the text of the LAST `user` message verbatim, split into 3 roughly-equal content chunks (no `echo: ` prefix). Handles string content and array-of-parts content (text parts joined with a space); replies `no-user-text` if there is no user message or no text. Use this to prove the response-restore hook restores non-email masked values (e.g. AI-detected street addresses). |
| `anthropic` | Anthropic Messages API text stream (`message_start`, one text block, `message_delta`, `message_stop`) echoing `echo: <last-email-in-request>` in a single `content_block_delta` (`text_delta`). Served on paths containing `messages` (use provider package `aisdk:@ai-sdk/anthropic` with `baseURL` ending in `/v1`). |
| `anthropic-split` | Like `anthropic`, but the email is split across TWO `text_delta` events with the split point mid-email, chunk 2 carrying the same trailing `abcdef` suffix as `echo-split`. Exercises cross-event restore + hold-back in the Anthropic shape. |
| `anthropic-last` | Like `anthropic`, but a filler `working... ` delta comes first and the echo email appears only in the final delta before `content_block_stop` — exercises flush/restore behaviour at stream end (the Anthropic shape has no `[DONE]`). |
| `anthropic-tool-split` | Anthropic `tool_use` block whose `input` is streamed as TWO `input_json_delta` (`partial_json`) fragments, split in the MIDDLE of the email value inside the arguments; `stop_reason` is `tool_use`. On the second round-trip (a message containing a `tool_result` block) replies with a plain `anthropic` echo. Tool selection/args match `tool` mode, so `write`/`shell` write the probe value to `tool-probe-output.txt` (verify with `--mode=tool-file`). |

### Flags

Independent flags, combinable with any mode and with each other where
meaningful (e.g. `--mode=echo-split --crlf --keepalive --no-done`,
`--mode=tool-split --reasoning`):

| Flag | Behavior |
|------|----------|
| `--crlf` | Emit all SSE line endings as `\r\n` (frames end with `\r\n\r\n`) instead of `\n`. |
| `--keepalive` | Emit one SSE comment line `: ka` before the first data event, and one between the first and second data events. |
| `--no-done` | Omit the final `data: [DONE]` frame — the stream just ends after the finish chunk. |
| `--reasoning` | Insert an extra FIRST data chunk whose delta is `{"role":"assistant","reasoning_content":"<email>"}` (the same echoed email the mode would use), before the normal chunks. |
| `--prefer-tool=NAME` | In `tool`/`tool-split` modes, pick the tool named NAME from the request's tools array instead of the default `write`→`bash`→first preference order. Needed because tool sets differ per agent/distribution (e.g. the shell tool may be named `shell`, MCP tools may be absent). |
| `--tool-stdout` | For shell-style tools (`bash`/`shell`): print the secret to stdout instead of redirecting it into `tool-probe-output.txt`, so the tool RESULT carries the secret (tests `tool.execute.after` result masking on the next-round request body). |

In all modes every request body is appended to the capture log exactly as
received. `--no-done` and `--reasoning` apply to the OpenAI-shaped modes only
(the Anthropic shape has no `[DONE]` frame and no `reasoning_content` delta;
use `anthropic-last` to probe stream-end flush instead). `--crlf`,
`--keepalive`, `--prefer-tool` and `--tool-stdout` apply to both shapes.

### Smoke test

```bash
python3 scripts/e2e/capture-server.py 16400 /tmp/capture.log --mode=echo &
PID=$!
curl -s http://127.0.0.1:16400/v1/chat/completions \
  -H 'content-type: application/json' \
  -d '{"messages":[{"role":"user","content":"my email is smoke@test.dev"}]}'
kill $PID
```

### Anthropic Messages API providers

Point an `@ai-sdk/anthropic` provider at the capture server: the SDK posts to
`${baseURL}/messages`, so `baseURL` must end in `/v1`, and any path containing
`messages` is answered (with the `anthropic*` mode selected).

```jsonc
{
  "providers": {
    "capture": {
      "package": "aisdk:@ai-sdk/anthropic",
      "settings": { "baseURL": "http://127.0.0.1:16500/v1", "apiKey": "sk-ant-dummy" },
      "models": { "probe": { "capabilities": { "tools": true, "input": ["text"], "output": ["text"] } } }
    }
  },
  "model": "capture/probe",
  "agents": { "title": { "model": "capture/probe" } }
}
```

```bash
python3 scripts/e2e/capture-server.py 16500 cap.log --mode=anthropic-split &
opencode run --standalone -m capture/probe "My email is x42@example.com. Reply with exactly: OK" > out.txt
python3 scripts/e2e/verify-probe.py cap.log out.txt --mode=restore
```

Verified 2026-09-19 against opencode v2.0.6 (`anthropic`, `anthropic-split`,
`anthropic-last`, `anthropic-tool-split --mode=tool-file`): all PASS.

## fake-mcp-server.py — fake MCP server on stdio

A minimal [Model Context Protocol](https://modelcontextprotocol.io) server
speaking newline-delimited JSON-RPC 2.0 on stdio, stdlib only. Exposes one
tool, `lookup_secret`, whose result text embeds fixed probe secrets
(`mcp-probe@mailfence-test.net`, `mcpTok9f4ab71c3d`) that opencode-guard is
supposed to mask. Received method names are logged to stderr.

Wire it into `opencode.jsonc`:

```jsonc
{
  "mcp": {
    "fake": {
      "type": "local",
      "command": ["python3", "/abs/path/scripts/e2e/fake-mcp-server.py"],
      "enabled": true,
      // Optional: log every received tools/call's arguments to a file.
      // Decisive evidence for MCP exclusion probes — the wire cannot show
      // whether the server received masked or original args.
      "environment": {"FAKE_MCP_LOG": "/abs/path/received.log"}
    }
  }
}
```

When `FAKE_MCP_LOG` is set, one line per `tools/call` is appended to that
file: `<method> <tool-name> <compact-json-of-arguments>`. Logging failures
are swallowed — logging never breaks the server. Unset: no logging.

### Smoke test

```bash
printf '%s\n' \
  '{"jsonrpc":"2.0","id":1,"method":"initialize","params":{"protocolVersion":"2024-11-05","capabilities":{},"clientInfo":{"name":"curl","version":"0"}}}' \
  '{"jsonrpc":"2.0","method":"notifications/initialized"}' \
  '{"jsonrpc":"2.0","id":2,"method":"tools/list"}' \
  '{"jsonrpc":"2.0","id":3,"method":"tools/call","params":{"name":"lookup_secret","arguments":{"key":"acct-7"}}}' \
  | python3 scripts/e2e/fake-mcp-server.py
```

## verify-probe.py — self-contained assertion driver

Assertion driver for probe runs. The agent running E2E probes has the
plugin-under-test loaded in its OWN session, so any probe value embedded in
the agent's shell commands gets masked/restored unpredictably — inline
`grep -c '<probe>' capture.log` results are unreliable. verify-probe.py
therefore takes ZERO probe values as arguments: it derives the probe email
from the run transcript and reads MCP fixture secrets from
`fake-mcp-server.py`, computing all assertions in-process. Output is only
PASS/FAIL lines and counts — extracted secret values are never printed.

```bash
python3 scripts/e2e/verify-probe.py <capture.log> <out.txt> [--mode=restore|unmasked|tool-file] [--mcp] [--probe-file <path>] [--allow-wire-variants]
# defaults: mode restore, probe file ./tool-probe-output.txt (tool-file mode only)
```

| Flag | Effect |
|------|--------|
| `--allow-wire-variants` | Relaxes A5: residual email-shaped tokens in out.txt that byte-appear in capture.log are also allowed. Rationale: tool CALL args for MCP tools and tool RESULTS are stored in the transcript in MASKED form (`execute.before`/`execute.after`), so the on-disk transcript legitimately contains masked variants that also went over the wire. A half-restored fragment would not byte-match the full wire variant, so the relaxation stays strict against partial-restore corruption. |

| Assertion | Modes | Meaning |
|-----------|-------|---------|
| A1 derive-probe | all | Exactly one probe email derivable from out.txt (single distinct email-shaped token, or an unambiguous `echo:` line). Tokens with dot-less domains (e.g. `x@explorer` agent-mention artifacts) are ignored. With `--mcp`, the fixture FIXED_EMAIL is excluded from candidates (the final `echo:` line echoes the fixture's email — it is the last email in the final request body); the real probe appears restored on tool-call lines, so lines containing `{"` (tool-call args) are then also used for disambiguation. |
| A2 no-leak | restore, tool-file | Probe email byte-count in capture.log == 0. |
| A2 original-on-wire | unmasked | Probe email byte-count in capture.log >= 1 (exclusion configured). |
| A3 masked-traffic | restore, tool-file | capture.log contains >= 1 email-shaped token that is not the probe — proves the masking path was actually active, not bypassed. |
| A4 restore | all | Probe email appears in out.txt (byte count >= 1). |
| A5 no-residual | restore, tool-file | Every email-shaped token in out.txt equals the probe email (with `--mcp`, the restored FIXED_EMAIL is also allowed; with `--allow-wire-variants`, tokens byte-appearing in capture.log are also allowed) — no leftover masked fragments. |
| MCP1/MCP2 | `--mcp` | `FIXED_EMAIL`/`FIXED_TOKEN` extracted from `fake-mcp-server.py`: absent from capture.log (restore/tool-file) or present (unmasked). |
| MCP3 | `--mcp`, restore/tool-file | `FIXED_EMAIL` restored in out.txt (byte count >= 1). |
| T1 tool-file | tool-file | Probe file contains the probe email exactly once. |

The final line is `RESULT: PASS` / `RESULT: FAIL`; exit code 0/1
accordingly.

## Verifying masking — always grep, never eyeball

All verification MUST be done by counting matches in the capture log with
`grep -c`, never by looking at output. Masked values are format-preserving
and look identical to originals at a glance. For agent-driven probe runs,
use `verify-probe.py` (see above) instead of inline grep — the agent's own
plugin session makes probe values in its shell commands unreliable.

```bash
# Should be 0: the original secret must never reach the provider/MCP server.
grep -c 'smoke@test.dev' /tmp/capture.log

# Should be >= 1: the masked placeholder did leave the machine.
grep -c '@' /tmp/capture.log
```

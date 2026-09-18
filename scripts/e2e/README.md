# E2E Test Helpers

Fake providers/servers used for end-to-end testing of opencode-guard. Together
with the `guard-e2e-testing` skill (`.opencode/skills/guard-e2e-testing/`) they
let you prove what did (masked) and did not (original) leave the machine.

[中文文档](README.zh-CN.md)

## capture-server.py — fake OpenAI-compatible provider

Captures every request body to a log file and replies with an SSE
`chat.completion` stream. stdlib only, single file.

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

In all modes every request body is appended to the capture log exactly as
received.

### Smoke test

```bash
python3 scripts/e2e/capture-server.py 16400 /tmp/capture.log --mode=echo &
PID=$!
curl -s http://127.0.0.1:16400/v1/chat/completions \
  -H 'content-type: application/json' \
  -d '{"messages":[{"role":"user","content":"my email is smoke@test.dev"}]}'
kill $PID
```

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
      "enabled": true
    }
  }
}
```

### Smoke test

```bash
printf '%s\n' \
  '{"jsonrpc":"2.0","id":1,"method":"initialize","params":{"protocolVersion":"2024-11-05","capabilities":{},"clientInfo":{"name":"curl","version":"0"}}}' \
  '{"jsonrpc":"2.0","method":"notifications/initialized"}' \
  '{"jsonrpc":"2.0","id":2,"method":"tools/list"}' \
  '{"jsonrpc":"2.0","id":3,"method":"tools/call","params":{"name":"lookup_secret","arguments":{"key":"acct-7"}}}' \
  | python3 scripts/e2e/fake-mcp-server.py
```

## Verifying masking — always grep, never eyeball

All verification MUST be done by counting matches in the capture log with
`grep -c`, never by looking at output. Masked values are format-preserving
and look identical to originals at a glance.

```bash
# Should be 0: the original secret must never reach the provider/MCP server.
grep -c 'smoke@test.dev' /tmp/capture.log

# Should be >= 1: the masked placeholder did leave the machine.
grep -c '@' /tmp/capture.log
```

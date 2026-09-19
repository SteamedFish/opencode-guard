#!/usr/bin/env python3
"""Fake OpenAI-compatible provider that captures request bodies and echoes
the last email-looking value back in an SSE chat completion.

Used for end-to-end testing of opencode-guard: point a test provider at this
server, run `opencode run` against it, then inspect the capture log to prove
what did (masked) and did not (original) leave the machine.

Usage: capture-server.py [port] [capture-log-path] [--mode=MODE] [flags...]
Defaults: port 15151, log ./capture.log, mode echo

Modes:
  echo        Single SSE chunk: "echo: <last-email-in-request>".
  echo-split  Echo the email split across two content chunks; chunk2 ends
              with a trailing "abcdef" suffix (not part of the email) to
              test the unmasker's hold-back logic.
  echo-last   First chunk is filler "working... ", the echo email appears
              only in the second (final content) chunk, right before the
              finish_reason chunk - tests flush-at-stream-end.
  tool        Tool-call mode. Without a "role":"tool" message in the request:
              emit an OpenAI streaming tool_call for the first tool named
              "write" (else "bash", else the first tool), with arguments
              embedding the last email in the request body. With a
              "role":"tool" message (second round-trip): plain single-chunk
              echo plus a "=== TOOL-ROUND ===" marker line in the log.
  tool-split  Like tool, but the tool-call function.arguments JSON string is
              split across TWO SSE delta chunks, with the split point in the
              MIDDLE of the email value inside the arguments (fragment 1 ends
              mid-email; fragment 2 starts with the rest). If no email is
              found in the request, split at half the arguments length.
              Second round-trip behaves like tool mode.
  echo-message  Stream the text of the LAST "role":"user" message back
              verbatim, split into 3 content chunks (no "echo: " prefix) -
              proves restore of non-email masked values (e.g. street
              addresses). Falls back to "no-user-text".

Anthropic Messages API modes (SSE shape: message_start / content_block_* /
message_delta / message_stop; served on any path containing "messages"):

  anthropic       One text block: "echo: <last-email-in-request>".
  anthropic-split Echo the email split across two content_block_delta
                  (text_delta) events, chunk 2 ending with a trailing
                  "abcdef" suffix (not part of the email) - mirrors
                  echo-split's hold-back test in the Anthropic shape.
  anthropic-last  Filler "working... " delta, then the echo email in the
                  final delta right before content_block_stop - tests
                  flush-at-stream-end in the Anthropic shape.

Flags (independent, combinable with any mode and each other):
  --crlf      Emit all SSE line endings as \\r\\n (frames end with \\r\\n\\r\\n).
  --keepalive Emit one SSE comment line ": ka" before the first data event,
              and one between the first and second data event.
  --no-done   Omit the final "data: [DONE]" frame; the stream just ends
              after the finish chunk. (OpenAI modes only - the Anthropic
              shape has no [DONE] frame; use "anthropic-last" to probe
              flush-at-stream-end there.)
  --reasoning Insert an extra FIRST data chunk whose delta is
              {"role":"assistant","reasoning_content":"<email>"} (the same
              echoed email the mode would use), before the normal chunks.
              (OpenAI modes only.)
"""
import json
import re
import sys
from http.server import BaseHTTPRequestHandler, HTTPServer

args = sys.argv[1:]
PORT = int(args[0]) if len(args) > 0 else 15151
LOG = args[1] if len(args) > 1 else 'capture.log'
MODE = 'echo'
CRLF = False
KEEPALIVE = False
NO_DONE = False
REASONING = False
PREFER_TOOL = None
PREFER_STATE = {'called': False}
TOOL_STDOUT = False
for a in args[2:]:
    if a.startswith('--mode='):
        MODE = a.split('=', 1)[1]
    elif a == '--crlf':
        CRLF = True
    elif a == '--keepalive':
        KEEPALIVE = True
    elif a == '--no-done':
        NO_DONE = True
    elif a == '--reasoning':
        REASONING = True
    elif a.startswith('--prefer-tool='):
        PREFER_TOOL = a.split('=', 1)[1]
    elif a == '--tool-stdout':
        TOOL_STDOUT = True

EOL = '\r\n' if CRLF else '\n'

# Matches the masked forms of emails/tokens the plugin produces. Extend as needed.
EMAIL_RE = re.compile(rb'[\w.+-]+@[\w-]+\.[\w.]+')

FALLBACK_ECHO = 'nothing-found@example.com'
TOOL_ROUND_FALLBACK = 'tool-round-done@example.com'


def chunk(delta, finish=None):
    return "data: " + json.dumps({
        "id": "chatcmpl-capture", "object": "chat.completion.chunk",
        "created": 1789739000, "model": "probe",
        "choices": [{"index": 0, "delta": delta, "finish_reason": finish}],
    }) + EOL + EOL


def keepalive():
    return ": ka" + EOL + EOL


def sse_body(parts):
    out = []
    if KEEPALIVE:
        out.append(keepalive())
    for i, p in enumerate(parts):
        if KEEPALIVE and i == 1:
            out.append(keepalive())
        out.append(p)
    if not NO_DONE:
        out.append("data: [DONE]" + EOL + EOL)
    return "".join(out).encode()


def last_email(body):
    emails = EMAIL_RE.findall(body)
    # The greedy trailing [\w.]+ can swallow a sentence-final period after the
    # email (e.g. "... is X@y.z. Reply"), which would make tool args carry a
    # DIFFERENT string than the wire-masked email (extra masked variant).
    return emails[-1].decode().rstrip('.') if emails else None


def tool_name(t):
    """Tool name from either shape: OpenAI `{function:{name}}` or Anthropic
    `{name}`."""
    return (t.get('function') or t).get('name')


def tool_schema(t):
    """JSON-schema of a tool's parameters from either shape: OpenAI
    `function.parameters` or Anthropic `input_schema`."""
    return (t.get('function') or {}).get('parameters') or t.get('input_schema') or {}


def pick_tool(req):
    """--prefer-tool=NAME if present, else first tool named 'write', else
    'bash', else the first tool. None if no tools."""
    tools = req.get('tools') or []
    if not tools:
        return None
    if PREFER_TOOL:
        for t in tools:
            if tool_name(t) == PREFER_TOOL:
                return t
    for want in ('write', 'bash'):
        for t in tools:
            if tool_name(t) == want:
                return t
    return tools[0]


def tool_arguments(tool, email):
    """Build the arguments JSON string for a tool_call, or None to fall back
    to plain echo text mode."""
    name = tool_name(tool)
    if name == 'write':
        # opencode v2 write tool schema uses "path" (older builds used
        # "filePath"); extra keys fail additionalProperties:false validation.
        return json.dumps({
            "path": "tool-probe-output.txt",
            "content": "captured secret: " + email,
        })
    if name in ('bash', 'shell'):
        # Shell-style tool (named 'bash' or 'shell' depending on the opencode
        # distribution). Command-only args: extra fields like "description"
        # violate additionalProperties:false on some tool schemas.
        # --tool-stdout prints the secret to stdout instead of redirecting to a
        # file, so the tool RESULT carries it (tests tool.execute.after masking).
        cmd = "printf '%%s\\n' '%s'" % email
        if not TOOL_STDOUT:
            cmd += " > tool-probe-output.txt"
        return json.dumps({"command": cmd})
    # Best-effort for any other tool: first required string property from its
    # parameters schema, as a single-string-arg object.
    params = tool_schema(tool)
    props = params.get('properties') or {}
    for req_key in (params.get('required') or []):
        prop = props.get(req_key) or {}
        ptype = prop.get('type')
        if ptype in (None, 'string') and req_key:
            return json.dumps({req_key: email})
    return None


def build_echo(email):
    return [
        chunk({"role": "assistant", "content": "echo: " + email}),
        chunk({}, "stop"),
    ]


def build_echo_split(email):
    if len(email) < 4:
        return build_echo(email)
    half = len(email) // 2
    return [
        chunk({"role": "assistant", "content": "echo: " + email[:half]}),
        chunk({"content": email[half:] + "abcdef"}),
        chunk({}, "stop"),
    ]


def build_echo_last(email):
    return [
        chunk({"role": "assistant", "content": "working... "}),
        chunk({"content": "echo: " + email}),
        chunk({}, "stop"),
    ]


def last_user_text(req):
    """Text content of the LAST user message, or None if there is no user
    message or it carries no text. Handles both plain-string content and
    array-of-parts content (text parts joined with a space)."""
    for m in reversed(req.get('messages') or []):
        if not (isinstance(m, dict) and m.get('role') == 'user'):
            continue
        content = m.get('content')
        if isinstance(content, str):
            return content
        if isinstance(content, list):
            parts = [p.get('text') for p in content
                     if isinstance(p, dict) and p.get('type') == 'text'
                     and isinstance(p.get('text'), str)]
            if parts:
                return ' '.join(parts)
        return None
    return None


def build_echo_message(text):
    n = len(text)
    bounds = [0, n // 3, 2 * n // 3, n]
    pieces = [text[bounds[i]:bounds[i + 1]] for i in range(3)]
    parts = []
    for piece in [p for p in pieces if p]:
        delta = {"content": piece}
        if not parts:
            delta = {"role": "assistant", "content": piece}
        parts.append(chunk(delta))
    parts.append(chunk({}, "stop"))
    return parts


def build_tool(name, arguments):
    return [
        chunk({"role": "assistant", "tool_calls": [{
            "index": 0, "id": "call_capture1", "type": "function",
            "function": {"name": name, "arguments": ""},
        }]}),
        chunk({"tool_calls": [{
            "index": 0, "function": {"arguments": arguments},
        }]}),
        chunk({}, "tool_calls"),
    ]


def build_tool_split(name, arguments, email):
    """Like build_tool, but split the arguments JSON across two delta chunks,
    with the split point in the MIDDLE of the email value inside the
    arguments (fragment 1 ends mid-email; fragment 2 starts with the rest).
    If the email is not found in the arguments, split at half its length."""
    idx = arguments.find(email) if email else -1
    if idx >= 0 and len(email) >= 2:
        split = idx + len(email) // 2
    else:
        split = len(arguments) // 2
    frag1, frag2 = arguments[:split], arguments[split:]
    return [
        chunk({"role": "assistant", "tool_calls": [{
            "index": 0, "id": "call_capture1", "type": "function",
            "function": {"name": name, "arguments": frag1},
        }]}),
        chunk({"tool_calls": [{
            "index": 0, "function": {"arguments": frag2},
        }]}),
        chunk({}, "tool_calls"),
    ]


def a_event(obj):
    """One Anthropic SSE event: an `event:` line (the type) plus the matching
    `data:` JSON line. @ai-sdk/anthropic ignores the event name and
    discriminates on the JSON `type`, but real Anthropic streams emit it, so
    the fake provider does too."""
    return 'event: ' + obj['type'] + EOL + 'data: ' + json.dumps(obj) + EOL + EOL


def a_message_start():
    return a_event({
        "type": "message_start",
        "message": {
            "id": "msg_capture", "type": "message", "role": "assistant",
            "model": "claude-capture", "content": [],
            "stop_reason": None, "stop_sequence": None,
            "usage": {"input_tokens": 1, "output_tokens": 1},
        },
    })


def a_block_start(index=0):
    return a_event({"type": "content_block_start", "index": index,
                    "content_block": {"type": "text", "text": ""}})


def a_text_delta(text, index=0):
    return a_event({"type": "content_block_delta", "index": index,
                    "delta": {"type": "text_delta", "text": text}})


def a_block_stop(index=0):
    return a_event({"type": "content_block_stop", "index": index})


def a_tool_block_start(name, index=0):
    return a_event({"type": "content_block_start", "index": index,
                    "content_block": {"type": "tool_use", "id": "toolu_capture1",
                                      "name": name, "input": {}}})


def a_json_delta(partial, index=0):
    return a_event({"type": "content_block_delta", "index": index,
                    "delta": {"type": "input_json_delta", "partial_json": partial}})


def a_message_delta(out_tokens=1, stop_reason='end_turn'):
    return a_event({"type": "message_delta",
                    "delta": {"stop_reason": stop_reason, "stop_sequence": None},
                    "usage": {"output_tokens": out_tokens}})


def a_message_stop():
    return a_event({"type": "message_stop"})


def build_anthropic(email, split=False, last=False):
    """Anthropic Messages API text stream echoing `email`. split=True cuts the
    email across two content_block_delta events (chunk 2 also carries an
    "abcdef" suffix); last=True puts the email only in the final delta so the
    stream end is what flushes it."""
    parts = [a_message_start(), a_block_start()]
    if split and len(email) >= 4:
        half = len(email) // 2
        parts.append(a_text_delta('echo: ' + email[:half]))
        parts.append(a_text_delta(email[half:] + 'abcdef'))
    elif last:
        parts.append(a_text_delta('working... '))
        parts.append(a_text_delta('echo: ' + email))
    else:
        parts.append(a_text_delta('echo: ' + email))
    parts.append(a_block_stop())
    parts.append(a_message_delta())
    parts.append(a_message_stop())
    return parts


def build_anthropic_tool(name, arguments, email):
    """Anthropic tool_use stream: one tool_use block whose `input` is streamed
    as two input_json_delta fragments, split in the MIDDLE of the email value
    inside the arguments (fragment 1 ends mid-email)."""
    idx = arguments.find(email) if email else -1
    if idx >= 0 and len(email) >= 2:
        split = idx + len(email) // 2
    else:
        split = len(arguments) // 2
    return [
        a_message_start(),
        a_tool_block_start(name),
        a_json_delta(arguments[:split]),
        a_json_delta(arguments[split:]),
        a_block_stop(),
        a_message_delta(stop_reason='tool_use'),
        a_message_stop(),
    ]


def has_anthropic_tool_result(req):
    """True when any message carries a tool_result content block (Anthropic's
    second round-trip after a tool executes)."""
    for m in req.get('messages') or []:
        content = m.get('content') if isinstance(m, dict) else None
        if isinstance(content, list) and any(
            isinstance(b, dict) and b.get('type') == 'tool_result' for b in content
        ):
            return True
    return False


def build_response(body):
    """Return SSE bytes for the configured mode and flags."""
    email = last_email(body) or FALLBACK_ECHO
    parts = None
    if MODE == 'anthropic':
        parts = build_anthropic(email)
    elif MODE == 'anthropic-split':
        parts = build_anthropic(email, split=True)
    elif MODE == 'anthropic-last':
        parts = build_anthropic(email, last=True)
    elif MODE == 'anthropic-tool-split':
        try:
            req = json.loads(body)
        except ValueError:
            req = {}
        if has_anthropic_tool_result(req):
            # Second round-trip (after the tool executed): plain echo.
            parts = build_anthropic(last_email(body) or TOOL_ROUND_FALLBACK)
        else:
            tool = pick_tool(req)
            args_json = tool_arguments(tool, email) if tool is not None else None
            if args_json is not None:
                parts = build_anthropic_tool(tool_name(tool), args_json, email)
            # No usable tool: parts stays None -> echo fallback below.
    elif MODE == 'echo-split':
        parts = build_echo_split(email)
    elif MODE == 'echo-last':
        parts = build_echo_last(email)
    elif MODE == 'echo-message':
        try:
            req = json.loads(body)
        except ValueError:
            req = {}
        text = last_user_text(req) or 'no-user-text'
        parts = build_echo_message(text)
    elif MODE in ('tool', 'tool-split'):
        try:
            req = json.loads(body)
        except ValueError:
            req = {}
        has_tool_round = any(
            isinstance(m, dict) and m.get('role') == 'tool'
            for m in (req.get('messages') or [])
        )
        # --prefer-tool deferral: MCP tools join the request's tools array
        # only AFTER the MCP server finishes connecting, which races round 1
        # (observed: round-1 body lacks the tool, round-2 has it). While the
        # preferred tool is absent, make a normal (round-forcing) tool call;
        # once it appears, call it exactly once, then fall back to echo.
        prefer = None
        if PREFER_TOOL:
            for t in (req.get('tools') or []):
                if tool_name(t) == PREFER_TOOL:
                    prefer = t
                    break
        if prefer is not None and not PREFER_STATE['called']:
            PREFER_STATE['called'] = True
            tool = prefer
        elif has_tool_round:
            tool = None  # terminal echo below
        else:
            tool = pick_tool(req)
        if tool is not None:
            args_json = tool_arguments(tool, email)
            if args_json is not None:
                name = (tool.get('function') or {}).get('name')
                if MODE == 'tool-split':
                    parts = build_tool_split(name, args_json, email)
                else:
                    parts = build_tool(name, args_json)
        if parts is None and has_tool_round:
            round_email = last_email(body) or TOOL_ROUND_FALLBACK
            parts = build_echo(round_email)
        # No usable tools: parts stays None -> plain echo fallback below.
    if parts is None:
        parts = build_anthropic(email) if MODE.startswith('anthropic') else build_echo(email)
    if MODE.startswith('anthropic'):
        # The Anthropic shape has no [DONE] frame; just concatenate (keep-alive
        # comments may still be interleaved when --keepalive is set).
        out = []
        if KEEPALIVE:
            out.append(keepalive())
        for i, p in enumerate(parts):
            if KEEPALIVE and i == 1:
                out.append(keepalive())
            out.append(p)
        return ''.join(out).encode()
    if REASONING:
        parts = [chunk({"role": "assistant",
                        "reasoning_content": email})] + parts
    return sse_body(parts)


class Handler(BaseHTTPRequestHandler):
    def do_POST(self):
        n = int(self.headers.get('content-length') or 0)
        body = self.rfile.read(n) if n else b''
        # Detect a second round-trip (after tool execution) for the log marker.
        marker = b''
        if MODE in ('tool', 'tool-split'):
            try:
                req = json.loads(body)
            except ValueError:
                req = {}
            if any(isinstance(m, dict) and m.get('role') == 'tool'
                   for m in (req.get('messages') or [])):
                marker = b'=== TOOL-ROUND ===\n'
        with open(LOG, 'ab') as f:
            f.write(marker + b'=== POST %s ===\n' % self.path.encode()
                    + body + b'\n')
        if 'chat/completions' in self.path or ('messages' in self.path and MODE.startswith('anthropic')):
            # Echo the LAST email in the request: under opencode-guard this is the
            # masked token registered in the current session's mapping, so the
            # http.response restore hook can swap it back to the original.
            sse = build_response(body)
            self.send_response(200)
            self.send_header('content-type', 'text/event-stream')
            self.send_header('content-length', str(len(sse)))
            self.end_headers()
            self.wfile.write(sse)
        else:
            self.send_response(404)
            self.end_headers()

    def do_GET(self):
        if self.path.rstrip('/').endswith('models'):
            data = json.dumps({"object": "list",
                               "data": [{"id": "probe", "object": "model"}]}).encode()
            self.send_response(200)
            self.send_header('content-type', 'application/json')
            self.send_header('content-length', str(len(data)))
            self.end_headers()
            self.wfile.write(data)
        else:
            self.send_response(404)
            self.end_headers()

    def log_message(self, *args):
        pass


if __name__ == '__main__':
    flags = []
    if CRLF:
        flags.append('crlf')
    if KEEPALIVE:
        flags.append('keepalive')
    if NO_DONE:
        flags.append('no-done')
    if REASONING:
        flags.append('reasoning')
    flag_str = (', flags ' + ','.join(flags)) if flags else ''
    print(f'capture server on 127.0.0.1:{PORT}, logging to {LOG}, '
          f'mode {MODE}{flag_str}')
    HTTPServer(('127.0.0.1', PORT), Handler).serve_forever()

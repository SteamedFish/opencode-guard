#!/usr/bin/env python3
"""Fake OpenAI-compatible provider that captures request bodies and echoes
the last email-looking value back in an SSE chat completion.

Used for end-to-end testing of opencode-guard: point a test provider at this
server, run `opencode run` against it, then inspect the capture log to prove
what did (masked) and did not (original) leave the machine.

Usage: capture-server.py [port] [capture-log-path] [--mode=MODE]
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
  echo-message  Stream the text of the LAST "role":"user" message back
              verbatim, split into 3 content chunks (no "echo: " prefix) -
              proves restore of non-email masked values (e.g. street
              addresses). Falls back to "no-user-text".
"""
import json
import re
import sys
from http.server import BaseHTTPRequestHandler, HTTPServer

args = sys.argv[1:]
PORT = int(args[0]) if len(args) > 0 else 15151
LOG = args[1] if len(args) > 1 else 'capture.log'
MODE = 'echo'
for a in args[2:]:
    if a.startswith('--mode='):
        MODE = a.split('=', 1)[1]

# Matches the masked forms of emails/tokens the plugin produces. Extend as needed.
EMAIL_RE = re.compile(rb'[\w.+-]+@[\w-]+\.[\w.]+')

FALLBACK_ECHO = 'nothing-found@example.com'
TOOL_ROUND_FALLBACK = 'tool-round-done@example.com'


def chunk(delta, finish=None):
    return "data: " + json.dumps({
        "id": "chatcmpl-capture", "object": "chat.completion.chunk",
        "created": 1789739000, "model": "probe",
        "choices": [{"index": 0, "delta": delta, "finish_reason": finish}],
    }) + "\n\n"


def sse_body(parts):
    return ("".join(parts) + "data: [DONE]\n\n").encode()


def last_email(body):
    emails = EMAIL_RE.findall(body)
    return emails[-1].decode() if emails else None


def pick_tool(req):
    """First tool named 'write', else 'bash', else the first tool. None if no tools."""
    tools = req.get('tools') or []
    if not tools:
        return None
    for want in ('write', 'bash'):
        for t in tools:
            if (t.get('function') or {}).get('name') == want:
                return t
    return tools[0]


def tool_arguments(tool, email):
    """Build the arguments JSON string for a tool_call, or None to fall back
    to plain echo text mode."""
    name = (tool.get('function') or {}).get('name')
    if name == 'write':
        return json.dumps({
            "filePath": "tool-probe-output.txt",
            "content": "captured secret: " + email,
        })
    if name == 'bash':
        return json.dumps({
            "command": "printf '%%s\\n' '%s' > tool-probe-output.txt" % email,
            "description": "write probe file",
        })
    # Best-effort for any other tool: first required string property from its
    # parameters schema, as a single-string-arg object.
    params = (tool.get('function') or {}).get('parameters') or {}
    props = params.get('properties') or {}
    for req_key in (params.get('required') or []):
        prop = props.get(req_key) or {}
        ptype = prop.get('type')
        if ptype in (None, 'string') and req_key:
            return json.dumps({req_key: email})
    return None


def build_echo(email):
    return sse_body([
        chunk({"role": "assistant", "content": "echo: " + email}),
        chunk({}, "stop"),
    ])


def build_echo_split(email):
    if len(email) < 4:
        return build_echo(email)
    half = len(email) // 2
    return sse_body([
        chunk({"role": "assistant", "content": "echo: " + email[:half]}),
        chunk({"content": email[half:] + "abcdef"}),
        chunk({}, "stop"),
    ])


def build_echo_last(email):
    return sse_body([
        chunk({"role": "assistant", "content": "working... "}),
        chunk({"content": "echo: " + email}),
        chunk({}, "stop"),
    ])


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
    return sse_body(parts)


def build_tool(name, arguments):
    return sse_body([
        chunk({"role": "assistant", "tool_calls": [{
            "index": 0, "id": "call_capture1", "type": "function",
            "function": {"name": name, "arguments": ""},
        }]}),
        chunk({"tool_calls": [{
            "index": 0, "function": {"arguments": arguments},
        }]}),
        chunk({}, "tool_calls"),
    ])


def build_response(body):
    """Return SSE bytes for the configured mode."""
    email = last_email(body) or FALLBACK_ECHO
    if MODE == 'echo-split':
        return build_echo_split(email)
    if MODE == 'echo-last':
        return build_echo_last(email)
    if MODE == 'echo-message':
        try:
            req = json.loads(body)
        except ValueError:
            req = {}
        text = last_user_text(req) or 'no-user-text'
        return build_echo_message(text)
    if MODE == 'tool':
        try:
            req = json.loads(body)
        except ValueError:
            req = {}
        has_tool_round = any(
            isinstance(m, dict) and m.get('role') == 'tool'
            for m in (req.get('messages') or [])
        )
        if has_tool_round:
            round_email = last_email(body) or TOOL_ROUND_FALLBACK
            return build_echo(round_email)
        tool = pick_tool(req)
        if tool is not None:
            args_json = tool_arguments(tool, email)
            if args_json is not None:
                return build_tool((tool.get('function') or {}).get('name'),
                                  args_json)
        # No usable tools: fall back to plain echo text mode.
    return build_echo(email)


class Handler(BaseHTTPRequestHandler):
    def do_POST(self):
        n = int(self.headers.get('content-length') or 0)
        body = self.rfile.read(n) if n else b''
        # Detect a second round-trip (after tool execution) for the log marker.
        marker = b''
        if MODE == 'tool':
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
        if 'chat/completions' in self.path:
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
    print(f'capture server on 127.0.0.1:{PORT}, logging to {LOG}, mode {MODE}')
    HTTPServer(('127.0.0.1', PORT), Handler).serve_forever()

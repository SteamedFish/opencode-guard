#!/usr/bin/env python3
"""Fake OpenAI-compatible provider that captures request bodies and echoes
the last email-looking value back in an SSE chat completion.

Used for end-to-end testing of opencode-guard: point a test provider at this
server, run `opencode run` against it, then inspect the capture log to prove
what did (masked) and did not (original) leave the machine.

Usage: capture-server.py [port] [capture-log-path]
Defaults: port 15151, log ./capture.log
"""
import json
import re
import sys
from http.server import BaseHTTPRequestHandler, HTTPServer

PORT = int(sys.argv[1]) if len(sys.argv) > 1 else 15151
LOG = sys.argv[2] if len(sys.argv) > 2 else 'capture.log'

# Matches the masked forms of emails/tokens the plugin produces. Extend as needed.
EMAIL_RE = re.compile(rb'[\w.+-]+@[\w-]+\.[\w.]+')


class Handler(BaseHTTPRequestHandler):
    def do_POST(self):
        n = int(self.headers.get('content-length') or 0)
        body = self.rfile.read(n) if n else b''
        with open(LOG, 'ab') as f:
            f.write(b'=== POST %s ===\n' % self.path.encode() + body + b'\n')
        if 'chat/completions' in self.path:
            emails = EMAIL_RE.findall(body)
            # Echo the LAST email in the request: under opencode-guard this is the
            # masked token registered in the current session's mapping, so the
            # http.response restore hook can swap it back to the original.
            echo = emails[-1].decode() if emails else 'nothing-found@example.com'

            def chunk(delta, finish=None):
                return "data: " + json.dumps({
                    "id": "chatcmpl-capture", "object": "chat.completion.chunk",
                    "created": 1789739000, "model": "probe",
                    "choices": [{"index": 0, "delta": delta, "finish_reason": finish}],
                }) + "\n\n"

            sse = (chunk({"role": "assistant", "content": "echo: " + echo})
                   + chunk({}, "stop") + "data: [DONE]\n\n").encode()
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
    print(f'capture server on 127.0.0.1:{PORT}, logging to {LOG}')
    HTTPServer(('127.0.0.1', PORT), Handler).serve_forever()

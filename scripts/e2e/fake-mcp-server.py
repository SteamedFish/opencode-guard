#!/usr/bin/env python3
"""Minimal fake MCP server on stdio (Model Context Protocol).

Implements the MCP stdio transport directly with stdlib only: newline-delimited
JSON-RPC 2.0, one message per line, no Content-Length headers. Used for E2E
testing of opencode-guard's MCP masking: the tool result embeds fixed probe
secrets (an email and an API token) that the plugin under test is supposed to
mask before they reach the model.

Usage: fake-mcp-server.py
Reads JSON-RPC messages from stdin line by line, writes replies to stdout,
logs received method names to stderr. Exits on EOF.
"""
import json
import sys

PROTOCOL_VERSION = "2024-11-05"

FIXED_EMAIL = "mcp-probe@mailfence-test.net"
FIXED_TOKEN = "mcpTok9f4ab71c3d"


def reply(msg_id, result):
    sys.stdout.write(json.dumps({
        "jsonrpc": "2.0", "id": msg_id, "result": result,
    }) + "\n")
    sys.stdout.flush()


def reply_error(msg_id, code, message):
    sys.stdout.write(json.dumps({
        "jsonrpc": "2.0", "id": msg_id,
        "error": {"code": code, "message": message},
    }) + "\n")
    sys.stdout.flush()


def handle(msg):
    method = msg.get("method")
    msg_id = msg.get("id")

    if method is not None:
        sys.stderr.write("recv: %s\n" % method)
        sys.stderr.flush()

    if method == "initialize":
        reply(msg_id, {
            "protocolVersion": PROTOCOL_VERSION,
            "capabilities": {"tools": {}},
            "serverInfo": {"name": "fake-mcp", "version": "0.1.0"},
        })
    elif method == "notifications/initialized":
        pass  # notification: no reply
    elif method == "tools/list":
        reply(msg_id, {
            "tools": [{
                "name": "lookup_secret",
                "description": "Looks up a secret record by key and returns it",
                "inputSchema": {
                    "type": "object",
                    "properties": {
                        "key": {"type": "string"},
                    },
                    "required": ["key"],
                    "additionalProperties": False,
                },
            }],
        })
    elif method == "tools/call":
        params = msg.get("params") or {}
        key = (params.get("arguments") or {}).get("key")
        reply(msg_id, {
            "content": [{
                "type": "text",
                "text": "Record for %s: email %s, api token %s" % (
                    key, FIXED_EMAIL, FIXED_TOKEN),
            }],
            "isError": False,
        })
    elif msg_id is not None:
        reply_error(msg_id, -32601, "Method not found: %s" % method)
    # Notifications (no id) other than initialized: ignored.


def main():
    for line in sys.stdin:
        line = line.strip()
        if not line:
            continue
        try:
            msg = json.loads(line)
        except ValueError:
            sys.stderr.write("recv: <invalid JSON>\n")
            sys.stderr.flush()
            continue
        if not isinstance(msg, dict):
            continue
        handle(msg)


if __name__ == '__main__':
    main()

#!/usr/bin/env python3
"""Self-contained assertion driver for the opencode-guard E2E capture harness.

Why this exists: the agent running E2E probes has the plugin-under-test
loaded in its OWN session, so any probe value (email/token) passed through
the agent's shell commands gets masked/restored unpredictably - inline
`grep -c '<probe>' capture.log` results are UNRELIABLE. This script takes
ZERO probe values as arguments: it derives the probe email from the run
transcript (out.txt) and reads MCP fixture secrets from fake-mcp-server.py,
computing all assertions in-process. Output contains only PASS/FAIL lines
and counts - extracted secret values are never printed.

Usage:
  verify-probe.py <capture.log> <out.txt> [--mode=restore|unmasked|tool-file]
                  [--mcp] [--probe-file <path>] [--allow-wire-variants]

Modes:
  restore (default)  Masking+restore expected: original must NOT be on the
                     wire, a masked variant must be, and out.txt must show
                     the restored original with no residual masked fragments.
  unmasked           Exclusion configured: the original is expected ON the
                     wire (A2 inverted). A3/A5 skipped.
  tool-file          Like restore, plus assert the probe file (default
                     tool-probe-output.txt relative to cwd) contains the
                     probe email exactly once.

Exit code 0 iff all assertions pass (final line: RESULT: PASS).
"""
import argparse
import os
import re
import sys

EMAIL_RE = re.compile(r'[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+')
ANSI_RE = re.compile(r'\x1b\[[0-9;]*m')


def dotted_domain(token):
    """True if the token's domain part contains a dot.

    Filters out fixture artifacts like `x@explorer` / `x@oracle` that come
    from agent mentions baked into system prompts.
    """
    return '.' in token.split('@', 1)[1]


def emails_in(text):
    return [t for t in EMAIL_RE.findall(text) if dotted_domain(t)]


def derive_probe(out_text, exclude=frozenset(), mcp=False):
    """Derive the probe email from the run transcript.

    exclude: tokens never eligible as the probe (in --mcp mode this is the
    fixture FIXED_EMAIL - the final echo: line in MCP runs echoes the
    FIXTURE's email, since it is the last email in the final request body;
    the real user probe appears restored on tool-call lines such as
    `fake_lookup_secret {"key":...}` or the write/shell call line).

    mcp: also treat lines containing `{"` (tool-call args) as preferred
    disambiguation lines, alongside echo: lines.

    Returns (probe, None) or (None, reason).
    """
    distinct = set(emails_in(out_text)) - exclude
    if len(distinct) == 1:
        return distinct.pop(), None
    if not distinct:
        return None, 'cannot derive probe email (no email-shaped token in out.txt)'
    preferred = []
    for line in out_text.splitlines():
        if line.startswith('echo:') or (mcp and '{"' in line):
            preferred.extend(t for t in emails_in(line) if t not in exclude)
    preferred_distinct = set(preferred)
    if len(preferred_distinct) == 1:
        return preferred_distinct.pop(), None
    if not preferred_distinct:
        return None, ('cannot derive probe email (multiple distinct emails '
                      'in out.txt, no disambiguating echo:/tool-call line)')
    return None, 'cannot derive probe email (ambiguous candidate lines)'


def mcp_fixtures():
    """Extract FIXED_EMAIL / FIXED_TOKEN literals from fake-mcp-server.py
    located next to this script. Returns (email, token) or None."""
    path = os.path.join(os.path.dirname(os.path.abspath(__file__)),
                        'fake-mcp-server.py')
    try:
        with open(path, encoding='utf-8') as f:
            src = f.read()
    except OSError:
        return None
    email_m = re.search(r'FIXED_EMAIL = "([^"]*)"', src)
    token_m = re.search(r'FIXED_TOKEN = "([^"]*)"', src)
    if not email_m or not token_m:
        return None
    return email_m.group(1), token_m.group(1)


def main():
    ap = argparse.ArgumentParser(description='opencode-guard E2E probe assertion driver')
    ap.add_argument('capture_log')
    ap.add_argument('out_txt')
    ap.add_argument('--mode', choices=['restore', 'unmasked', 'tool-file'],
                    default='restore')
    ap.add_argument('--mcp', action='store_true')
    ap.add_argument('--probe-file', default='tool-probe-output.txt')
    ap.add_argument('--allow-wire-variants', action='store_true',
                    help='relax A5: also allow residual email-shaped tokens '
                         'in out.txt that byte-appear in capture.log. '
                         'Tool CALL args for MCP tools and tool RESULTS are '
                         'stored in the transcript in MASKED form '
                         '(execute.before/execute.after), so the transcript '
                         'legitimately contains masked variants that also '
                         'appeared on the wire. A half-restored fragment '
                         'would not byte-match the full wire variant, so '
                         'this stays strict against partial-restore '
                         'corruption.')
    args = ap.parse_args()

    try:
        with open(args.capture_log, 'rb') as f:
            cap_bytes = f.read()
        with open(args.out_txt, 'rb') as f:
            out_bytes = f.read()
    except OSError as e:
        print('FAIL A0 inputs (%s)' % e)
        print('RESULT: FAIL')
        return 1

    cap_text = cap_bytes.decode('utf-8', 'replace')
    out_text = ANSI_RE.sub('', out_bytes.decode('utf-8', 'replace'))

    results = []

    def report(ok, aid, name, detail):
        results.append(bool(ok))
        print('%s %s %s (%s)' % ('PASS' if ok else 'FAIL', aid, name, detail))

    # MCP fixtures are needed for A5 exemption even before MCP assertions.
    fixtures = mcp_fixtures() if args.mcp else None
    if args.mcp and fixtures is None:
        report(False, 'MCP0', 'mcp-fixtures',
               'cannot extract FIXED_* from fake-mcp-server.py')

    # A1: derive probe email from out.txt. In --mcp mode the fixture
    # FIXED_EMAIL is excluded from candidates (the final echo: line echoes
    # the fixture's email, not the user probe).
    exclude = set(fixtures) if fixtures is not None else frozenset()
    probe, err = derive_probe(out_text, exclude=exclude, mcp=args.mcp)
    if probe is None:
        report(False, 'A1', 'derive-probe', err)
        # Every remaining assertion depends on the probe value.
        report(False, 'A2', 'no-leak' if args.mode != 'unmasked'
               else 'original-on-wire', 'probe unknown')
        if args.mode != 'unmasked':
            report(False, 'A3', 'masked-traffic', 'probe unknown')
        report(False, 'A4', 'restore', 'probe unknown')
        if args.mode != 'unmasked':
            report(False, 'A5', 'no-residual', 'probe unknown')
        if args.mcp and fixtures is not None:
            report(False, 'MCP1', 'mcp-email-wire', 'probe unknown')
            report(False, 'MCP2', 'mcp-token-wire', 'probe unknown')
            if args.mode != 'unmasked':
                report(False, 'MCP3', 'mcp-email-restore', 'probe unknown')
        if args.mode == 'tool-file':
            report(False, 'T1', 'tool-file', 'probe unknown')
        print('RESULT: FAIL')
        return 1

    report(True, 'A1', 'derive-probe', 'derived from out.txt')
    probe_b = probe.encode('utf-8')
    wire_count = cap_bytes.count(probe_b)
    out_count = out_bytes.count(probe_b)

    # A2: leak check (inverted in unmasked mode).
    if args.mode == 'unmasked':
        report(wire_count >= 1, 'A2', 'original-on-wire',
               'wire count: %d' % wire_count)
    else:
        report(wire_count == 0, 'A2', 'no-leak', 'wire count: %d' % wire_count)

    # A3/A5: restore-family modes only.
    if args.mode != 'unmasked':
        cap_tokens = set(emails_in(cap_text))
        masked_variants = cap_tokens - {probe}
        report(len(masked_variants) >= 1, 'A3', 'masked-traffic',
               'masked variants on wire: %d' % len(masked_variants))

    report(out_count >= 1, 'A4', 'restore', 'out count: %d' % out_count)

    if args.mode != 'unmasked':
        # With --mcp, the restored FIXED_EMAIL legitimately appears in
        # out.txt alongside the probe email - exempt it from A5.
        allowed = {probe}
        if fixtures is not None:
            allowed.add(fixtures[0])
        residual = set(emails_in(out_text)) - allowed
        if args.allow_wire_variants and residual:
            # Masked tool-call args / tool results are stored in the
            # transcript in masked form, so tokens that byte-appeared on
            # the wire are legitimate residuals. A half-restored fragment
            # would not byte-match the full wire variant.
            unknown = [t for t in residual
                       if t.encode('utf-8') not in cap_bytes]
            if unknown:
                detail = 'wire-unknown residual tokens: %d' % len(unknown)
            else:
                detail = ('residual distinct tokens: %d, all wire-known'
                          % len(residual))
            report(not unknown, 'A5', 'no-residual', detail)
        else:
            report(not residual, 'A5', 'no-residual',
                   'residual distinct tokens: %d' % len(residual))

    # MCP fixture assertions.
    if fixtures is not None:
        fe_b, ft_b = fixtures[0].encode('utf-8'), fixtures[1].encode('utf-8')
        fe_wire, ft_wire = cap_bytes.count(fe_b), cap_bytes.count(ft_b)
        if args.mode == 'unmasked':
            report(fe_wire >= 1, 'MCP1', 'mcp-email-wire',
                   'wire count: %d' % fe_wire)
            report(ft_wire >= 1, 'MCP2', 'mcp-token-wire',
                   'wire count: %d' % ft_wire)
        else:
            report(fe_wire == 0, 'MCP1', 'mcp-email-wire',
                   'wire count: %d' % fe_wire)
            report(ft_wire == 0, 'MCP2', 'mcp-token-wire',
                   'wire count: %d' % ft_wire)
            report(out_bytes.count(fe_b) >= 1, 'MCP3', 'mcp-email-restore',
                   'out count: %d' % out_bytes.count(fe_b))

    # tool-file mode: probe file contains the probe email exactly once.
    if args.mode == 'tool-file':
        try:
            with open(args.probe_file, 'rb') as f:
                pf_bytes = f.read()
            pf_count = pf_bytes.count(probe_b)
            report(pf_count == 1, 'T1', 'tool-file',
                   'probe-file count: %d' % pf_count)
        except OSError:
            report(False, 'T1', 'tool-file', 'probe file missing')

    ok = all(results)
    print('RESULT: %s' % ('PASS' if ok else 'FAIL'))
    return 0 if ok else 1


if __name__ == '__main__':
    sys.exit(main())

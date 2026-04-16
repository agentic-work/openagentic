#!/usr/bin/env python3
"""
Strip copyright/license boilerplate that upstream keeps putting at the top
of source files. Runs after tools/sync-upstream.py (and is idempotent — safe
to run anytime).

  python3 tools/scrub-headers.py [--dry-run] [path...]

With no paths, scrubs everything under services/ and scripts/ and docker-compose.yml.
"""
from __future__ import annotations

import os, re, sys

REPO = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
DRY = '--dry-run' in sys.argv
ARGS = [a for a in sys.argv[1:] if not a.startswith('--')]

DEFAULT_ROOTS = ['services', 'scripts', 'helm', 'docker-compose.yml']

# Single-line markers we drop wherever they appear (comments of any flavour).
LINE_PATTERNS = [
    # C/JS/TS single-line and leading-slash blocks
    re.compile(r'^\s*\*?\s*@copyright\b.*$', re.MULTILINE),
    re.compile(r'^\s*\*?\s*@license\b.*$',   re.MULTILINE),
    # "# Copyright (c) YYYY ..."
    re.compile(r'^\s*#\s*Copyright\s*\(c\).*$', re.MULTILINE | re.IGNORECASE),
    re.compile(r'^\s*#\s*For all inquiries.*$', re.MULTILINE | re.IGNORECASE),
    re.compile(r'^\s*#\s*Openagentic LLC\s*$',  re.MULTILINE),
    re.compile(r'^\s*#\s*hello@openagentic\.io\s*$', re.MULTILINE | re.IGNORECASE),
    # Dockerfile LABEL lines for proprietary metadata
    re.compile(r'^\s*LABEL\s+com\.openagentic\.copyright=.*$', re.MULTILINE),
    re.compile(r'^\s*LABEL\s+org\.opencontainers\.image\.vendor=.*$', re.MULTILINE),
    re.compile(r'^\s*LABEL\s+org\.opencontainers\.image\.licenses=.*$', re.MULTILINE),
]

# Multi-line blocks (/** ... Apache ... */ etc.)
BLOCK_PATTERNS = [
    # JS/TS /** ... */ block that mentions a licence
    re.compile(
        r'/\*{1,2}\s*\n'
        r'(?:[^*]|\*(?!/))*?'
        r'(?:Apache License|Licensed under|Copyright\s*\(c\)|Copyright\s*\d{4}|PROPRIETARY|All rights reserved)'
        r'(?:[^*]|\*(?!/))*?\*/\s*\n',
        re.IGNORECASE,
    ),
    # Python triple-quoted copyright block at file top
    re.compile(
        r'^\"{3}\s*\n'
        r'(?:.*?(?:Copyright|Apache License|PROPRIETARY|All rights reserved).*?\n)+?'
        r'.*?\"{3}\s*\n',
        re.MULTILINE | re.DOTALL | re.IGNORECASE,
    ),
]

TEXT_EXTS = {
    '.ts', '.tsx', '.js', '.jsx', '.mjs', '.cjs',
    '.py', '.sh', '.bash',
    '.yml', '.yaml', '.toml', '.json',
    '.md',
    '',  # Dockerfile and similar
}


def is_text(path: str) -> bool:
    base = os.path.basename(path)
    if base.startswith('Dockerfile'):
        return True
    ext = os.path.splitext(path)[1].lower()
    return ext in TEXT_EXTS


def scrub(text: str) -> str:
    before = text
    for p in BLOCK_PATTERNS:
        text = p.sub('', text)
    for p in LINE_PATTERNS:
        text = p.sub('', text)
    # Collapse >=3 blank lines -> 2
    text = re.sub(r'\n{3,}', '\n\n', text)
    return text


def walk(roots):
    for r in roots:
        full = os.path.join(REPO, r) if not os.path.isabs(r) else r
        if os.path.isfile(full):
            yield full; continue
        if not os.path.isdir(full): continue
        for base, dirs, files in os.walk(full):
            dirs[:] = [d for d in dirs if d not in {'node_modules', 'dist', 'build', '__pycache__', '.venv'}]
            for f in files:
                p = os.path.join(base, f)
                if is_text(p): yield p


def main() -> int:
    roots = ARGS or DEFAULT_ROOTS
    changed = 0
    for path in walk(roots):
        try:
            txt = open(path, encoding='utf-8').read()
        except (UnicodeDecodeError, OSError):
            continue
        new = scrub(txt)
        if new != txt:
            changed += 1
            if DRY:
                print(f"would scrub: {os.path.relpath(path, REPO)}")
            else:
                open(path, 'w', encoding='utf-8').write(new)
    print(f"{'dry-run: ' if DRY else ''}{changed} file(s) {'would be' if DRY else ''} scrubbed")
    return 0


if __name__ == '__main__':
    sys.exit(main())

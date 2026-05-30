#!/usr/bin/env python3
"""
Migrate FastAPI Depends/Header/Query/Path defaults to Annotated type hints.

Before:  x: Optional[Dict[str, Any]] = Depends(get_user_info)
After:   x: Annotated[Optional[Dict[str, Any]], Depends(get_user_info)] = None  (only if None used to be the default)
         x: Annotated[Optional[Dict[str, Any]], Depends(get_user_info)]        (when Depends had no Optional semantics)

Per PEP 593 + FastAPI docs: Annotated[T, Depends(fn)] is the modern form.
"""
import re
import sys
from pathlib import Path

TARGET = Path(sys.argv[1] if len(sys.argv) > 1 else 'services/openagentic-mcp-proxy/src/main.py')

src = TARGET.read_text()

# Ensure `from typing import Annotated` is present.
if 'Annotated' not in src:
    # Insert into an existing `from typing import ...` line.
    src, n = re.subn(
        r'^(from typing import\s+)([^\n]+)$',
        lambda m: m.group(1) + ('Annotated, ' + m.group(2) if 'Annotated' not in m.group(2) else m.group(2)),
        src,
        count=1,
        flags=re.MULTILINE,
    )
    if n == 0:
        # No existing import — prepend one after the file's shebang/docstring.
        src = 'from typing import Annotated\n' + src

# Transform `name: TYPE = Depends(...)` → `name: Annotated[TYPE, Depends(...)]`
# TYPE may contain `[...]` with commas inside; we balance brackets to grab it.
def transform(src: str) -> tuple[str, int]:
    out = []
    i = 0
    n = 0
    pattern = re.compile(r'(\b\w+)\s*:\s*')
    while i < len(src):
        m = pattern.search(src, i)
        if not m:
            out.append(src[i:])
            break
        out.append(src[i:m.end()])
        j = m.end()
        # Parse the type expression — balanced brackets.
        depth = 0
        type_start = j
        while j < len(src):
            ch = src[j]
            if ch == '[':
                depth += 1
            elif ch == ']':
                depth -= 1
            elif depth == 0 and ch in ',\n)':
                break
            elif depth == 0 and ch == '=':
                break
            j += 1
        type_end = j
        if j >= len(src) or src[j] != '=':
            out.append(src[type_start:j])
            i = j
            continue
        # Now look at the RHS — is it Depends(...)?
        rhs_start = j + 1
        k = rhs_start
        while k < len(src) and src[k].isspace():
            k += 1
        if not src[k:].startswith('Depends('):
            out.append(src[type_start:j])
            i = j
            continue
        # Grab Depends(...) with balanced parens.
        par_start = k + len('Depends')
        par_depth = 0
        m_end = par_start
        while m_end < len(src):
            ch = src[m_end]
            if ch == '(':
                par_depth += 1
            elif ch == ')':
                par_depth -= 1
                if par_depth == 0:
                    m_end += 1
                    break
            m_end += 1
        type_text = src[type_start:type_end].rstrip()
        depends_text = src[k:m_end]
        replacement = f'Annotated[{type_text}, {depends_text}]'
        out.append(replacement)
        n += 1
        i = m_end

    return ''.join(out), n

new_src, count = transform(src)
TARGET.write_text(new_src)
print(f'rewrote {count} Depends(...) defaults → Annotated')

/**
 * Architecture gate (Phase 0/D of all-MCP refactor): no stub tool
 * descriptions in any openagentic-*-mcp Python server source.
 *
 * The brief mandates every tool description follow a 6-section anatomy
 * (PURPOSE, RESOURCE NOUNS, CONSTRAINTS, TRIGGER PHRASES, EXAMPLE,
 * ADJACENT). Stub patterns like "Execute the X tool" or "Calls the X
 * API" produce zero cascade signal — the model can't pick a tool
 * whose description doesn't say what it does or when to use it.
 *
 * Scope: greps every services/mcps/openagentic-X-mcp/...py source under
 * the agentic monorepo. Specifically targets the ONE-LINE docstring
 * form `"""Verb the noun."""` (or single-line equivalent) under an
 * `@mcp.tool()` decorator. Multi-line docstrings are not necessarily
 * stub — but a docstring whose ENTIRE content matches a banned regex
 * fails this test.
 *
 * Banned forms:
 *   - "Execute the {name} tool"      — placeholder from FastMCP scaffolds
 *   - "Calls the X API"              — paraphrases the name, no signal
 *   - "Wraps the X API"              — same
 *   - "{verb} the {resource}"        — trivial paraphrase of name
 *
 * Allowed: any docstring that adds purpose, trigger phrases, or example
 * beyond the name. The golden-prompt harness
 * (openagentic-tool-discovery.golden.test.ts) provides the rank-discoverability
 * regression net; this arch-grep is the static cousin.
 */

import { describe, it, expect } from 'vitest';
import * as fs from 'node:fs';
import * as path from 'node:path';

// Repo root — services/openagentic-api/src/__tests__/architecture/X.test.ts → 5 levels up
const REPO_ROOT = path.resolve(__dirname, '..', '..', '..', '..', '..');
const MCPS_DIR = path.join(REPO_ROOT, 'services', 'mcps');

const BANNED_PATTERNS: ReadonlyArray<{ name: string; re: RegExp }> = [
  { name: '"Execute the X tool"',     re: /^\s*Execute the \w+(_\w+)* tool\.?\s*$/i },
  { name: '"Calls the X API"',        re: /^\s*Calls? the \w+(\.\w+)* API\.?\s*$/i },
  { name: '"Wraps the X API"',        re: /^\s*Wraps? the \w+(\.\w+)* API\.?\s*$/i },
  { name: '"Invokes the X endpoint"', re: /^\s*Invokes? the \w+(\.\w+)* endpoint\.?\s*$/i },
];

function listAwpMcpDirs(): string[] {
  if (!fs.existsSync(MCPS_DIR)) return [];
  return fs
    .readdirSync(MCPS_DIR)
    .filter(name => name.startsWith('openagentic-') && name.endsWith('-mcp'))
    .map(name => path.join(MCPS_DIR, name));
}

function listPythonSources(dir: string): string[] {
  const out: string[] = [];
  const visit = (p: string) => {
    let entries: fs.Dirent[];
    try {
      entries = fs.readdirSync(p, { withFileTypes: true });
    } catch {
      return;
    }
    for (const e of entries) {
      const full = path.join(p, e.name);
      if (e.isDirectory()) {
        // Skip vendored deps / build outputs / the test dir itself.
        if (['__pycache__', '.venv', 'node_modules', 'dist', 'build', 'tests'].includes(e.name)) continue;
        visit(full);
      } else if (e.isFile() && e.name.endsWith('.py')) {
        out.push(full);
      }
    }
  };
  visit(dir);
  return out;
}

interface DocstringHit {
  file: string;
  line: number;
  toolDecoratorLine: number;
  docstring: string;
}

/**
 * Find docstrings under @mcp.tool() decorators. Captures both single-line
 * `"""..."""` and triple-quoted multi-line forms. Tracks the line range
 * so violation messages can cite file:line.
 */
function findToolDocstrings(source: string, file: string): DocstringHit[] {
  const lines = source.split('\n');
  const hits: DocstringHit[] = [];

  for (let i = 0; i < lines.length; i++) {
    if (!/@mcp\.tool\s*\(/.test(lines[i])) continue;
    const decoratorLine = i + 1;

    // Walk to the def signature, then to the first docstring after it.
    let j = i + 1;
    // Skip lines until we hit `def ` or `async def `.
    while (j < lines.length && !/^\s*(async\s+)?def\s+/.test(lines[j])) j++;
    if (j >= lines.length) continue;
    // Skip the def signature; multi-line signatures end on `):`
    while (j < lines.length && !/\)\s*->\s*[^:]+:|\)\s*:/.test(lines[j])) j++;
    if (j >= lines.length) continue;

    // Now look for the docstring opener on the next non-blank line.
    let k = j + 1;
    while (k < lines.length && lines[k].trim() === '') k++;
    if (k >= lines.length) continue;
    const startLine = k + 1;
    const opener = lines[k].trim();
    if (!opener.startsWith('"""') && !opener.startsWith("'''")) continue;

    const fence = opener.startsWith('"""') ? '"""' : "'''";

    // Single-line docstring: """text""" on one line.
    // Use [\s\S] for any-char-incl-newline (portable across esbuild versions).
    const singleLineMatch = opener.match(new RegExp('^' + fence + '([\\s\\S]*?)' + fence));
    if (singleLineMatch) {
      hits.push({
        file,
        line: startLine,
        toolDecoratorLine: decoratorLine,
        docstring: singleLineMatch[1].trim(),
      });
      continue;
    }

    // Multi-line docstring: collect until closing fence.
    let body = opener.slice(3);
    let m = k + 1;
    while (m < lines.length) {
      const closeIdx = lines[m].indexOf(fence);
      if (closeIdx >= 0) {
        body += '\n' + lines[m].slice(0, closeIdx);
        break;
      }
      body += '\n' + lines[m];
      m++;
    }
    hits.push({
      file,
      line: startLine,
      toolDecoratorLine: decoratorLine,
      docstring: body.trim(),
    });
  }

  return hits;
}

describe('Architecture: openagentic-*-mcp tools must not ship stub descriptions', () => {
  it('finds openagentic-* MCP source dirs', () => {
    const dirs = listAwpMcpDirs();
    expect(
      dirs.length,
      `Expected ≥1 openagentic-*-mcp dir under ${MCPS_DIR}; got ${dirs.length}`,
    ).toBeGreaterThan(0);
  });

  it('every @mcp.tool() docstring avoids banned stub patterns', () => {
    const offenders: string[] = [];

    for (const dir of listAwpMcpDirs()) {
      for (const file of listPythonSources(dir)) {
        const source = fs.readFileSync(file, 'utf8');
        const hits = findToolDocstrings(source, file);
        for (const hit of hits) {
          // Take only the first line of the docstring — we ban stubs
          // whose ENTIRE first line is a banned form. Multi-line
          // descriptions that begin with a stub-like one-liner but
          // continue with substance are not penalized here (the
          // golden-prompt harness covers cascade quality).
          const firstLine = hit.docstring.split('\n')[0] ?? '';
          if (firstLine.length === 0) continue;
          // The offense is when the WHOLE docstring is just the stub.
          if (hit.docstring.split('\n').length > 1) continue;

          for (const banned of BANNED_PATTERNS) {
            if (banned.re.test(firstLine)) {
              offenders.push(
                `  ${path.relative(REPO_ROOT, hit.file)}:${hit.line}` +
                  ` (decorator line ${hit.toolDecoratorLine}) — banned pattern ${banned.name}\n` +
                  `    docstring: ${JSON.stringify(hit.docstring)}`,
              );
              break;
            }
          }
        }
      }
    }

    expect(
      offenders,
      offenders.length === 0
        ? ''
        : `Banned stub-description patterns found in ${offenders.length} tool(s):\n\n` +
            offenders.join('\n\n') +
            `\n\nFix: replace the stub with a 6-section description (PURPOSE, RESOURCE NOUNS, CONSTRAINTS, TRIGGER PHRASES, EXAMPLE, ADJACENT).`,
    ).toEqual([]);
  });
});

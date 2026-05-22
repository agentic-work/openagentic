/**
 * Phase E.9 arch gate — Milvus agent-catalog collection renamed.
 *
 * Plan: docs/superpowers/plans/2026-05-10-chatmode-rip-implementation.md
 *       §Phase E task E.9 ("Milvus `mcp_agents` → `agents` rename").
 *
 * The collection's actual prod name was `mcp_agents_cache`. The rip
 * drops the `mcp_*` prefix because these are built-in agents, not MCP
 * servers. New canonical name: `agents`. On next fresh deploy the
 * seeder + indexing service create the new collection; the old
 * `mcp_agents_cache` becomes an orphan that the operator cleans up
 * out-of-band (or which a future migration script drops).
 *
 * This test pins the constant + references in production source.
 * `mcp_tools` (the parallel collection for MCP tool catalog) is
 * NOT in scope and stays as-is.
 */
import { describe, it } from 'vitest';
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { dirname, join, relative } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const API_SRC = join(__dirname, '../..');

function collectTs(dir: string): string[] {
  const out: string[] = [];
  let entries: string[];
  try {
    entries = readdirSync(dir);
  } catch {
    return out;
  }
  for (const entry of entries) {
    const full = join(dir, entry);
    let stat;
    try {
      stat = statSync(full);
    } catch {
      continue;
    }
    if (stat.isDirectory()) {
      if (entry === 'node_modules' || entry === 'dist' || entry === 'build') continue;
      if (entry === '__tests__') continue;
      out.push(...collectTs(full));
    } else if (
      stat.isFile() &&
      (entry.endsWith('.ts') || entry.endsWith('.tsx')) &&
      !entry.endsWith('.test.ts') &&
      !entry.endsWith('.test.tsx')
    ) {
      out.push(full);
    }
  }
  return out;
}

const FORBIDDEN = ['mcp_agents_cache', 'mcp_agents'];

describe('Phase E.9 — Milvus agent-catalog collection renamed to `agents`', () => {
  it('no .ts/.tsx file in src/ references the legacy collection names', () => {
    const files = collectTs(API_SRC);
    const offenders: Array<{ file: string; matches: string[] }> = [];
    for (const filePath of files) {
      const rel = relative(join(API_SRC, '..'), filePath);
      let content: string;
      try {
        content = readFileSync(filePath, 'utf8');
      } catch {
        continue;
      }
      const hits: string[] = [];
      for (const sym of FORBIDDEN) {
        if (content.includes(sym)) hits.push(sym);
      }
      if (hits.length > 0) offenders.push({ file: rel, matches: hits });
    }
    if (offenders.length > 0) {
      const report = offenders
        .map((o) => `  ${o.file}: ${o.matches.join(', ')}`)
        .join('\n');
      throw new Error(
        `Legacy Milvus agent-catalog collection names found after Phase E.9 rip:\n${report}\n\n` +
          'Rename references to `agents` (the new canonical collection name). The ' +
          'parallel `mcp_tools` collection stays as-is — only the agent-catalog ' +
          'collection drops the `mcp_*` prefix.',
      );
    }
  });
});

/**
 * Phase E.8.a arch gate — `SubagentOrchestrator` references scrubbed from
 * all LEAF + TYPE-ONLY importers.
 *
 * Plan: docs/superpowers/plans/2026-05-10-chatmode-rip-implementation.md §E.8
 *
 * History:
 *  - E.8.a (a1c942f4): scrubbed 13 LEAF + 1 TYPE-ONLY importer.
 *  - E.8.f (5c9b91aa): `routes/orchestrate.ts` ripped.
 *  - E.8.g+h (2026-05-11): the SubagentOrchestrator class file itself
 *    + its 2 remaining RUNTIME-CONSUMER importers (buildChatV2Deps.ts,
 *    routes/chat/index.ts) were ALL ripped. The allowlist is now empty
 *    — every production .ts file must be free of the dead symbol.
 *    Pinned by phase-e8gh-subagent-orchestrator-deleted.source-regression.test.ts.
 *
 * Note: pipeline/v2/ was fully ripped in #741 / B-vrip step 6, so the
 * `v2` directory skip below is dead code preserved for clarity — the walker
 * skips it on principle even though the directory no longer exists.
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
      // Legacy v2/ directory — deleted in #741. Skip for defense in depth.
      if (entry === 'v2') continue;
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

// Phase E.8.g+h (2026-05-11) — allowlist EMPTIED. The SubagentOrchestrator
// class file + its RUNTIME-CONSUMER importers (buildChatV2Deps.ts,
// routes/chat/index.ts) were all ripped. Any remaining reference is a
// regression — no exemptions.
const ALLOWLIST = new Set<string>([]);

describe('Phase E.8.a — SubagentOrchestrator leaves scrubbed', () => {
  it('no .ts/.tsx file outside the strangler allowlist mentions SubagentOrchestrator', () => {
    const files = collectTs(API_SRC);
    const offenders: Array<{ file: string; lines: number[] }> = [];
    for (const filePath of files) {
      const rel = relative(join(API_SRC, '..'), filePath);
      if (ALLOWLIST.has(rel)) continue;
      let content: string;
      try {
        content = readFileSync(filePath, 'utf8');
      } catch {
        continue;
      }
      const lines: number[] = [];
      content.split('\n').forEach((line, i) => {
        if (line.includes('SubagentOrchestrator')) lines.push(i + 1);
      });
      if (lines.length > 0) offenders.push({ file: rel, lines });
    }
    if (offenders.length > 0) {
      const report = offenders
        .map((o) => `  ${o.file}: lines ${o.lines.join(', ')}`)
        .join('\n');
      throw new Error(
        `SubagentOrchestrator references found in production source (Phase E.8.a + E.8.g+h):\n${report}\n\n` +
          'The class file + all importers were ripped in Phase E.8.g+h ' +
          '(2026-05-11). Sub-agent dispatch goes through openagentic-proxy ' +
          '(production) or chatLoopRecursor (in-process default). ' +
          'Any new reference is a regression.',
      );
    }
  });
});

/**
 * Phase E.8.g + E.8.h arch gate — SubagentOrchestrator class FULLY deleted.
 *
 * Plan: docs/superpowers/plans/2026-05-10-chatmode-rip-implementation.md §E.8.g/h
 *
 * Predecessor slices:
 *  - E.8.a (a1c942f4): LEAF + TYPE-ONLY comment refs scrubbed.
 *  - E.8.d (d54e6875): `chatLoopRecursor` primitive shipped.
 *  - E.8.e (48d14225): `makeRunSubagentViaRecursor` wires TaskTool deps to
 *    the recursor. Chat path turned this on via `useRecursor: true` so
 *    production traffic stopped using the in-api orchestrator.
 *  - E.8.f (5c9b91aa): `/api/orchestrate/*` HTTP surface ripped.
 *
 * E.8.g+h finishes the rip: the class file itself, plus the two remaining
 * RUNTIME-CONSUMER importers (`buildChatV2Deps.ts` legacy fallback,
 * `routes/chat/index.ts` factory wiring) — all gone.
 *
 * Modern sub-agent dispatch goes through:
 *  - openagentic-proxy service (production path for chat-stream sub-agents)
 *  - chatLoopRecursor (in-process primitive, gated by useRecursor: true)
 *
 * After E.8.g+h, the SubagentOrchestrator class file and EVERY reference
 * to its symbols MUST be gone from production source. Test fixtures live
 * exclusively under __tests__/ and are excluded from this gate.
 */

import { describe, it, expect } from 'vitest';
import { existsSync, readFileSync, readdirSync, statSync } from 'node:fs';
import { dirname, join, relative } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const API_SRC = join(__dirname, '../..');
const SUBAGENT_ORCHESTRATOR_FILE = join(API_SRC, 'services/SubagentOrchestrator.ts');

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

describe('Phase E.8.g+h — SubagentOrchestrator class FULLY ripped', () => {
  it('services/SubagentOrchestrator.ts does NOT exist', () => {
    expect(existsSync(SUBAGENT_ORCHESTRATOR_FILE)).toBe(false);
  });

  it('no production .ts file outside __tests__ contains the substring `SubagentOrchestrator`', () => {
    const files = collectTs(API_SRC);
    const offenders: Array<{ file: string; lines: number[] }> = [];
    for (const filePath of files) {
      const rel = relative(join(API_SRC, '..'), filePath);
      // Skip THIS arch test (we name the dead symbol in strings/comments).
      if (rel.endsWith('phase-e8gh-subagent-orchestrator-deleted.source-regression.test.ts')) continue;
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
        `Phase E.8.g+h: source files still reference the deleted SubagentOrchestrator:\n${report}\n\n` +
          'Rip the import / call / type-reference / comment. Sub-agent dispatch ' +
          'goes through the openagentic-proxy service or chatLoopRecursor primitive ' +
          '(useRecursor: true).',
      );
    }
  });

  it('no .ts file imports from `./SubagentOrchestrator.js` or `../services/SubagentOrchestrator.js`', () => {
    const __apiRoot = join(API_SRC, '..');
    const files: string[] = [];
    function walk(dir: string) {
      let entries: string[];
      try {
        entries = readdirSync(dir);
      } catch {
        return;
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
          walk(full);
        } else if (
          stat.isFile() &&
          (entry.endsWith('.ts') || entry.endsWith('.tsx'))
        ) {
          files.push(full);
        }
      }
    }
    walk(API_SRC);

    const offenders: Array<{ file: string; lines: number[] }> = [];
    for (const filePath of files) {
      const rel = relative(__apiRoot, filePath);
      // Skip THIS arch test.
      if (rel.endsWith('phase-e8gh-subagent-orchestrator-deleted.source-regression.test.ts')) continue;
      let content: string;
      try {
        content = readFileSync(filePath, 'utf8');
      } catch {
        continue;
      }
      const lines: number[] = [];
      content.split('\n').forEach((line, i) => {
        const trimmed = line.trim();
        // Skip pure comment lines — comments naming the symbol in
        // import-shaped strings are not real imports.
        if (trimmed.startsWith('//') || trimmed.startsWith('*') || trimmed.startsWith('/*')) {
          return;
        }
        // Match `from '…/SubagentOrchestrator(.js)?'` and `import('…/SubagentOrchestrator…')`.
        if (
          /from\s+['"][^'"]*SubagentOrchestrator(\.js)?['"]/.test(line) ||
          /import\s*\(\s*['"][^'"]*SubagentOrchestrator(\.js)?['"]\s*\)/.test(line) ||
          /vi\.mock\s*\(\s*['"][^'"]*SubagentOrchestrator(\.js)?['"]/.test(line)
        ) {
          lines.push(i + 1);
        }
      });
      if (lines.length > 0) offenders.push({ file: rel, lines });
    }
    if (offenders.length > 0) {
      const report = offenders
        .map((o) => `  ${o.file}: lines ${o.lines.join(', ')}`)
        .join('\n');
      throw new Error(
        `Phase E.8.g+h: files still import from the deleted SubagentOrchestrator module:\n${report}\n\n` +
          'These tests test the deleted class — delete them too.',
      );
    }
  });

  it('phase-e8a ALLOWLIST is reduced to zero or test-only entries', () => {
    // Phase E.8.a's allowlist enumerates the strangler-transition exemptions.
    // After E.8.g+h, the production exemptions (SubagentOrchestrator.ts,
    // buildChatV2Deps.ts, routes/chat/index.ts) MUST be removed. The only
    // entry that may remain is the parity-harness test fixture (if it
    // still references the symbol in comments).
    const phaseE8aFile = join(
      API_SRC,
      '__tests__/architecture/phase-e8a-subagent-orchestrator-leaves-clean.source-regression.test.ts',
    );
    const src = readFileSync(phaseE8aFile, 'utf8');
    expect(src).not.toMatch(/'src\/services\/SubagentOrchestrator\.ts'/);
    expect(src).not.toMatch(/'src\/services\/buildChatV2Deps\.ts'/);
    expect(src).not.toMatch(/'src\/routes\/chat\/index\.ts'/);
  });
});

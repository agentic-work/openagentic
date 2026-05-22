/**
 * Phase E.8.f arch gate — `/api/orchestrate/*` HTTP surface fully ripped.
 *
 * Plan: docs/superpowers/plans/2026-05-10-chatmode-rip-implementation.md §E.8.f
 *
 * The legacy `/api/orchestrate/*` Fastify route file (`src/routes/orchestrate.ts`)
 * is a V2-era surface that wrapped the in-api SubagentOrchestrator via
 * `createSubagentOrchestrator()`. Modern sub-agent dispatch now goes through:
 *  - openagentic-proxy service (production path for chat-stream sub-agents)
 *  - chatLoopRecursor (the new in-process primitive, landed at d54e6875, wired
 *    at 48d14225)
 *
 * After E.8.f, the route file MUST be gone and no other source file may
 * reference the deleted module path (`routes/orchestrate.js`) nor the bare
 * export symbol (`orchestrateRoutes`).
 *
 * Out of scope (intentionally NOT asserted here):
 *  - The SubagentOrchestrator class itself (`src/services/SubagentOrchestrator.ts`)
 *    is ripped in E.8.g/h.
 *  - Comment-only references to "legacy /api/orchestrate" inside service files
 *    are stale-doc, harmless, and out-of-scope for this slice.
 *  - The openagentic-proxy service exposes its own `/api/orchestrate` surface on a
 *    different process — that is NOT this route file and is unaffected.
 */

import { describe, it, expect } from 'vitest';
import { existsSync, readFileSync, readdirSync, statSync } from 'node:fs';
import { dirname, join, relative } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const API_SRC = join(__dirname, '../..');
const ORCHESTRATE_ROUTE_FILE = join(API_SRC, 'routes/orchestrate.ts');

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
      out.push(...collectTs(full));
    } else if (
      stat.isFile() &&
      (entry.endsWith('.ts') || entry.endsWith('.tsx'))
    ) {
      out.push(full);
    }
  }
  return out;
}

describe('Phase E.8.f — /api/orchestrate/* route fully ripped', () => {
  it('src/routes/orchestrate.ts does NOT exist', () => {
    expect(existsSync(ORCHESTRATE_ROUTE_FILE)).toBe(false);
  });

  it('no .ts/.tsx file outside __tests__ imports from "../routes/orchestrate" or "routes/orchestrate.js"', () => {
    const files = collectTs(API_SRC);
    const offenders: Array<{ file: string; lines: number[] }> = [];
    for (const filePath of files) {
      const rel = relative(join(API_SRC, '..'), filePath);
      // Skip test files — historical fixtures may name-reference the dead module
      // in comments; they are not production imports.
      if (rel.includes('__tests__/')) continue;
      // Skip THIS arch-test file itself (we name the dead path as a string).
      if (rel.endsWith('phase-e8f-no-orchestrate-route.source-regression.test.ts')) continue;
      let content: string;
      try {
        content = readFileSync(filePath, 'utf8');
      } catch {
        continue;
      }
      const lines: number[] = [];
      content.split('\n').forEach((line, i) => {
        // Match import paths only — not bare comment mentions inside other
        // service files (those are out-of-scope per the slice header).
        if (
          line.includes("from '../routes/orchestrate") ||
          line.includes('from "../routes/orchestrate') ||
          line.includes("from './routes/orchestrate") ||
          line.includes('from "./routes/orchestrate') ||
          line.includes('routes/orchestrate.js') ||
          line.includes('routes/orchestrate.ts')
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
        `Phase E.8.f: source files still reference the deleted routes/orchestrate module:\n${report}\n\n` +
          'Rip the import + the register(orchestrateRoutes) call from the workflows plugin ' +
          'and any other importer.',
      );
    }
  });

  it('no .ts/.tsx file outside __tests__ contains the exported symbol `orchestrateRoutes` as code (not comment)', () => {
    const files = collectTs(API_SRC);
    const offenders: Array<{ file: string; lines: number[] }> = [];
    for (const filePath of files) {
      const rel = relative(join(API_SRC, '..'), filePath);
      if (rel.includes('__tests__/')) continue;
      if (rel.endsWith('phase-e8f-no-orchestrate-route.source-regression.test.ts')) continue;
      let content: string;
      try {
        content = readFileSync(filePath, 'utf8');
      } catch {
        continue;
      }
      const lines: number[] = [];
      content.split('\n').forEach((line, i) => {
        const trimmed = line.trim();
        // Skip pure comment lines (// or * or /*).
        if (trimmed.startsWith('//') || trimmed.startsWith('*') || trimmed.startsWith('/*')) {
          return;
        }
        // The bare symbol — as identifier, not inside a comment, not as a
        // substring of another word. Match word boundary on both sides.
        if (/\borchestrateRoutes\b/.test(line)) {
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
        `Phase E.8.f: source files still contain code-level references to \`orchestrateRoutes\`:\n${report}\n\n` +
          'Rip the import + the register call. Comment-only mentions in service files ' +
          'are intentionally allowed (out-of-scope for this slice).',
      );
    }
  });
});

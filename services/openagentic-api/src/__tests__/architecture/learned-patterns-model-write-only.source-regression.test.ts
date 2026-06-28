/**
 * Arch — learned_patterns is MODEL-WRITE-ONLY.
 *
 * Spec: user direction 2026-05-11. The pattern memory is curated by the
 * MODEL (via the pattern_save T1 tool) — NEVER auto-written by the chatLoop
 * or any background process. This isolates the "useful pattern" judgement
 * to the model itself and prevents the index from getting polluted with
 * trivial 1-tool lookups or partial failures.
 *
 * Pin guarantees:
 *   1. `LearnedPatternsService.save(` is only called from
 *      `PatternSaveTool.ts`. Any other caller is a regression.
 *   2. `chatLoop.ts` does NOT reference the LearnedPatternsService at all.
 *   3. Both `pattern_save` and `pattern_recall` appear in the T1 catalog
 *      source (`toolRegistry.ts`).
 *
 * This is a source-text regression test — fast, no runtime imports.
 */
import { describe, it, expect } from 'vitest';
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join, dirname, relative } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const SERVICES_DIR = join(__dirname, '..', '..', 'services');
const ROUTES_DIR = join(__dirname, '..', '..', 'routes');
const REPO_SRC_ROOT = join(__dirname, '..', '..');

const ALLOWED_SAVE_CALLERS = new Set([
  'services/PatternSaveTool.ts',
  // Tests are allowed too — they import the service directly to verify it.
]);

/** Walk a directory recursively, returning every .ts file absolute path. */
function walkTs(dir: string, acc: string[] = []): string[] {
  for (const entry of readdirSync(dir)) {
    const full = join(dir, entry);
    const st = statSync(full);
    if (st.isDirectory()) {
      if (entry === 'node_modules' || entry === '__tests__' || entry === 'dist')
        continue;
      walkTs(full, acc);
    } else if (entry.endsWith('.ts') && !entry.endsWith('.test.ts')) {
      acc.push(full);
    }
  }
  return acc;
}

describe('arch — learned_patterns is model-write-only', () => {
  it('LearnedPatternsService.save( is only called from PatternSaveTool.ts', () => {
    const files = [...walkTs(SERVICES_DIR), ...walkTs(ROUTES_DIR)];
    const offenders: string[] = [];
    for (const f of files) {
      const src = readFileSync(f, 'utf8');
      // Skip the service itself — internal `this.save(` references don't count.
      const rel = relative(REPO_SRC_ROOT, f).replace(/\\/g, '/');
      if (rel.endsWith('LearnedPatternsService.ts')) continue;

      // We're looking for any call site that resolves the singleton and
      // invokes .save(.  This catches `getLearnedPatternsService(...).save(`
      // AND `svc.save(` after a singleton bind.
      const usesService =
        src.includes('getLearnedPatternsService') ||
        src.includes('LearnedPatternsService');
      if (!usesService) continue;
      const callsSave =
        /getLearnedPatternsService\([^)]*\)\.save\(/.test(src) ||
        /\bsvc\.save\(/.test(src);
      if (!callsSave) continue;
      if (!ALLOWED_SAVE_CALLERS.has(rel)) {
        offenders.push(rel);
      }
    }
    expect(offenders, `LearnedPatternsService.save(...) may only be called from PatternSaveTool. Found extra callers: ${offenders.join(', ')}`).toEqual([]);
  });

  it('chatLoop.ts has zero references to LearnedPatternsService', () => {
    const chatLoopPath = join(
      __dirname,
      '..',
      '..',
      'routes',
      'chat',
      'pipeline',
      'chat',
      'chatLoop.ts',
    );
    const src = readFileSync(chatLoopPath, 'utf8');
    expect(src).not.toMatch(/LearnedPatternsService/);
    expect(src).not.toMatch(/getLearnedPatternsService/);
    expect(src).not.toMatch(/learned_patterns/);
  });

  it('T1 catalog source includes both PATTERN_SAVE_TOOL and PATTERN_RECALL_TOOL', () => {
    const regPath = join(
      __dirname,
      '..',
      '..',
      'routes',
      'chat',
      'pipeline',
      'chat',
      'toolRegistry.ts',
    );
    const src = readFileSync(regPath, 'utf8');
    expect(src).toMatch(/PATTERN_SAVE_TOOL/);
    expect(src).toMatch(/PATTERN_RECALL_TOOL/);
    // Both must appear in the return array (between `return [` and `]`).
    const returnStart = src.indexOf('return [', src.indexOf('export function getAllBaseTools'));
    const returnEnd = src.indexOf('];', returnStart);
    const returnBlock = src.slice(returnStart, returnEnd);
    expect(returnBlock).toMatch(/PATTERN_SAVE_TOOL/);
    expect(returnBlock).toMatch(/PATTERN_RECALL_TOOL/);
  });

  it('PatternSaveTool.ts DLP-scans BEFORE invoking the service', () => {
    const filePath = join(
      __dirname,
      '..',
      '..',
      'services',
      'PatternSaveTool.ts',
    );
    const src = readFileSync(filePath, 'utf8');
    // Boundary discipline: getDLPScanner must be imported and scanAndAct
    // must be called before any save() call.
    expect(src).toMatch(/getDLPScanner/);
    expect(src).toMatch(/scanAndAct/);
    const dlpCallIdx = src.indexOf('scanAndAct');
    const saveCallIdx = src.indexOf('.save(');
    expect(dlpCallIdx, 'scanAndAct must appear in PatternSaveTool source').toBeGreaterThan(-1);
    expect(saveCallIdx, 'save() must appear in PatternSaveTool source').toBeGreaterThan(-1);
    expect(dlpCallIdx).toBeLessThan(saveCallIdx);
  });

  it('PatternRecallTool.ts does NOT call save (read-only primitive)', () => {
    const filePath = join(
      __dirname,
      '..',
      '..',
      'services',
      'PatternRecallTool.ts',
    );
    const src = readFileSync(filePath, 'utf8');
    expect(src).not.toMatch(/\.save\(/);
    expect(src).toMatch(/\.recall\(/);
  });
});

/**
 * Architecture pin — A1 (rip dead opcode emits).
 *
 * the design notes
 *       Phase 2.1.4 — "Rip dead opcode emits".
 *
 * The dual-wire protocol (named frame + Vercel-AI-SDK opcode character)
 * was the V3 transition plan, but the UI's useChatStream never grew the
 * opcode reducer arms (`case '0':`, `case 'e':`, etc.) — see
 * `wire-frame-name-parity.source-regression.test.ts`. The opcode emits
 * are dead bytes on the wire.
 *
 * This test pins the post-rip invariant:
 *   1. Zero `ctx.emit(OPCODES.X, ...)` callsites anywhere under src/.
 *   2. Zero `ctx.emit('0' | '2' | '3' | '4' | 'e', ...)` bare-character
 *      callsites — the audit caught one in ComposeVisualTool.ts:917.
 *   3. The `OPCODES` symbol table + ndjsonOpcodes.ts file are gone.
 *
 * Once green, the UI is the sole consumer authority for wire frame
 * names; the source-of-truth lives in useChatStream's switch.
 */
import { describe, it, expect } from 'vitest';
import { readdirSync, readFileSync, statSync, existsSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
const API_SRC_ROOT = resolve(__dirname, '../..');
const NDJSON_OPCODES_PATH = join(
  API_SRC_ROOT,
  'routes/chat/pipeline/chat/ndjsonOpcodes.ts',
);

function walkTs(dir: string): string[] {
  const out: string[] = [];
  let entries: any[];
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
      if (entry === '__tests__' || entry === 'node_modules' || entry === 'dist' || entry === 'tests') continue;
      out.push(...walkTs(full));
    } else if (
      stat.isFile() &&
      entry.endsWith('.ts') &&
      !entry.endsWith('.test.ts') &&
      !entry.endsWith('.d.ts')
    ) {
      out.push(full);
    }
  }
  return out;
}

describe('arch — no opcode emits (A1)', () => {
  const apiFiles = walkTs(API_SRC_ROOT);

  it('no production file in src/ calls ctx.emit(OPCODES.X, ...)', () => {
    const hits: Array<{ file: string; line: number; snippet: string }> = [];
    for (const file of apiFiles) {
      const lines = readFileSync(file, 'utf8').split('\n');
      for (let i = 0; i < lines.length; i++) {
        if (/ctx\.emit\s*\(\s*OPCODES\s*\./.test(lines[i])) {
          hits.push({ file, line: i + 1, snippet: lines[i].trim() });
        }
      }
    }
    expect(hits, `OPCODES.X emit hits — must rip:\n${hits.map((h) => `  ${h.file}:${h.line} — ${h.snippet}`).join('\n')}`).toEqual([]);
  });

  it('no production file emits bare opcode chars (0,2,3,4,e)', () => {
    const hits: Array<{ file: string; line: number; snippet: string }> = [];
    for (const file of apiFiles) {
      const lines = readFileSync(file, 'utf8').split('\n');
      for (let i = 0; i < lines.length; i++) {
        if (/ctx\.emit\s*\(\s*['"`](0|2|3|4|e)['"`]\s*,/.test(lines[i])) {
          hits.push({ file, line: i + 1, snippet: lines[i].trim() });
        }
      }
    }
    expect(hits, `bare-character opcode emit hits — must rip:\n${hits.map((h) => `  ${h.file}:${h.line} — ${h.snippet}`).join('\n')}`).toEqual([]);
  });

  it('no source file imports OPCODES or ndjsonOpcodes', () => {
    const hits: Array<{ file: string; line: number; snippet: string }> = [];
    for (const file of apiFiles) {
      const lines = readFileSync(file, 'utf8').split('\n');
      for (let i = 0; i < lines.length; i++) {
        if (/from\s+['"`][^'"`]*ndjsonOpcodes/.test(lines[i])) {
          hits.push({ file, line: i + 1, snippet: lines[i].trim() });
        }
      }
    }
    expect(hits, `ndjsonOpcodes imports — must remove:\n${hits.map((h) => `  ${h.file}:${h.line} — ${h.snippet}`).join('\n')}`).toEqual([]);
  });

  it('ndjsonOpcodes.ts file is deleted', () => {
    expect(
      existsSync(NDJSON_OPCODES_PATH),
      `ndjsonOpcodes.ts must be deleted (path: ${NDJSON_OPCODES_PATH})`,
    ).toBe(false);
  });
});

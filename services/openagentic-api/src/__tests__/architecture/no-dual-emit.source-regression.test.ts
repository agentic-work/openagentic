/**
 * Architecture cage — no dual-emit of `stream` legacy envelope + canonical
 * `content_block_delta` from the same code site.
 *
 * REGRESSION pin — Track B Phase 0 of the canonical streaming rip.
 *
 * Smoking gun: services/openagentic-api/src/routes/chat/handlers/stream.handler.ts
 * around lines 1100-1140 emits EVERY text delta TWICE on the wire — once as
 * legacy `writeNDJSONDurable(reply, 'stream', ...)` envelope, once as
 * canonical `writeNDJSONDurable(reply, 'content_block_delta', ...)`. The
 * legacy frame feeds the UI's flat-string concat path (`assistantMessage +=`);
 * the canonical frame feeds the `applyCanonicalFrame` reducer's ContentBlock[]
 * path. Result: TWO parallel writers with slightly-different shapes — the
 * root cause of "streaming ≠ finished ≠ reloaded."
 *
 * Phase 2 of the rip kills the dual emit; this test pins it dead.
 *
 * Pattern: any source file emits BOTH `writeNDJSONDurable(...,'stream',...)`
 * AND `'content_block_delta'` within 50 lines of each other → FAIL.
 *
 * Allowed: tests + fixtures + this file itself.
 */
import { describe, it, expect } from 'vitest';
import { readFileSync, readdirSync, statSync } from 'fs';
import { join, dirname, relative } from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
const SRC = join(__dirname, '../..');

const PROXIMITY_LINES = 50;

// Anchor patterns — either as the second arg to writeNDJSONDurable() or
// the inline string literal in any sink-write call within the chat-stream
// handler family. Wide enough to catch reordered args / helper wrappers.
const LEGACY_STREAM_PATTERN =
  /writeNDJSONDurable\s*\([^)]*?,\s*['"]stream['"]|emit\s*\(\s*['"]stream['"]|reply\.[a-zA-Z]+\([^)]*['"]stream['"]/;
const CANONICAL_DELTA_PATTERN =
  /writeNDJSONDurable\s*\([^)]*?,\s*['"]content_block_delta['"]|emit\s*\(\s*['"]content_block_delta['"]|reply\.[a-zA-Z]+\([^)]*['"]content_block_delta['"]/;

const ALLOW_LIST_SUFFIXES: string[] = [
  '__tests__/architecture/no-dual-emit.source-regression.test.ts',
];

function isAllowed(rel: string): boolean {
  if (rel.includes('__tests__/') || rel.includes('/test/')) return true;
  return ALLOW_LIST_SUFFIXES.some((suffix) => rel.endsWith(suffix));
}

function walk(dir: string, out: string[] = []): string[] {
  for (const entry of readdirSync(dir)) {
    const full = join(dir, entry);
    const stat = statSync(full);
    if (stat.isDirectory()) {
      if (entry === 'node_modules' || entry === '.git' || entry === 'dist') continue;
      walk(full, out);
    } else if (entry.endsWith('.ts') && !entry.endsWith('.d.ts')) {
      out.push(full);
    }
  }
  return out;
}

describe('Architecture: no dual-emit of stream + content_block_delta from same site', () => {
  it('no production .ts file emits BOTH legacy `stream` AND canonical `content_block_delta` within 50 lines', () => {
    const violations: Array<{
      file: string;
      streamLine: number;
      canonicalLine: number;
      streamMatch: string;
      canonicalMatch: string;
    }> = [];

    for (const file of walk(SRC)) {
      const rel = relative(SRC, file).replace(/\\/g, '/');
      if (isAllowed(rel)) continue;

      const content = readFileSync(file, 'utf8');
      const lines = content.split('\n');

      // Collect line numbers of every legacy + canonical hit.
      const legacyHits: number[] = [];
      const canonicalHits: number[] = [];
      for (let i = 0; i < lines.length; i++) {
        if (LEGACY_STREAM_PATTERN.test(lines[i])) legacyHits.push(i);
        if (CANONICAL_DELTA_PATTERN.test(lines[i])) canonicalHits.push(i);
      }

      // For each legacy emit, check if a canonical emit lives within
      // PROXIMITY_LINES below or above (dual-emit from "same code site").
      for (const legacy of legacyHits) {
        const dualPartner = canonicalHits.find(
          (c) => Math.abs(c - legacy) <= PROXIMITY_LINES,
        );
        if (dualPartner !== undefined) {
          violations.push({
            file: rel,
            streamLine: legacy + 1,
            canonicalLine: dualPartner + 1,
            streamMatch: lines[legacy].trim().slice(0, 120),
            canonicalMatch: lines[dualPartner].trim().slice(0, 120),
          });
        }
      }
    }

    if (violations.length > 0) {
      const msg = violations
        .map(
          (v) =>
            `  ${v.file}\n    line ${v.streamLine} (legacy):    ${v.streamMatch}\n    line ${v.canonicalLine} (canonical): ${v.canonicalMatch}`,
        )
        .join('\n\n');
      throw new Error(
        `Found ${violations.length} dual-emit site(s) (legacy 'stream' + canonical 'content_block_delta' within ${PROXIMITY_LINES} lines). ` +
          `Track B Phase 2 of the canonical rip kills the legacy 'stream' envelope; emit only canonical content_block_delta:\n${msg}`,
      );
    }

    expect(violations).toEqual([]);
  });
});

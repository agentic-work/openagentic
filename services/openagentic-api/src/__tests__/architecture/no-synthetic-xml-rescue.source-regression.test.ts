/**
 * Architecture cage — no synthetic XML rescue band-aid may re-enter the
 * api source tree EXCEPT at the single, deliberate rescue site in chatLoop.
 *
 * History:
 *   Phase A.5 (2026-05-19 AM) ripped the inline `<compose_app>` / `<compose_visual>`
 *     XML rescue path from `chatLoop.ts:636-727`. Band-aid originally introduced
 *     in #807 when the model emitted compose_* as plain text instead of tool_use.
 *     A.1-A.4 upstream guards were considered sufficient on their own:
 *
 *       A.1  `input_examples` on artifact tools shows canonical tool_use shape
 *       A.2  Imperative descriptions say "call this tool, never emit XML prose"
 *       A.3  `strict: true` on tools rejects malformed dispatches at the schema layer
 *       A.4  `artifactVerbDetector` + `tool_choice` forcing when user names a verb
 *
 *   #946 (commit 6761a51b, 2026-05-19 PM) re-introduced the rescue at a single
 *     site in chatLoop with live Sonnet 4.6 evidence:
 *
 *       <compose_visual caption="Top Bedrock model spend" title="..."
 *         template="bar_chart" group_id="..."
 *         data={{ "x":[...], "y":[...] }} />
 *
 *     emitted verbatim in the assistant body. Despite A.1-A.4, Sonnet 4.6 still
 *     occasionally emits JSX-style markup inline. Without the rescue, the raw
 *     tag bleeds into message text and no iframe ever mounts. The user has a
 *     consistent stance (see MEMORY.md 2026-05-12 + 2026-05-19): rescue paths
 *     are preferred over hard-cage failure when real-model evidence shows the
 *     upstream guards do not fully eliminate the failure mode.
 *
 * Current contract (post-#946):
 *   - The rescue lives at EXACTLY ONE call-site in chatLoop.ts (function
 *     `rescueInlineComposePatterns`) and the `parseInlineComposePatterns`
 *     helper module + its tests.
 *   - Any OTHER file re-importing the parser, or any NEW occurrence of the
 *     banned log string outside the allowlist below, is a regression.
 *   - To remove the rescue entirely: rip the import + call-site in chatLoop,
 *     delete the helper, delete this file. Do NOT silently relax the cage.
 *   - To add a new rescue site: edit this file, document the live evidence
 *     in the allowlist comment, and open a PR.
 *
 * EXEMPT: this test file itself (it contains the forbidden patterns as needles).
 */

import { describe, it, expect } from 'vitest';
import { readFileSync, readdirSync, statSync } from 'fs';
import { join, dirname, relative } from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
const API_SRC = join(__dirname, '../..');

const EXEMPT_FILES = new Set<string>([
  // The architecture test itself contains the banned strings as needles.
  'src/__tests__/architecture/no-synthetic-xml-rescue.source-regression.test.ts',
  // #946 (commit 6761a51b, 2026-05-19) — single deliberate rescue site.
  // Live Sonnet 4.6 evidence showed inline JSX-style compose_visual emitted
  // verbatim in assistant prose despite A.1-A.4 upstream guards. The rescue
  // at `rescueInlineComposePatterns()` is the only sanctioned call-site for
  // parsing post-hoc XML into synthetic tool_use blocks. Any expansion of
  // the rescue beyond this single function requires a new PR + cage edit.
  'src/routes/chat/pipeline/chat/chatLoop.ts',
]);

// Files exempt from the re-import ban: the helper itself + its test +
// the single sanctioned rescue call-site (chatLoop, see #946 rationale above).
// Anything else importing parseInlineComposePatterns is a regression — the
// dispatch path is supposed to be tool_use only, with rescue as a single
// well-bounded backstop.
const HELPER_REIMPORT_EXEMPT = new Set<string>([
  'src/routes/chat/pipeline/chat/parseInlineComposePatterns.ts',
  'src/routes/chat/pipeline/chat/__tests__/parseInlineComposePatterns.test.ts',
  'src/__tests__/architecture/no-synthetic-xml-rescue.source-regression.test.ts',
  // #946 — sanctioned rescue call-site. See EXEMPT_FILES rationale above.
  'src/routes/chat/pipeline/chat/chatLoop.ts',
]);

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
    } else if (stat.isFile() && (entry.endsWith('.ts') || entry.endsWith('.tsx'))) {
      out.push(full);
    }
  }
  return out;
}

describe('Architecture: no synthetic XML rescue band-aid', () => {
  const allFiles = collectTs(API_SRC);

  it('banned log string "rescued inline compose" does not appear in source', () => {
    const needle = 'rescued inline compose';
    const offenders: Array<{ path: string; line: number; preview: string }> = [];

    for (const filePath of allFiles) {
      const rel = relative(join(API_SRC, '..'), filePath);
      if (EXEMPT_FILES.has(rel)) continue;

      let content: string;
      try {
        content = readFileSync(filePath, 'utf8');
      } catch {
        continue;
      }
      if (!content.includes(needle)) continue;

      const lines = content.split('\n');
      for (let i = 0; i < lines.length; i++) {
        if (lines[i].includes(needle)) {
          offenders.push({ path: rel, line: i + 1, preview: lines[i].trim().slice(0, 120) });
          break;
        }
      }
    }

    if (offenders.length > 0) {
      const detail = offenders
        .map((o) => `  ${o.path}:${o.line}\n      ${o.preview}`)
        .join('\n');
      expect.fail(
        `Banned log string "${needle}" reappeared in the api source tree.\n\n` +
          `Phase A.5 (2026-05-19) permanently ripped the #807 inline compose_* XML\n` +
          `rescue from chatLoop.ts. A.1-A.4 upstream guards prevent the model from\n` +
          `emitting inline XML, making the rescue permanently load-free. If you need\n` +
          `to revive rescue logic, update this arch cage with rationale and a new PR.\n\n` +
          `Found in:\n${detail}`,
      );
    }
  });

  it('banned pattern: post-hoc <compose_(visual|app) XML parser does not appear in source', () => {
    // This regex matches the characteristic inline XML parse pattern:
    //   /<compose_(visual|app)\s+[^>]+\/?>/ inside a text-buffer scan context
    // We detect it by looking for the escaped version that would appear in source
    // as a regex literal or string: /compose_(visual|app)\s/ or similar.
    const needle = 'compose_(visual|app)';
    const offenders: Array<{ path: string; line: number; preview: string }> = [];

    for (const filePath of allFiles) {
      const rel = relative(join(API_SRC, '..'), filePath);
      if (EXEMPT_FILES.has(rel)) continue;

      let content: string;
      try {
        content = readFileSync(filePath, 'utf8');
      } catch {
        continue;
      }
      if (!content.includes(needle)) continue;

      const lines = content.split('\n');
      for (let i = 0; i < lines.length; i++) {
        if (lines[i].includes(needle)) {
          offenders.push({ path: rel, line: i + 1, preview: lines[i].trim().slice(0, 120) });
          break;
        }
      }
    }

    if (offenders.length > 0) {
      const detail = offenders
        .map((o) => `  ${o.path}:${o.line}\n      ${o.preview}`)
        .join('\n');
      expect.fail(
        `Banned pattern "${needle}" (post-hoc XML parser) reappeared in source.\n\n` +
          `Phase A.5 (2026-05-19) deleted the inline compose_* XML rescue from\n` +
          `chatLoop.ts. The parser helper parseInlineComposePatterns.ts may still\n` +
          `exist as a reference file but must NOT be re-imported into the chat\n` +
          `pipeline. A.1-A.4 upstream guards prevent the regression class.\n\n` +
          `Found in:\n${detail}`,
      );
    }
  });

  it('banned re-import: parseInlineComposePatterns must not be imported into chat pipeline', () => {
    // The helper module survives as inert library code, but re-importing it
    // into the chat pipeline is the most likely regression vector that the
    // log-string and regex-pattern bans above would NOT catch. Close that.
    const needle = 'parseInlineComposePatterns';
    const offenders: Array<{ path: string; line: number; preview: string }> = [];

    for (const filePath of allFiles) {
      const rel = relative(join(API_SRC, '..'), filePath);
      if (HELPER_REIMPORT_EXEMPT.has(rel)) continue;

      let content: string;
      try {
        content = readFileSync(filePath, 'utf8');
      } catch {
        continue;
      }
      if (!content.includes(needle)) continue;

      const lines = content.split('\n');
      for (let i = 0; i < lines.length; i++) {
        if (lines[i].includes(needle)) {
          offenders.push({ path: rel, line: i + 1, preview: lines[i].trim().slice(0, 120) });
          break;
        }
      }
    }

    if (offenders.length > 0) {
      const detail = offenders
        .map((o) => `  ${o.path}:${o.line}\n      ${o.preview}`)
        .join('\n');
      expect.fail(
        `Banned re-import: "${needle}" reappeared in the api source tree.\n\n` +
          `Phase A.5 ripped the dispatch wiring; the helper survives only as inert\n` +
          `library code. A.1-A.4 upstream guards prevent the regression class —\n` +
          `re-importing this parser into any production code path defeats the rip.\n` +
          `If you need to revive rescue logic, update this arch cage with rationale\n` +
          `and a new PR.\n\n` +
          `Found in:\n${detail}`,
      );
    }
  });

  it('self-check: banned needle strings are correctly defined (not empty)', () => {
    expect('rescued inline compose').not.toBe('');
    expect('compose_(visual|app)').not.toBe('');
    expect('parseInlineComposePatterns').not.toBe('');
  });
});

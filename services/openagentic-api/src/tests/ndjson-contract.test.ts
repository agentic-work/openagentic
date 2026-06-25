/**
 * NDJSON contract gate — task #155.
 *
 * Dynamic CI gate that walks every `writeNDJSON(reply, '<type>', …)` emit
 * site under `services/openagentic-api/src/` and asserts the literal `type`
 * string appears in `KNOWN_EVENT_TYPES` from
 * `docs/core/streaming-contract.types.ts`.
 *
 * Undeclared emits fail the build. When you add a new event type, the
 * checklist in `docs/core/streaming-contract.md#how-to-add-a-new-event-type`
 * covers the five places you also need to edit. The doc + this test are
 * deliberately siblings — the doc is the human contract, this test is the
 * machine contract.
 *
 * Why grep and not type-import? The coverage types file lives outside
 * `src/rootDir` and is intentionally a docs artifact; treating it as a
 * runtime dependency would pull docs into the compiled surface. Parsing
 * the literal via a stable regex keeps the two decoupled and forces the
 * test to fail loudly if the types file is renamed (reviewer signal).
 */

import { describe, test, expect } from 'vitest';
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

// Resolve the repo paths at test-load time so this works regardless of
// where vitest is invoked from.
const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

// services/openagentic-api/src/tests/ndjson-contract.test.ts → repo root
const REPO_ROOT = resolve(__dirname, '..', '..', '..', '..');
const API_SRC = resolve(__dirname, '..');
const TYPES_FILE = resolve(
  REPO_ROOT,
  'docs',
  'core',
  'streaming-contract.types.ts',
);

// ---------------------------------------------------------------------------
// Helper — recursively walk a directory and yield every .ts file path.
// Skips node_modules, dist, coverage, .git, and test files themselves.
// ---------------------------------------------------------------------------
const SKIP_DIRS = new Set([
  'node_modules',
  'dist',
  'coverage',
  '.git',
  'generated',
]);
const SKIP_FILE_RE = /\.test\.ts$|\.d\.ts$|\.spec\.ts$/;

function* walkTs(dir: string): Iterable<string> {
  for (const name of readdirSync(dir)) {
    const full = join(dir, name);
    let st;
    try {
      st = statSync(full);
    } catch {
      continue;
    }
    if (st.isDirectory()) {
      if (!SKIP_DIRS.has(name)) yield* walkTs(full);
    } else if (name.endsWith('.ts') && !SKIP_FILE_RE.test(name)) {
      yield full;
    }
  }
}

// ---------------------------------------------------------------------------
// Helper — parse the known-event-types file for literal strings. Regex
// rather than `import` so the test doesn't ingest docs into the TS compile
// graph (the file lives outside rootDir by design).
// ---------------------------------------------------------------------------
function loadKnownEventTypes(): Set<string> {
  const src = readFileSync(TYPES_FILE, 'utf8');
  // Match every single-quoted string literal. The file only contains
  // identifier-looking event names, so we also filter to /^[a-z][a-z0-9_]*$/
  // to skip the doc comment accidentally quoting e.g. 'type'.
  const known = new Set<string>();
  const literalRe = /'([a-z][a-z0-9_]*)'/g;
  let m: RegExpExecArray | null;
  while ((m = literalRe.exec(src)) !== null) {
    known.add(m[1]);
  }
  return known;
}

// ---------------------------------------------------------------------------
// Helper — extract every `writeNDJSON(reply, '<type>', …)` literal.
// Pattern also covers `stream.write('<type>', …)` from startNDJSONStream
// handles, because the helper delegates to `writeNDJSON` internally.
// ---------------------------------------------------------------------------
interface Emit {
  type: string;
  file: string;
  line: number;
}

function extractEmits(): Emit[] {
  const emits: Emit[] = [];
  // Matches writeNDJSON(reply, 'type_string', …) and writeNDJSONDurable(
  // reply, 'type_string', …). The optional `Durable` suffix was added in
  // task #154 (durable streams). Both are real emit sites on the wire.
  //
  // Also tolerates an intervening comment or newline between `reply,` and
  // the literal so multi-line calls still resolve.
  const re =
    /writeNDJSON(?:Durable)?\s*\(\s*\w+\s*,\s*['"]([a-zA-Z_][a-zA-Z0-9_]*)['"]/g;

  for (const file of walkTs(API_SRC)) {
    const src = readFileSync(file, 'utf8');
    if (!src.includes('writeNDJSON')) continue;
    let m: RegExpExecArray | null;
    while ((m = re.exec(src)) !== null) {
      const lineNumber = src.slice(0, m.index).split('\n').length;
      emits.push({ type: m[1], file, line: lineNumber });
    }
  }
  return emits;
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('NDJSON wire contract — emit ↔ declared types', () => {
  test('streaming-contract.types.ts exists and parses to a non-empty set', () => {
    const known = loadKnownEventTypes();
    expect(known.size).toBeGreaterThan(50);
    // Smoke: common known types must be present.
    expect(known.has('stream_start')).toBe(true);
    expect(known.has('done')).toBe(true);
    expect(known.has('error')).toBe(true);
    expect(known.has('ping')).toBe(true);
  });

  test('at least one emit site was found (regex + filesystem sanity)', () => {
    const emits = extractEmits();
    expect(emits.length).toBeGreaterThan(10);
  });

  test('every writeNDJSON emit type is declared in streaming-contract.types.ts', () => {
    const known = loadKnownEventTypes();
    const emits = extractEmits();

    const undeclared = emits.filter(e => !known.has(e.type));
    if (undeclared.length > 0) {
      // Build a human-readable failure so CI reviewers see exactly where
      // to go. Group by type so a single unknown name emitted 4x reads
      // as one item, not four.
      const grouped = new Map<string, Emit[]>();
      for (const e of undeclared) {
        if (!grouped.has(e.type)) grouped.set(e.type, []);
        grouped.get(e.type)!.push(e);
      }
      const msg = [...grouped.entries()]
        .map(([type, sites]) => {
          const cites = sites
            .map(s => `${s.file.replace(REPO_ROOT + '/', '')}:${s.line}`)
            .join(', ');
          return `  - "${type}" emitted at: ${cites}`;
        })
        .join('\n');
      throw new Error(
        `Undeclared NDJSON event types detected. Add these to ` +
          `docs/core/streaming-contract.types.ts (and the matrix in ` +
          `streaming-contract.md), or fix the emit site:\n${msg}`,
      );
    }
    expect(undeclared).toEqual([]);
  });

  test('every emit type matches canonical identifier shape (snake_case, no uppercase)', () => {
    const emits = extractEmits();
    const bad = emits.filter(e => !/^[a-z][a-z0-9_]*$/.test(e.type));
    expect(bad).toEqual([]);
  });

  test('no emit site uses a reserved `_`-prefixed name', () => {
    const emits = extractEmits();
    const reserved = emits.filter(e => e.type.startsWith('_'));
    expect(reserved).toEqual([]);
  });
});

/**
 * Wire-frame-name parity arch test — Phase 0.1.1 of the five-layer audit
 * remediation plan.
 *
 * Plan: docs/superpowers/plans/2026-05-11-chatmode-five-layer-remediation.md
 *       Phase 0.1.1 ("Frame-name parity test").
 *
 * Audit anchors: L1-5 ("Dual wire protocol with silent fallback") +
 * L2-4 ("Builders defined but never called") from the five-layer audit
 * (2026-05-11). The arch test catalogs the drift so A1 (rip dead opcode
 * emits) and A6 (retire-or-use builders) know exactly what to clean up.
 *
 * What this test pins:
 *   1. emit ⊆ consume ∪ KNOWN_INTERNAL_EMITS
 *      — every distinct first-arg string-literal name passed to
 *        `ctx.emit(NAME, ...)` across the api source tree must have a
 *        matching reducer arm in `useChatStream.ts`. Otherwise it is a
 *        DEAD EMIT — the api spends cycles writing a frame the UI
 *        silently drops. The KNOWN_INTERNAL_EMITS allowlist exists for
 *        frames the api intentionally writes for telemetry / persistence
 *        but the UI does not consume.
 *
 *   2. consume ⊆ emit ∪ KNOWN_UI_INTERNAL_FRAMES
 *      — every distinct `case 'NAME':` arm in the `useChatStream.ts`
 *        switch must have at least one emit site. Otherwise it is an
 *        ORPHAN REDUCER ARM — code rot. The KNOWN_UI_INTERNAL_FRAMES
 *        allowlist exists for frames the UI generates itself (e.g.
 *        tail-resume internals like `resume_exhausted`).
 *
 * Opcode characters (`0`, `2`, `3`, `4`, `e`) emitted via the OPCODES
 * symbol-table fall into the emit set as their wire characters. They
 * appear as dead emits unless allowlisted; that is the signal A1 keys
 * off when ripping the dual-wire protocol.
 *
 * This test is SELF-CONTAINED — no production-code imports. It reads
 * sources as text. The plan specifies the source-regression posture so
 * the catalog is stable across refactors.
 *
 * STARTING POSTURE: the test is EXPECTED TO FAIL on the first run. The
 * failure surfaces the live DEAD EMIT and ORPHAN ARM catalog so A1 / A6
 * can land the cleanups one-by-one. Each fix shrinks the diff. Once
 * the diff is empty the test stays green going forward.
 */
import { describe, it, expect } from 'vitest';
import { readFileSync, readdirSync, statSync, existsSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));

const API_SRC_ROOT = join(__dirname, '../..');
const UI_HOOK_PATH = join(
  __dirname,
  '../../../../openagentic-ui/src/features/chat/hooks/useChatStream.ts',
);
/**
 * Phase 0.1.1 follow-up (2026-05-12): the stream handler runs a V2-to-V1
 * translation layer in its `streamCallback` body. That layer rewrites
 * inbound frame names twice:
 *
 *   1. Event-rewrite: `if (event.type === 'X') { event = { type: 'Y', ... } }`
 *      — relabels V2 frames onto V1 internal names (e.g.
 *      `assistant_message_delta` → `content_delta`).
 *
 *   2. Wire-rename: `let frontendEvent = event.type; if (event.type === 'X')
 *      frontendEvent = 'Z'` — picks the on-the-wire frame name the UI
 *      actually sees (e.g. `content_delta` → `stream`).
 *
 * The earlier version of this test crawled `ctx.emit(...)` sites only and
 * therefore flagged frames as DEAD when in fact the translation layer was
 * silently mapping them onto a UI-consumed name. To get a faithful DEAD
 * catalog we crawl the translation layer too and apply the composed
 * `src -> dst` map to the raw emit set before the set subtraction.
 */
const STREAM_HANDLER_PATH = join(
  __dirname,
  '../../routes/chat/handlers/stream.handler.ts',
);
/**
 * A1 (2026-05-12) — ndjsonOpcodes.ts was DELETED. The OPCODES symbol
 * table no longer exists; production code emits named frames only. The
 * opcode-map loader below now returns an empty map, which is the
 * intended steady state. We keep the loader (defensive) so the test
 * survives a future re-introduction without a silent regression: if
 * any source file ever imports OPCODES again, the dedicated
 * `no-opcode-emits.source-regression.test.ts` arch test fires.
 */
const NDJSON_OPCODES_PATH = join(
  __dirname,
  '../../routes/chat/pipeline/chat/ndjsonOpcodes.ts',
);

/**
 * Frames the api emits intentionally for log / persistence / telemetry
 * purposes that the UI is NOT expected to consume. Start empty — the
 * first RED catalog tells the user what (if anything) belongs here.
 */
const KNOWN_INTERNAL_EMITS = new Set<string>([]);

/**
 * Frames the UI generates internally inside `useChatStream` (e.g. the
 * tail-resume retry-after-drop path) that the api never emits. These
 * arms exist by design; they handle UI-side state transitions.
 */
const KNOWN_UI_INTERNAL_FRAMES = new Set<string>(['stream_start', 'resume_exhausted']);

function readSafe(path: string): string {
  try {
    return readFileSync(path, 'utf8');
  } catch {
    return '';
  }
}

function walkTs(dir: string): string[] {
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

/**
 * Parse `ndjsonOpcodes.ts` and return the symbol → character map. We
 * read it as text (not import) to keep the test self-contained.
 *
 *   export const OPCODES = {
 *     TEXT: '0',
 *     TOOL_CALL: '2',
 *     ...
 *   } as const;
 */
function loadOpcodeMap(src: string): Map<string, string> {
  const map = new Map<string, string>();
  // Crude but adequate: match `IDENT: '<char>'` lines inside an OPCODES
  // block. Production code defines exactly one such block.
  const block = src.match(/OPCODES\s*=\s*\{([\s\S]*?)\}\s*as\s+const/);
  if (!block) return map;
  const body = block[1];
  const re = /([A-Z_][A-Z0-9_]*)\s*:\s*['"`]([^'"`]+)['"`]/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(body)) !== null) {
    map.set(m[1], m[2]);
  }
  return map;
}

/**
 * Extract every emit frame name from a source file.
 *
 * Captures:
 *   - String-literal first-arg:  ctx.emit('foo', ...)        -> 'foo'
 *   - OPCODES symbol first-arg:  ctx.emit(OPCODES.TEXT, ...) -> opcode
 *                                                              char from
 *                                                              the map
 *
 * Ignores:
 *   - Dynamic first-arg:  ctx.emit(event, ...)
 *   - Member expression first-arg other than OPCODES.X (e.g. frame.type)
 */
function extractEmits(src: string, opcodes: Map<string, string>): Set<string> {
  const out = new Set<string>();

  const literalRe =
    /(?:ctx|v2Ctx|deps\.ctx|appCtx)\??\.\s*emit\??\s*\(\s*['"`]([^'"`]+)['"`]/g;
  let m: RegExpExecArray | null;
  while ((m = literalRe.exec(src)) !== null) {
    out.add(m[1]);
  }

  const opcodeRe =
    /(?:ctx|v2Ctx|deps\.ctx|appCtx)\??\.\s*emit\??\s*\(\s*OPCODES\s*\.\s*([A-Z_][A-Z0-9_]*)/g;
  while ((m = opcodeRe.exec(src)) !== null) {
    const symbol = m[1];
    const ch = opcodes.get(symbol);
    if (ch !== undefined) out.add(ch);
  }

  return out;
}

/**
 * Extract every `case 'NAME':` arm from a source file. Restricted to
 * string-literal cases (not enum / constant cases) because the wire
 * dispatch keys on the raw frame `type` string.
 */
function extractConsumeArms(src: string): Set<string> {
  const out = new Set<string>();
  const re = /case\s+['"`]([a-z_][a-z_0-9]*)['"`]\s*:/gi;
  let m: RegExpExecArray | null;
  while ((m = re.exec(src)) !== null) {
    out.add(m[1]);
  }
  return out;
}

function sorted(s: Set<string>): string[] {
  return [...s].sort();
}

/**
 * Crawl the `streamCallback` body in `stream.handler.ts` for the V2-to-V1
 * frame-name translation map.
 *
 * The handler's translation layer has two stages:
 *
 *   Stage A — event-rewrite. Inside `if (event.type === '<src>') { ...
 *   event = { type: '<dst>', ... } }` the inbound V2 frame is relabelled
 *   to the V1 internal name. Example: `assistant_message_delta` →
 *   `content_delta`.
 *
 *   Stage B — wire-rename. A `let frontendEvent = event.type;` followed by
 *   `if (event.type === '<src>') frontendEvent = '<dst>'` then picks the
 *   on-the-wire name the UI sees. Example: `content_delta` → `stream`.
 *
 * We compose both stages so that, for any emit name `X`, the function
 * returns the *terminal* frame name the UI's `useChatStream.ts` reducer
 * actually receives. Composition is bounded — we walk the graph with a
 * visited-set to avoid infinite loops if a future edit ever introduces a
 * cycle.
 */
function buildTranslationMap(handlerSrc: string): Record<string, string> {
  const directA: Record<string, string> = {};
  const directB: Record<string, string> = {};

  // Stage A — event-rewrite: `if (event.type === '<src>') { ... event = { type: '<dst>', ... } }`
  // The body between the type check and the assignment must NOT cross
  // into the next `} else if` arm — otherwise a non-rewriting arm (e.g.
  // `tool_use`) would be falsely paired with the next arm's
  // `event = { type: ... }`. We forbid `else if` between the two.
  const stageARe =
    /event\.type\s*===\s*['"`]([a-z_][a-z_0-9]*)['"`]((?:(?!else\s+if|event\s*=\s*\{)[\s\S])*?)event\s*=\s*\{\s*type\s*:\s*['"`]([a-z_][a-z_0-9]*)['"`]/gi;
  let m: RegExpExecArray | null;
  while ((m = stageARe.exec(handlerSrc)) !== null) {
    const [, src, , dst] = m;
    // Only the first rewrite per src wins (lexical order = runtime
    // order inside the streamCallback body).
    if (!(src in directA)) directA[src] = dst;
  }

  // Stage B — wire-rename: `if (event.type === '<src>') frontendEvent = '<dst>'`
  // (single-statement form, no braces). Whitespace tolerant.
  const stageBRe =
    /if\s*\(\s*event\.type\s*===\s*['"`]([a-z_][a-z_0-9]*)['"`]\s*\)\s*\{?\s*frontendEvent\s*=\s*['"`]([a-z_][a-z_0-9]*)['"`]/gi;
  while ((m = stageBRe.exec(handlerSrc)) !== null) {
    const [, src, dst] = m;
    if (!(src in directB)) directB[src] = dst;
  }

  // Compose A then B with cycle-guard. For each src name in the union of
  // domains, follow A (if any) then B (if any), capped at 5 hops.
  const composed: Record<string, string> = {};
  const sources = new Set<string>([...Object.keys(directA), ...Object.keys(directB)]);
  for (const src of sources) {
    let cur = src;
    const seen = new Set<string>([cur]);
    for (let hops = 0; hops < 5; hops++) {
      const next = directA[cur] ?? directB[cur];
      if (!next || next === cur || seen.has(next)) break;
      cur = next;
      seen.add(cur);
    }
    if (cur !== src) composed[src] = cur;
  }
  return composed;
}

describe('arch — wire frame name parity (Phase 0.1.1)', () => {
  const opcodesSrc = readSafe(NDJSON_OPCODES_PATH);
  const opcodes = loadOpcodeMap(opcodesSrc);

  const apiFiles = walkTs(API_SRC_ROOT);
  const rawEmitSet = new Set<string>();
  for (const f of apiFiles) {
    extractEmits(readSafe(f), opcodes).forEach((n) => rawEmitSet.add(n));
  }

  // Apply the streamCallback V2-to-V1 translation map. Frames whose
  // emit-site name is rewritten by the handler before reaching the wire
  // must be matched against the UI reducer under their terminal name,
  // otherwise the test reports false-positive DEAD EMITS.
  const handlerSrc = readSafe(STREAM_HANDLER_PATH);
  const TRANSLATION_MAP = buildTranslationMap(handlerSrc);
  const effectiveEmitSet = new Set<string>();
  for (const name of rawEmitSet) {
    effectiveEmitSet.add(TRANSLATION_MAP[name] ?? name);
  }

  const uiSrc = readSafe(UI_HOOK_PATH);
  const consumeSet = extractConsumeArms(uiSrc);

  it('static crawl found api source files and UI hook', () => {
    expect(apiFiles.length, 'expected to walk api source .ts files').toBeGreaterThan(20);
    expect(uiSrc.length, `expected to read useChatStream.ts at ${UI_HOOK_PATH}`).toBeGreaterThan(1000);
    // A1 (2026-05-12) — ndjsonOpcodes.ts deleted; the OPCODES map is
    // intentionally empty now. Loader stays as a defensive seam.
    expect(opcodes.size, 'opcode map empty (file deleted) is the intended A1 steady state').toBe(0);
    expect(existsSync(NDJSON_OPCODES_PATH), 'ndjsonOpcodes.ts must be deleted (A1)').toBe(false);
    expect(rawEmitSet.size, 'expected at least one emit frame extracted').toBeGreaterThan(0);
    expect(consumeSet.size, 'expected at least one consume arm extracted').toBeGreaterThan(0);
    expect(handlerSrc.length, `expected to read stream.handler.ts at ${STREAM_HANDLER_PATH}`).toBeGreaterThan(1000);
  });

  it('effective-emit ⊆ consume ∪ KNOWN_INTERNAL_EMITS (no DEAD EMITS post-translation)', () => {
    const deadEmits = sorted(
      new Set(
        [...effectiveEmitSet].filter(
          (n) => !consumeSet.has(n) && !KNOWN_INTERNAL_EMITS.has(n),
        ),
      ),
    );
    const translationLines = Object.entries(TRANSLATION_MAP)
      .sort(([a], [b]) => a.localeCompare(b))
      .map(([src, dst]) => `  ${src} -> ${dst}`)
      .join('\n');
    expect(
      deadEmits,
      `DEAD EMITS (post-translation) — api emits these frame names AND the stream.handler.ts V2-translation\n` +
        `layer does not rename them to a UI-consumed name. Each entry must be either (a) ripped from the\n` +
        `emit site, (b) given a reducer arm in the UI, (c) added to the streamCallback translation map\n` +
        `in stream.handler.ts, or (d) added to KNOWN_INTERNAL_EMITS with a citation if it is intentionally\n` +
        `api-only (telemetry / persistence).\n` +
        `count=${deadEmits.length}\n  ${deadEmits.join('\n  ')}\n\n` +
        `TRANSLATIONS APPLIED (crawled from stream.handler.ts streamCallback):\n${translationLines || '  (none)'}`,
    ).toEqual([]);
  });

  it('consume ⊆ effective-emit ∪ KNOWN_UI_INTERNAL_FRAMES (no ORPHAN REDUCER ARMS)', () => {
    const orphanArms = sorted(
      new Set(
        [...consumeSet].filter(
          (n) => !effectiveEmitSet.has(n) && !KNOWN_UI_INTERNAL_FRAMES.has(n),
        ),
      ),
    );
    expect(
      orphanArms,
      `ORPHAN REDUCER ARMS — useChatStream.ts has case arms for these frame names but no api emit site writes them.\n` +
        `Each entry must be either (a) deleted from the reducer if dead, or (b) added to KNOWN_UI_INTERNAL_FRAMES\n` +
        `with a citation if the UI generates the frame internally (e.g. tail-resume retry path), or (c) the\n` +
        `frame is emitted via a non-ctx.emit channel (subagent event bus, direct writeNDJSONDurable, etc.) —\n` +
        `that crawl is a separate cleanup pass.\n` +
        `count=${orphanArms.length}\n  ${orphanArms.join('\n  ')}`,
    ).toEqual([]);
  });
});

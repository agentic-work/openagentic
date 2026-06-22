/**
 * Wire NDJSON timeline viewer — pure replay (Phase 0.1).
 *
 * the design notes
 * Spec source: services/openagentic-api/src/infra/wireCapture.ts emits one
 * pino log line per NDJSON frame when WIRE_CAPTURE_ENABLED=true:
 *
 *   { tag: 'WIRE-CAPTURE', turnId, seq, frameType, payload, msg: '[WIRE-CAPTURE]' }
 *
 * The pino wrapper also adds `level/time/pid/hostname/name`. This module strips
 * the wrapper, sorts by per-turn `seq`, computes wall-clock offsets, classifies
 * frame types, and annotates known Sev-0 patterns:
 *
 *   - NEW_TEXT_BLOCK   — a text frame whose `index` differs from the prior text frame's index
 *   - DUPLICATE_PROSE  — `stream` envelope + `content_block_delta(text_delta)` carrying the
 *                        same text content (the dual-emit race producing "LetLet me…")
 *   - GAP_BEFORE       — log-seq jumped by >1 from the prior frame (lost log line)
 *   - COALESCED_BATCH  — N>=4 consecutive tool_use/tool_executing/tool_result frames with
 *                        no text frame between them (the Q7 wire coalesce Sev-0)
 *
 * Public surface (consumed by Phase 0.3 contract-vs-capture, the wire-timeline CLI,
 * and Phase 5 chatmode-output-contract.test.ts extension):
 *
 *   parseWireCaptureLog(text)  → RawWireLogLine[]
 *   buildTimeline(frames)      → Timeline
 *   renderTimelineMarkdown(t)  → string
 */

export interface RawWireLogLine {
  tag: 'WIRE-CAPTURE';
  turnId: string;
  seq: number;
  frameType: string;
  payload: Record<string, unknown>;
  /** pino wall-clock ms (when present); falls back to payload._ts. */
  time?: number;
}

export type Annotation =
  | 'NEW_TEXT_BLOCK'
  | 'DUPLICATE_PROSE'
  | 'GAP_BEFORE'
  | 'COALESCED_BATCH';

export interface TimelineEntry {
  seq: number;
  /** ms from first frame in the timeline. */
  tOffsetMs: number;
  frameType: string;
  /** content_block_delta carries `index`; tool_use indices live in upstream wire only. */
  index?: number;
  toolName?: string;
  toolUseId?: string;
  /** First ~60 chars of the human-readable content. */
  preview?: string;
  annotations: Annotation[];
}

export interface TimelineSummary {
  frameTypeCounts: Record<string, number>;
  toolExecuting: number;
  toolResults: number;
  textDeltas: number;
  streamFrames: number;
  contentBlockDeltas: number;
  thinkingFrames: number;
  duplicateTextPairs: number;
  gaps: number[];
}

export interface Timeline {
  turnId: string;
  startTs: number;
  endTs: number;
  durationMs: number;
  entries: TimelineEntry[];
  summary: TimelineSummary;
}

const PREVIEW_MAX = 60;

const TOOL_FRAME_TYPES = new Set([
  'tool_use',
  'tool_executing',
  'tool_result',
  'tool_error',
]);

const TEXT_FRAME_TYPES = new Set(['stream', 'content_block_delta']);

/**
 * Parse a chunk of pino log output (or bare WIRE-CAPTURE JSON) into the
 * sequence of WIRE-CAPTURE frames. Non-WIRE-CAPTURE lines and malformed
 * JSON are silently skipped.
 */
export function parseWireCaptureLog(text: string): RawWireLogLine[] {
  const out: RawWireLogLine[] = [];
  for (const line of text.split(/\r?\n/)) {
    const trimmed = line.trim();
    if (!trimmed) continue;
    if (!trimmed.startsWith('{')) continue;
    let obj: Record<string, unknown>;
    try {
      obj = JSON.parse(trimmed) as Record<string, unknown>;
    } catch {
      continue;
    }
    if (obj.tag !== 'WIRE-CAPTURE') continue;
    if (typeof obj.turnId !== 'string') continue;
    if (typeof obj.seq !== 'number') continue;
    if (typeof obj.frameType !== 'string') continue;
    const payload =
      obj.payload && typeof obj.payload === 'object'
        ? (obj.payload as Record<string, unknown>)
        : {};
    out.push({
      tag: 'WIRE-CAPTURE',
      turnId: obj.turnId,
      seq: obj.seq,
      frameType: obj.frameType,
      payload,
      time: typeof obj.time === 'number' ? obj.time : undefined,
    });
  }
  return out;
}

function frameWallClockMs(f: RawWireLogLine): number {
  if (typeof f.time === 'number') return f.time;
  const ts = f.payload._ts;
  if (typeof ts === 'number') return ts;
  return 0;
}

function extractIndex(f: RawWireLogLine): number | undefined {
  const v = f.payload.index;
  return typeof v === 'number' ? v : undefined;
}

function extractToolName(f: RawWireLogLine): string | undefined {
  const v = f.payload.name;
  return typeof v === 'string' ? v : undefined;
}

function extractToolUseId(f: RawWireLogLine): string | undefined {
  const v = f.payload.tool_use_id;
  return typeof v === 'string' ? v : undefined;
}

/**
 * Extract a human-readable preview from a frame:
 *   - thinking         → payload.thinking
 *   - stream           → payload.content
 *   - content_block_delta with text_delta → payload.delta.text
 *   - content_block_delta with thinking_delta → payload.delta.thinking
 *   - tool_*           → undefined (tool name + id surfaced separately)
 */
function extractPreview(f: RawWireLogLine): string | undefined {
  let raw: unknown;
  switch (f.frameType) {
    case 'thinking':
      raw = f.payload.thinking;
      break;
    case 'thinking_event':
      raw = f.payload.thinking ?? f.payload.content;
      break;
    case 'stream':
      raw = f.payload.content;
      break;
    case 'content_block_delta': {
      const delta = f.payload.delta;
      if (delta && typeof delta === 'object') {
        const d = delta as Record<string, unknown>;
        raw = d.text ?? d.thinking;
      }
      break;
    }
    default:
      return undefined;
  }
  if (typeof raw !== 'string' || raw.length === 0) return undefined;
  return raw.length > PREVIEW_MAX ? raw.slice(0, PREVIEW_MAX) + '…' : raw;
}

/**
 * Extract the text content from a frame for duplicate-pair detection.
 * Returns undefined for non-text frames.
 */
function extractTextContent(f: RawWireLogLine): string | undefined {
  if (f.frameType === 'stream') {
    const v = f.payload.content;
    return typeof v === 'string' ? v : undefined;
  }
  if (f.frameType === 'content_block_delta') {
    const delta = f.payload.delta;
    if (delta && typeof delta === 'object') {
      const d = delta as Record<string, unknown>;
      if (typeof d.type === 'string' && d.type === 'text_delta') {
        return typeof d.text === 'string' ? d.text : undefined;
      }
    }
  }
  return undefined;
}

function isTextFrame(frameType: string): boolean {
  return TEXT_FRAME_TYPES.has(frameType);
}

function isToolFrame(frameType: string): boolean {
  return TOOL_FRAME_TYPES.has(frameType);
}

const COALESCE_THRESHOLD = 4;

export function buildTimeline(frames: RawWireLogLine[]): Timeline {
  if (frames.length === 0) {
    return {
      turnId: '',
      startTs: 0,
      endTs: 0,
      durationMs: 0,
      entries: [],
      summary: {
        frameTypeCounts: {},
        toolExecuting: 0,
        toolResults: 0,
        textDeltas: 0,
        streamFrames: 0,
        contentBlockDeltas: 0,
        thinkingFrames: 0,
        duplicateTextPairs: 0,
        gaps: [],
      },
    };
  }

  const sorted = [...frames].sort((a, b) => a.seq - b.seq);
  const turnId = sorted[0].turnId;
  const startTs = frameWallClockMs(sorted[0]);
  const endTs = frameWallClockMs(sorted[sorted.length - 1]);

  // First pass — build raw entries (no annotations yet).
  const entries: TimelineEntry[] = sorted.map((f) => ({
    seq: f.seq,
    tOffsetMs: Math.max(0, frameWallClockMs(f) - startTs),
    frameType: f.frameType,
    index: extractIndex(f),
    toolName: extractToolName(f),
    toolUseId: extractToolUseId(f),
    preview: extractPreview(f),
    annotations: [],
  }));

  const frameTypeCounts: Record<string, number> = {};
  for (const f of sorted) {
    frameTypeCounts[f.frameType] = (frameTypeCounts[f.frameType] ?? 0) + 1;
  }

  // Annotate GAP_BEFORE + collect missing seqs.
  const gaps: number[] = [];
  for (let i = 0; i < sorted.length; i += 1) {
    const cur = sorted[i];
    const prev = sorted[i - 1];
    if (!prev) continue;
    const expected = prev.seq + 1;
    if (cur.seq !== expected) {
      entries[i].annotations.push('GAP_BEFORE');
      for (let s = expected; s < cur.seq; s += 1) gaps.push(s);
    }
  }

  // Annotate DUPLICATE_PROSE — adjacent stream + content_block_delta (or vice
  // versa) carrying matching text content within 200ms.
  let duplicateTextPairs = 0;
  const DUPLICATE_WINDOW_MS = 200;
  for (let i = 0; i < sorted.length - 1; i += 1) {
    const a = sorted[i];
    const b = sorted[i + 1];
    if (!isTextFrame(a.frameType) || !isTextFrame(b.frameType)) continue;
    if (a.frameType === b.frameType) continue; // both must be text but different envelope kinds
    const textA = extractTextContent(a);
    const textB = extractTextContent(b);
    if (!textA || !textB || textA !== textB) continue;
    const dt = Math.abs(frameWallClockMs(b) - frameWallClockMs(a));
    if (dt > DUPLICATE_WINDOW_MS) continue;
    entries[i].annotations.push('DUPLICATE_PROSE');
    entries[i + 1].annotations.push('DUPLICATE_PROSE');
    duplicateTextPairs += 1;
  }

  // Annotate NEW_TEXT_BLOCK — text frame whose `index` differs from the prior text frame's index.
  // The duplicate stream+canonical pair (same delta) does NOT count as a new block;
  // skip frames already marked DUPLICATE_PROSE when tracking lastIndex.
  let lastTextIndex: number | undefined;
  for (let i = 0; i < entries.length; i += 1) {
    const e = entries[i];
    if (!isTextFrame(e.frameType)) continue;
    if (e.frameType === 'stream') {
      // legacy envelope has no index; don't update tracker, don't annotate.
      continue;
    }
    // content_block_delta with text payload
    const text = extractTextContent(sorted[i]);
    if (text === undefined) continue;
    if (e.index === undefined) continue;
    if (lastTextIndex !== undefined && e.index !== lastTextIndex) {
      e.annotations.push('NEW_TEXT_BLOCK');
    }
    lastTextIndex = e.index;
  }

  // Annotate COALESCED_BATCH — runs of >=4 consecutive tool frames with no text between.
  // Non-tool, non-text frames (thinking, ping, message_stop) don't break the run but
  // also don't carry the annotation themselves — only the tool frames in the run do.
  // The annotation marks the bug ("these tool frames had no prose between them"), so
  // attaching it to a ping/heartbeat would be misleading.
  let runStart = -1;
  const toolIndexesInRun: number[] = [];
  for (let i = 0; i <= entries.length; i += 1) {
    const e = entries[i];
    const isTool = e ? isToolFrame(e.frameType) : false;
    const isText = e ? isTextFrame(e.frameType) : false;
    if (isTool) {
      if (runStart === -1) runStart = i;
      toolIndexesInRun.push(i);
    } else if (isText || !e) {
      if (runStart !== -1) {
        if (toolIndexesInRun.length >= COALESCE_THRESHOLD) {
          for (const idx of toolIndexesInRun) {
            entries[idx].annotations.push('COALESCED_BATCH');
          }
        }
        runStart = -1;
        toolIndexesInRun.length = 0;
      }
    }
  }

  const summary: TimelineSummary = {
    frameTypeCounts,
    toolExecuting: frameTypeCounts['tool_executing'] ?? 0,
    toolResults: frameTypeCounts['tool_result'] ?? 0,
    textDeltas: entries.filter(
      (e) => e.frameType === 'content_block_delta' && e.preview !== undefined,
    ).length,
    streamFrames: frameTypeCounts['stream'] ?? 0,
    contentBlockDeltas: frameTypeCounts['content_block_delta'] ?? 0,
    thinkingFrames:
      (frameTypeCounts['thinking'] ?? 0) +
      (frameTypeCounts['thinking_event'] ?? 0),
    duplicateTextPairs,
    gaps,
  };

  return {
    turnId,
    startTs,
    endTs,
    durationMs: Math.max(0, endTs - startTs),
    entries,
    summary,
  };
}

function fmtOffset(ms: number): string {
  return `t+${(ms / 1000).toFixed(1)}s`;
}

function fmtDuration(ms: number): string {
  if (ms < 1000) return `${ms}ms`;
  if (ms < 60_000) return `${(ms / 1000).toFixed(1)}s`;
  const m = Math.floor(ms / 60_000);
  const rem = ((ms % 60_000) / 1000).toFixed(1);
  return `${m}m ${rem}s`;
}

export function renderTimelineMarkdown(timeline: Timeline): string {
  const lines: string[] = [];
  lines.push(`# Wire Timeline — ${timeline.turnId}`);
  lines.push('');
  lines.push(
    `Duration: ${fmtDuration(timeline.durationMs)} · ${timeline.entries.length} frames`,
  );
  lines.push('');

  if (timeline.summary.duplicateTextPairs > 0) {
    lines.push(`> 🚨 **Sev-0**: ${timeline.summary.duplicateTextPairs} duplicate text pair(s) — dual-emit race detected.`);
  }
  const coalesced = timeline.entries.filter((e) =>
    e.annotations.includes('COALESCED_BATCH'),
  ).length;
  if (coalesced > 0) {
    lines.push(`> 🚨 **Sev-0**: ${coalesced} frames in coalesced tool batch(es) — interleave broken.`);
  }
  if (timeline.summary.gaps.length > 0) {
    lines.push(`> ⚠️ Gap(s) at seq=${timeline.summary.gaps.join(',')}`);
  }
  if (timeline.summary.duplicateTextPairs > 0 || coalesced > 0 || timeline.summary.gaps.length > 0) {
    lines.push('');
  }

  lines.push('## Frames');
  lines.push('');
  for (const e of timeline.entries) {
    const cols: string[] = [];
    cols.push(fmtOffset(e.tOffsetMs).padEnd(8));
    cols.push(`seq=${String(e.seq).padStart(4)}`);
    cols.push(e.frameType.padEnd(22));
    if (e.index !== undefined) cols.push(`idx=${e.index}`);
    if (e.toolName) cols.push(`tool=${e.toolName}`);
    if (e.toolUseId) cols.push(`(${e.toolUseId.slice(-6)})`);
    if (e.preview) cols.push(`"${e.preview}"`);
    if (e.annotations.length > 0) {
      cols.push(`[${e.annotations.join(' ')}]`);
    }
    lines.push(cols.join('  '));
  }

  lines.push('');
  lines.push('## Summary');
  lines.push('');
  const sortedTypes = Object.entries(timeline.summary.frameTypeCounts).sort(
    ([a], [b]) => a.localeCompare(b),
  );
  for (const [type, count] of sortedTypes) {
    lines.push(`- ${type}: ${count}`);
  }
  lines.push('');
  lines.push(`- duplicate text pairs: ${timeline.summary.duplicateTextPairs}`);
  lines.push(`- gaps: ${timeline.summary.gaps.length}`);

  return lines.join('\n');
}

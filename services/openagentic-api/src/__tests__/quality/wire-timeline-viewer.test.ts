/**
 * Wire NDJSON timeline viewer — RED tests (Phase 0.1).
 *
 * Plan: docs/superpowers/plans/sprightly-percolating-brook.md §0.1
 *
 * The viewer is a pure replay function: given an array of WIRE-CAPTURE log
 * lines (or raw text from `kubectl logs ... | grep WIRE-CAPTURE`), produce
 * a chronological Timeline with:
 *   - per-entry seq + tOffsetMs + frameType + index + preview + annotations
 *   - summary counts + duplicate-pair detection + gap detection
 *
 * Annotations the rip relies on:
 *   - NEW_TEXT_BLOCK    — a text frame whose `index` differs from the prior text frame's index
 *   - DUPLICATE_PROSE   — a `stream` envelope + `content_block_delta(text_delta)` pair carrying
 *                          the same text content within the same wall-clock window (the dual-emit
 *                          race that produces "LetLet me" character duplication)
 *   - GAP_BEFORE        — log-seq jumped by >1 from the previous frame
 *   - COALESCED_BATCH   — N>=4 consecutive tool_use/tool_executing/tool_result frames with no
 *                          text frame between them (the Q7 interleave Sev-0 pattern)
 *
 * These annotations drive Phase 1 baseline + the Phase 5 contract gate.
 */
import { describe, it, expect } from 'vitest';
import {
  parseWireCaptureLog,
  buildTimeline,
  renderTimelineMarkdown,
  type RawWireLogLine,
} from './wire-timeline-viewer.js';

/**
 * Self-contained pino-wrapped WIRE-CAPTURE log fixture.
 * Shape matches reports/wire-captures/q7-iter1-*.log lines.
 * Six frames: thinking → text → tool_use → tool_result → text → tool_use → tool_result → text.
 * Plus one duplicate-prose race at seq=2/3 (stream + content_block_delta carrying "Good — ").
 */
const FIXTURE_LOG_PINO = [
  `{"level":30,"time":1700000000000,"pid":1,"name":"api","tag":"WIRE-CAPTURE","turnId":"t-fixture","seq":1,"frameType":"thinking","payload":{"_seq":1,"_runId":"t-fixture","_ts":1700000000000,"thinking":"Let me check three clouds"},"msg":"[WIRE-CAPTURE]"}`,
  `{"level":30,"time":1700000000500,"pid":1,"name":"api","tag":"WIRE-CAPTURE","turnId":"t-fixture","seq":2,"frameType":"stream","payload":{"_seq":2,"_runId":"t-fixture","_ts":1700000000500,"content":"Good — "},"msg":"[WIRE-CAPTURE]"}`,
  `{"level":30,"time":1700000000501,"pid":1,"name":"api","tag":"WIRE-CAPTURE","turnId":"t-fixture","seq":3,"frameType":"content_block_delta","payload":{"_seq":3,"_runId":"t-fixture","_ts":1700000000501,"delta":{"type":"text_delta","text":"Good — "},"index":1},"msg":"[WIRE-CAPTURE]"}`,
  `{"level":30,"time":1700000001000,"pid":1,"name":"api","tag":"WIRE-CAPTURE","turnId":"t-fixture","seq":4,"frameType":"tool_executing","payload":{"_seq":4,"_runId":"t-fixture","_ts":1700000001000,"name":"aws_cost_by_service","tool_use_id":"toolu_001"},"msg":"[WIRE-CAPTURE]"}`,
  `{"level":30,"time":1700000003000,"pid":1,"name":"api","tag":"WIRE-CAPTURE","turnId":"t-fixture","seq":5,"frameType":"tool_result","payload":{"_seq":5,"_runId":"t-fixture","_ts":1700000003000,"name":"aws_cost_by_service","tool_use_id":"toolu_001","content":{"summary":"ok"},"is_error":false},"msg":"[WIRE-CAPTURE]"}`,
  `{"level":30,"time":1700000003500,"pid":1,"name":"api","tag":"WIRE-CAPTURE","turnId":"t-fixture","seq":6,"frameType":"content_block_delta","payload":{"_seq":6,"_runId":"t-fixture","_ts":1700000003500,"delta":{"type":"text_delta","text":"Now pulling Azure"},"index":3},"msg":"[WIRE-CAPTURE]"}`,
  `{"level":30,"time":1700000004000,"pid":1,"name":"api","tag":"WIRE-CAPTURE","turnId":"t-fixture","seq":7,"frameType":"tool_executing","payload":{"_seq":7,"_runId":"t-fixture","_ts":1700000004000,"name":"azure_cost_by_service","tool_use_id":"toolu_002"},"msg":"[WIRE-CAPTURE]"}`,
  `{"level":30,"time":1700000006000,"pid":1,"name":"api","tag":"WIRE-CAPTURE","turnId":"t-fixture","seq":8,"frameType":"tool_result","payload":{"_seq":8,"_runId":"t-fixture","_ts":1700000006000,"name":"azure_cost_by_service","tool_use_id":"toolu_002","content":{"summary":"ok"},"is_error":false},"msg":"[WIRE-CAPTURE]"}`,
  `{"level":30,"time":1700000006500,"pid":1,"name":"api","tag":"WIRE-CAPTURE","turnId":"t-fixture","seq":9,"frameType":"content_block_delta","payload":{"_seq":9,"_runId":"t-fixture","_ts":1700000006500,"delta":{"type":"text_delta","text":"Across all three"},"index":5},"msg":"[WIRE-CAPTURE]"}`,
  `{"level":30,"time":1700000006600,"pid":1,"name":"api","tag":"WIRE-CAPTURE","turnId":"t-fixture","seq":10,"frameType":"message_stop","payload":{"_seq":10,"_runId":"t-fixture","_ts":1700000006600},"msg":"[WIRE-CAPTURE]"}`,
].join('\n');

/**
 * Coalesced batch fixture — 5 consecutive tool frames with no text between.
 * Matches the Q7 Sev-0 wire shape where all tool_use blocks arrive before any text_delta.
 */
const FIXTURE_LOG_COALESCED = [
  `{"level":30,"time":1700000000000,"name":"api","tag":"WIRE-CAPTURE","turnId":"t-q7","seq":1,"frameType":"thinking","payload":{"_seq":1,"_runId":"t-q7","_ts":1700000000000,"thinking":"think"},"msg":"[WIRE-CAPTURE]"}`,
  `{"level":30,"time":1700000001000,"name":"api","tag":"WIRE-CAPTURE","turnId":"t-q7","seq":2,"frameType":"tool_executing","payload":{"_seq":2,"_runId":"t-q7","_ts":1700000001000,"name":"t1","tool_use_id":"a"},"msg":"[WIRE-CAPTURE]"}`,
  `{"level":30,"time":1700000001100,"name":"api","tag":"WIRE-CAPTURE","turnId":"t-q7","seq":3,"frameType":"tool_executing","payload":{"_seq":3,"_runId":"t-q7","_ts":1700000001100,"name":"t2","tool_use_id":"b"},"msg":"[WIRE-CAPTURE]"}`,
  `{"level":30,"time":1700000001200,"name":"api","tag":"WIRE-CAPTURE","turnId":"t-q7","seq":4,"frameType":"tool_executing","payload":{"_seq":4,"_runId":"t-q7","_ts":1700000001200,"name":"t3","tool_use_id":"c"},"msg":"[WIRE-CAPTURE]"}`,
  `{"level":30,"time":1700000001300,"name":"api","tag":"WIRE-CAPTURE","turnId":"t-q7","seq":5,"frameType":"tool_executing","payload":{"_seq":5,"_runId":"t-q7","_ts":1700000001300,"name":"t4","tool_use_id":"d"},"msg":"[WIRE-CAPTURE]"}`,
  `{"level":30,"time":1700000003000,"name":"api","tag":"WIRE-CAPTURE","turnId":"t-q7","seq":6,"frameType":"tool_result","payload":{"_seq":6,"_runId":"t-q7","_ts":1700000003000,"name":"t1","tool_use_id":"a","content":{},"is_error":false},"msg":"[WIRE-CAPTURE]"}`,
  `{"level":30,"time":1700000003100,"name":"api","tag":"WIRE-CAPTURE","turnId":"t-q7","seq":7,"frameType":"tool_result","payload":{"_seq":7,"_runId":"t-q7","_ts":1700000003100,"name":"t2","tool_use_id":"b","content":{},"is_error":false},"msg":"[WIRE-CAPTURE]"}`,
  `{"level":30,"time":1700000003200,"name":"api","tag":"WIRE-CAPTURE","turnId":"t-q7","seq":8,"frameType":"content_block_delta","payload":{"_seq":8,"_runId":"t-q7","_ts":1700000003200,"delta":{"type":"text_delta","text":"All done"},"index":4},"msg":"[WIRE-CAPTURE]"}`,
].join('\n');

describe('parseWireCaptureLog', () => {
  it('extracts WIRE-CAPTURE log lines from pino-wrapped output', () => {
    const frames = parseWireCaptureLog(FIXTURE_LOG_PINO);
    expect(frames).toHaveLength(10);
    expect(frames[0].turnId).toBe('t-fixture');
    expect(frames[0].seq).toBe(1);
    expect(frames[0].frameType).toBe('thinking');
  });

  it('ignores non-WIRE-CAPTURE pino lines', () => {
    const mixed = [
      `{"level":30,"time":1700000000000,"msg":"some other log"}`,
      `{"level":30,"time":1700000000001,"tag":"WIRE-CAPTURE","turnId":"t-x","seq":1,"frameType":"thinking","payload":{}}`,
      `not even json`,
    ].join('\n');
    const frames = parseWireCaptureLog(mixed);
    expect(frames).toHaveLength(1);
    expect(frames[0].turnId).toBe('t-x');
  });

  it('handles bare WIRE-CAPTURE JSON (no pino wrapper)', () => {
    const bare = `{"tag":"WIRE-CAPTURE","turnId":"t-b","seq":1,"frameType":"thinking","payload":{"_ts":1700000000000}}`;
    const frames = parseWireCaptureLog(bare);
    expect(frames).toHaveLength(1);
    expect(frames[0].turnId).toBe('t-b');
  });
});

describe('buildTimeline', () => {
  it('produces chronologically ordered entries with tOffsetMs from first frame', () => {
    const frames = parseWireCaptureLog(FIXTURE_LOG_PINO);
    const timeline = buildTimeline(frames);

    expect(timeline.turnId).toBe('t-fixture');
    expect(timeline.entries).toHaveLength(10);
    expect(timeline.entries[0].tOffsetMs).toBe(0);
    expect(timeline.entries[1].tOffsetMs).toBe(500);
    expect(timeline.entries[9].tOffsetMs).toBe(6600);
  });

  it('classifies frame types into summary counts', () => {
    const timeline = buildTimeline(parseWireCaptureLog(FIXTURE_LOG_PINO));
    expect(timeline.summary.toolExecuting).toBe(2);
    expect(timeline.summary.toolResults).toBe(2);
    expect(timeline.summary.streamFrames).toBe(1);
    expect(timeline.summary.contentBlockDeltas).toBe(3);
    expect(timeline.summary.thinkingFrames).toBe(1);
  });

  it('annotates DUPLICATE_PROSE on stream+content_block_delta pair with matching text', () => {
    const timeline = buildTimeline(parseWireCaptureLog(FIXTURE_LOG_PINO));
    // seq=2 is the `stream` envelope "Good — "; seq=3 is the canonical text_delta "Good — ".
    // Both must carry the DUPLICATE_PROSE annotation.
    const seq2 = timeline.entries.find((e) => e.seq === 2)!;
    const seq3 = timeline.entries.find((e) => e.seq === 3)!;
    expect(seq2.annotations).toContain('DUPLICATE_PROSE');
    expect(seq3.annotations).toContain('DUPLICATE_PROSE');
    expect(timeline.summary.duplicateTextPairs).toBe(1);
  });

  it('annotates NEW_TEXT_BLOCK when index changes between text frames', () => {
    const timeline = buildTimeline(parseWireCaptureLog(FIXTURE_LOG_PINO));
    // First text frame after the duplicate pair is seq=6 (index=3).
    // seq=9 has index=5 — must be marked NEW_TEXT_BLOCK.
    const seq9 = timeline.entries.find((e) => e.seq === 9)!;
    expect(seq9.annotations).toContain('NEW_TEXT_BLOCK');
  });

  it('annotates COALESCED_BATCH on >=4 consecutive tool frames with no text between', () => {
    const timeline = buildTimeline(parseWireCaptureLog(FIXTURE_LOG_COALESCED));
    // 4 consecutive tool_executing (seq 2-5) followed by 2 tool_result (6-7) then text (8).
    // The four tool_executing entries should all carry COALESCED_BATCH.
    const toolExecs = timeline.entries.filter((e) => e.frameType === 'tool_executing');
    expect(toolExecs).toHaveLength(4);
    for (const e of toolExecs) {
      expect(e.annotations).toContain('COALESCED_BATCH');
    }
  });

  it('detects GAP_BEFORE when log seq jumps by more than 1', () => {
    const gapped = [
      `{"tag":"WIRE-CAPTURE","turnId":"t-g","seq":1,"frameType":"thinking","payload":{"_ts":1700000000000}}`,
      `{"tag":"WIRE-CAPTURE","turnId":"t-g","seq":5,"frameType":"stream","payload":{"_ts":1700000001000,"content":"x"}}`,
    ].join('\n');
    const timeline = buildTimeline(parseWireCaptureLog(gapped));
    const seq5 = timeline.entries.find((e) => e.seq === 5)!;
    expect(seq5.annotations).toContain('GAP_BEFORE');
    expect(timeline.summary.gaps).toEqual([2, 3, 4]);
  });

  it('extracts preview from text_delta + thinking + tool name', () => {
    const timeline = buildTimeline(parseWireCaptureLog(FIXTURE_LOG_PINO));
    const thinking = timeline.entries[0];
    expect(thinking.preview).toContain('Let me check');

    const streamFrame = timeline.entries.find((e) => e.frameType === 'stream')!;
    expect(streamFrame.preview).toBe('Good — ');

    const toolExec = timeline.entries.find((e) => e.frameType === 'tool_executing')!;
    expect(toolExec.toolName).toBe('aws_cost_by_service');
    expect(toolExec.toolUseId).toBe('toolu_001');
  });
});

describe('renderTimelineMarkdown', () => {
  it('emits a markdown timeline with one line per entry', () => {
    const timeline = buildTimeline(parseWireCaptureLog(FIXTURE_LOG_PINO));
    const md = renderTimelineMarkdown(timeline);

    // Header section
    expect(md).toContain('# Wire Timeline — t-fixture');
    expect(md).toContain('Duration: 6.6s');
    expect(md).toContain('10 frames');

    // Per-entry rows (seq field padded for column alignment, allow whitespace).
    expect(md).toMatch(/t\+0\.0s\s+seq=\s*1\s+thinking/);
    expect(md).toMatch(/t\+0\.5s\s+seq=\s*2\s+stream/);
    expect(md).toMatch(/t\+0\.5s\s+seq=\s*3\s+content_block_delta/);
    expect(md).toMatch(/t\+6\.6s\s+seq=\s*10\s+message_stop/);

    // Annotation markers
    expect(md).toContain('DUPLICATE_PROSE');
    expect(md).toContain('NEW_TEXT_BLOCK');
  });

  it('flags coalesced batches visibly', () => {
    const timeline = buildTimeline(parseWireCaptureLog(FIXTURE_LOG_COALESCED));
    const md = renderTimelineMarkdown(timeline);
    expect(md).toContain('COALESCED_BATCH');
    expect(md).toMatch(/\*\*Sev-0\*\*|🚨/i);
  });

  it('summarizes frame-type counts at the foot', () => {
    const timeline = buildTimeline(parseWireCaptureLog(FIXTURE_LOG_PINO));
    const md = renderTimelineMarkdown(timeline);
    expect(md).toContain('## Summary');
    expect(md).toMatch(/tool_executing:\s*2/);
    expect(md).toMatch(/content_block_delta:\s*3/);
    expect(md).toMatch(/stream:\s*1/);
    expect(md).toMatch(/duplicate text pairs:\s*1/i);
  });
});

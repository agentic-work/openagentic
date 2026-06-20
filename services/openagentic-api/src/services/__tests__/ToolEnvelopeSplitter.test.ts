/**
 * Phase 4 / Task 4.2 — ToolEnvelopeSplitter (RED → GREEN).
 *
 * Splits raw tool output into the two-channel envelope per Spec §6.2.
 *
 *   - raw < threshold: full content in `structuredContent.data`; no artifactHandle.
 *   - raw >= threshold AND largeResultStorage given: store full + summarize;
 *     `_meta.artifactHandle` set, `structuredContent.truncated === true`.
 *   - tool.truncate_summary fn (when provided): drives shaped digest in overflow path.
 *
 * the design notes
 */
import { describe, it, expect, vi } from 'vitest';
import { splitEnvelope } from '../ToolEnvelopeSplitter.js';

describe('ToolEnvelopeSplitter', () => {
  it('returns full content in structuredContent.data when raw < threshold', async () => {
    const raw = { items: [1, 2, 3] };
    const result = await splitEnvelope({
      raw,
      tool: { slug: 'test_tool', outputTemplate: 'list' },
      sessionId: 's1',
      toolUseId: 'tu1',
      elapsed: 42,
    });
    expect(result.ok).toBe(true);
    expect(result.structuredContent.data).toEqual(raw);
    expect(result._meta.outputTemplate).toBe('list');
    expect(result._meta.artifactHandle).toBeUndefined();
    expect(result._meta.elapsed).toBe(42);
    expect(result.structuredContent.truncated).toBeUndefined();
  });

  it('routes raw > threshold to LargeResultStorage and sets artifactHandle', async () => {
    const big = { items: Array(20000).fill('row') };
    const put = vi.fn().mockResolvedValue('result#tr_tu2');
    const result = await splitEnvelope({
      raw: big,
      tool: { slug: 'test_tool', outputTemplate: 'list' },
      sessionId: 's1',
      toolUseId: 'tu2',
      elapsed: 100,
      largeResultStorage: { put },
    });
    expect(put).toHaveBeenCalledWith(
      big,
      expect.objectContaining({ sessionId: 's1', toolUseId: 'tu2' }),
    );
    expect(result._meta.artifactHandle).toBe('result#tr_tu2');
    expect(result.structuredContent.truncated).toBe(true);
  });

  it('uses tool-supplied truncate_summary when overflow', async () => {
    // 5000 × {name:'pod'} ≈ 75KB serialized — comfortably > 30KB default.
    const big = Array(5000).fill({ name: 'pod' });
    const truncate_summary = (raw: any) => ({
      summary: `${raw.length} pods. First: ${raw[0].name}`,
      data: { count: raw.length },
      truncated: true,
    });
    const put = vi.fn().mockResolvedValue('handle');
    const result = await splitEnvelope({
      raw: big,
      tool: { slug: 'k8s_list_pods', outputTemplate: 'k8s_pod_list', truncate_summary },
      sessionId: 's1',
      toolUseId: 'tu3',
      elapsed: 50,
      largeResultStorage: { put },
    });
    expect(result.structuredContent.summary).toContain('pods');
    expect(result.structuredContent.data).toEqual({ count: 5000 });
    expect(result.structuredContent.truncated).toBe(true);
  });

  it('size reflects raw byte count of the underlying payload', async () => {
    const result = await splitEnvelope({
      raw: 'hello world',
      tool: { slug: 't' },
      sessionId: 's',
      toolUseId: 'tu',
      elapsed: 1,
    });
    // String passthrough — 11 raw bytes (no JSON-wrapping for strings).
    expect(result._meta.size).toBe(11);
  });

  it('size reflects raw byte count of serialized JSON for objects', async () => {
    const result = await splitEnvelope({
      raw: { a: 1 },
      tool: { slug: 't' },
      sessionId: 's',
      toolUseId: 'tu',
      elapsed: 1,
    });
    // JSON.stringify({a:1}) === '{"a":1}' → 7 bytes.
    expect(result._meta.size).toBe(7);
  });

  it('threshold is configurable via thresholdBytes', async () => {
    const raw = 'x'.repeat(100);
    const put = vi.fn().mockResolvedValue('h');
    const result = await splitEnvelope({
      raw,
      tool: { slug: 't' },
      sessionId: 's',
      toolUseId: 'tu',
      elapsed: 1,
      thresholdBytes: 10,
      largeResultStorage: { put },
    });
    expect(result._meta.artifactHandle).toBe('h');
    expect(result.structuredContent.truncated).toBe(true);
  });

  it('overflow without largeResultStorage falls back to inline (no handle, no overflow)', async () => {
    // Defensive: if storage not wired, NEVER drop data — keep inline so the
    // model still sees the result. artifactHandle stays undefined.
    const big = 'x'.repeat(50_000);
    const result = await splitEnvelope({
      raw: big,
      tool: { slug: 't' },
      sessionId: 's',
      toolUseId: 'tu',
      elapsed: 1,
      thresholdBytes: 10,
      // no largeResultStorage
    });
    expect(result._meta.artifactHandle).toBeUndefined();
    expect(result.structuredContent.data).toBe(big);
  });

  it('respects ok flag explicitly', async () => {
    const result = await splitEnvelope({
      raw: { error: 'boom' },
      tool: { slug: 't' },
      sessionId: 's',
      toolUseId: 'tu',
      elapsed: 1,
      ok: false,
    });
    expect(result.ok).toBe(false);
  });

  it('threads cost into _meta when supplied', async () => {
    const result = await splitEnvelope({
      raw: {},
      tool: { slug: 't' },
      sessionId: 's',
      toolUseId: 'tu',
      elapsed: 1,
      cost: 0.0042,
    });
    expect(result._meta.cost).toBe(0.0042);
  });
});

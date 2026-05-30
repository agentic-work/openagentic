import { describe, test, expect, vi, beforeEach, afterEach } from 'vitest';
import { maybeEmitWireCapture, __resetWireCaptureSeq } from '../infra/wireCapture.js';

// Diagnostic-only instrumentation gated by WIRE_CAPTURE_ENABLED=true.
// Emits one structured log line per NDJSON frame so we can reconstruct the
// raw chronological wire shape from kubectl logs and diagnose the Q7 interleave
// coalesce (CLAUDE.md rule 8(a)). The pin in MEMORY.md PM3 RESUME-HERE calls
// this iteration-1 step-1.

describe('maybeEmitWireCapture', () => {
  const originalEnv = process.env.WIRE_CAPTURE_ENABLED;
  let logger: { info: ReturnType<typeof vi.fn> };

  beforeEach(() => {
    logger = { info: vi.fn() };
    __resetWireCaptureSeq();
  });

  afterEach(() => {
    if (originalEnv === undefined) delete process.env.WIRE_CAPTURE_ENABLED;
    else process.env.WIRE_CAPTURE_ENABLED = originalEnv;
  });

  test('emits a [WIRE-CAPTURE]-tagged log line when WIRE_CAPTURE_ENABLED=true', () => {
    process.env.WIRE_CAPTURE_ENABLED = 'true';
    maybeEmitWireCapture(logger, 'turn-abc', 'tool_executing', { name: 'azure_list_subscriptions' });
    expect(logger.info).toHaveBeenCalledTimes(1);
    const [obj, msg] = logger.info.mock.calls[0];
    expect(msg).toBe('[WIRE-CAPTURE]');
    expect(obj).toMatchObject({
      tag: 'WIRE-CAPTURE',
      turnId: 'turn-abc',
      frameType: 'tool_executing',
    });
    expect(obj.payload).toBeDefined();
  });

  test('does not emit when WIRE_CAPTURE_ENABLED is unset', () => {
    delete process.env.WIRE_CAPTURE_ENABLED;
    maybeEmitWireCapture(logger, 'turn-abc', 'tool_executing', { name: 'x' });
    expect(logger.info).not.toHaveBeenCalled();
  });

  test('does not emit when WIRE_CAPTURE_ENABLED is "false"', () => {
    process.env.WIRE_CAPTURE_ENABLED = 'false';
    maybeEmitWireCapture(logger, 'turn-abc', 'tool_executing', { name: 'x' });
    expect(logger.info).not.toHaveBeenCalled();
  });

  test('preserves a monotonic frame sequence per turn so coalesce vs interleave is reconstructible', () => {
    process.env.WIRE_CAPTURE_ENABLED = 'true';
    maybeEmitWireCapture(logger, 'turn-xyz', 'stream', { delta: { type: 'text_delta', text: 'a' } });
    maybeEmitWireCapture(logger, 'turn-xyz', 'tool_executing', { name: 'azure_list_vms' });
    maybeEmitWireCapture(logger, 'turn-xyz', 'stream', { delta: { type: 'text_delta', text: 'b' } });
    expect(logger.info).toHaveBeenCalledTimes(3);
    const seqs = logger.info.mock.calls.map(c => c[0].seq);
    expect(seqs).toEqual([1, 2, 3]);
  });

  test('frame sequences are scoped per turn (different turnIds restart at 1)', () => {
    process.env.WIRE_CAPTURE_ENABLED = 'true';
    maybeEmitWireCapture(logger, 'turn-A', 'stream', {});
    maybeEmitWireCapture(logger, 'turn-A', 'stream', {});
    maybeEmitWireCapture(logger, 'turn-B', 'stream', {});
    const seqsA = logger.info.mock.calls.filter(c => c[0].turnId === 'turn-A').map(c => c[0].seq);
    const seqsB = logger.info.mock.calls.filter(c => c[0].turnId === 'turn-B').map(c => c[0].seq);
    expect(seqsA).toEqual([1, 2]);
    expect(seqsB).toEqual([1]);
  });
});

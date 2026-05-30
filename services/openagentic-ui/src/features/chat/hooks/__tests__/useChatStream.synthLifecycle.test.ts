/**
 * AC-B — synth lifecycle reducer.
 *
 * One unified `Synth` per `artifactId` accumulates across the
 * lifecycle frames the API streams as the model authors + executes
 * Python in the synth-executor sandbox:
 *
 *   synth_planned         → entry created with intent/caps/risk/codeLang
 *   synth_code_chunk      → code string appends fragment by chunk_index
 *   synth_approval_requested → stage='awaiting_approval'
 *   synth_approved        → stage='approved'
 *   synth_denied          → stage='denied' (+ reason)
 *   synth_executing       → stage='executing' (startedAt)
 *   synth_stdout          → stdout/stderr buffer appends (stream-tagged)
 *   synth_completed       → stage='completed' (durationMs, exitCode, error?)
 *
 * Same shape contract as StreamingTable / Findings / InlineWidget:
 *  - empty messageId → drop
 *  - empty artifact_id → drop
 *  - unknown frame type → drop (defense in depth)
 *  - hot-swap by artifactId; per-message scope; no input mutation
 */

import { describe, it, expect } from 'vitest';
import {
  applySynthLifecycleFrame,
  type Synth,
  type SynthLifecycleFrame,
} from '../useChatStream';

const planned = (overrides: Partial<SynthLifecycleFrame> = {}): SynthLifecycleFrame => ({
  type: 'synth_planned',
  artifact_id: 's-1',
  intent: 'convert report to pdf',
  capabilities: ['filesystem', 'data'],
  risk_level: 'low',
  risk_reason: 'no destructive operations',
  code_lang: 'python',
  ...overrides,
} as SynthLifecycleFrame);

describe('applySynthLifecycleFrame — AC-B unified synth lifecycle reducer', () => {
  it('creates a new entry on synth_planned with intent/caps/risk', () => {
    const next = applySynthLifecycleFrame({}, 'msg-1', planned());
    expect(next['msg-1']).toBeDefined();
    expect(next['msg-1']).toHaveLength(1);
    expect(next['msg-1'][0]).toMatchObject({
      artifactId: 's-1',
      stage: 'planned',
      intent: 'convert report to pdf',
      capabilities: ['filesystem', 'data'],
      riskLevel: 'low',
      riskReason: 'no destructive operations',
      code: '',
      codeLang: 'python',
      stdout: '',
      stderr: '',
    });
  });

  it('does not mutate the input map', () => {
    const before: Record<string, Synth[]> = {};
    const next = applySynthLifecycleFrame(before, 'msg-1', planned());
    expect(next).not.toBe(before);
    expect(before['msg-1']).toBeUndefined();
  });

  it('appends code fragments in chunk order', () => {
    let m: Record<string, Synth[]> = {};
    m = applySynthLifecycleFrame(m, 'msg-1', planned());
    m = applySynthLifecycleFrame(m, 'msg-1', {
      type: 'synth_code_chunk',
      artifact_id: 's-1',
      chunk_index: 0,
      code_fragment: 'import sys\n',
    } as SynthLifecycleFrame);
    m = applySynthLifecycleFrame(m, 'msg-1', {
      type: 'synth_code_chunk',
      artifact_id: 's-1',
      chunk_index: 1,
      code_fragment: 'print("hi")\n',
    } as SynthLifecycleFrame);
    expect(m['msg-1'][0].code).toBe('import sys\nprint("hi")\n');
  });

  it('transitions stage on approval lifecycle frames', () => {
    let m: Record<string, Synth[]> = {};
    m = applySynthLifecycleFrame(m, 'msg-1', planned());
    m = applySynthLifecycleFrame(m, 'msg-1', {
      type: 'synth_approval_requested',
      artifact_id: 's-1',
    } as SynthLifecycleFrame);
    expect(m['msg-1'][0].stage).toBe('awaiting_approval');
    m = applySynthLifecycleFrame(m, 'msg-1', {
      type: 'synth_approved',
      artifact_id: 's-1',
    } as SynthLifecycleFrame);
    expect(m['msg-1'][0].stage).toBe('approved');
  });

  it('records denial reason on synth_denied', () => {
    let m: Record<string, Synth[]> = {};
    m = applySynthLifecycleFrame(m, 'msg-1', planned({ risk_level: 'high' } as Partial<SynthLifecycleFrame>));
    m = applySynthLifecycleFrame(m, 'msg-1', {
      type: 'synth_denied',
      artifact_id: 's-1',
      reason: 'user rejected',
    } as SynthLifecycleFrame);
    expect(m['msg-1'][0].stage).toBe('denied');
    expect(m['msg-1'][0].denialReason).toBe('user rejected');
  });

  it('transitions to executing on synth_executing and records startedAt', () => {
    let m: Record<string, Synth[]> = {};
    m = applySynthLifecycleFrame(m, 'msg-1', planned());
    m = applySynthLifecycleFrame(m, 'msg-1', {
      type: 'synth_executing',
      artifact_id: 's-1',
      started_at: 1700000000000,
    } as SynthLifecycleFrame);
    expect(m['msg-1'][0].stage).toBe('executing');
    expect(m['msg-1'][0].startedAt).toBe(1700000000000);
  });

  it('appends stdout chunks tagged by stream into the right buffer', () => {
    let m: Record<string, Synth[]> = {};
    m = applySynthLifecycleFrame(m, 'msg-1', planned());
    m = applySynthLifecycleFrame(m, 'msg-1', {
      type: 'synth_stdout',
      artifact_id: 's-1',
      chunk: 'hello\n',
      stream: 'stdout',
    } as SynthLifecycleFrame);
    m = applySynthLifecycleFrame(m, 'msg-1', {
      type: 'synth_stdout',
      artifact_id: 's-1',
      chunk: 'warn: foo\n',
      stream: 'stderr',
    } as SynthLifecycleFrame);
    m = applySynthLifecycleFrame(m, 'msg-1', {
      type: 'synth_stdout',
      artifact_id: 's-1',
      chunk: 'world\n',
      stream: 'stdout',
    } as SynthLifecycleFrame);
    expect(m['msg-1'][0].stdout).toBe('hello\nworld\n');
    expect(m['msg-1'][0].stderr).toBe('warn: foo\n');
  });

  it('marks completed with duration + exitCode', () => {
    let m: Record<string, Synth[]> = {};
    m = applySynthLifecycleFrame(m, 'msg-1', planned());
    m = applySynthLifecycleFrame(m, 'msg-1', {
      type: 'synth_completed',
      artifact_id: 's-1',
      duration_ms: 1234,
      exit_code: 0,
    } as SynthLifecycleFrame);
    expect(m['msg-1'][0].stage).toBe('completed');
    expect(m['msg-1'][0].durationMs).toBe(1234);
    expect(m['msg-1'][0].exitCode).toBe(0);
  });

  it('marks failed when synth_completed carries non-zero exit + error', () => {
    let m: Record<string, Synth[]> = {};
    m = applySynthLifecycleFrame(m, 'msg-1', planned());
    m = applySynthLifecycleFrame(m, 'msg-1', {
      type: 'synth_completed',
      artifact_id: 's-1',
      duration_ms: 50,
      exit_code: 1,
      error: 'TypeError: ...',
    } as SynthLifecycleFrame);
    expect(m['msg-1'][0].stage).toBe('failed');
    expect(m['msg-1'][0].exitCode).toBe(1);
    expect(m['msg-1'][0].error).toBe('TypeError: ...');
  });

  it('drops frames silently when messageId is empty', () => {
    const next = applySynthLifecycleFrame({}, '', planned());
    expect(Object.keys(next)).toHaveLength(0);
  });

  it('drops frames silently when artifact_id is empty', () => {
    const next = applySynthLifecycleFrame({}, 'msg-1', planned({ artifact_id: '' } as Partial<SynthLifecycleFrame>));
    expect((next['msg-1'] ?? []).length).toBe(0);
  });

  it('drops frames silently for unknown frame type (defense in depth)', () => {
    const next = applySynthLifecycleFrame({}, 'msg-1', {
      type: 'synth_mystery_box',
      artifact_id: 's-1',
    } as unknown as SynthLifecycleFrame);
    expect((next['msg-1'] ?? []).length).toBe(0);
  });

  it('does not create an entry if first frame is a non-planned lifecycle update (defense)', () => {
    const next = applySynthLifecycleFrame({}, 'msg-1', {
      type: 'synth_executing',
      artifact_id: 's-orphan',
      started_at: 1,
    } as SynthLifecycleFrame);
    // Without a prior synth_planned, lifecycle frames shouldn't fabricate
    // an entry — the planned frame is the only one that creates state.
    expect((next['msg-1'] ?? []).length).toBe(0);
  });

  it('keeps entries for other messageIds untouched', () => {
    let m: Record<string, Synth[]> = {};
    m = applySynthLifecycleFrame(m, 'msg-1', planned({ artifact_id: 's-1' }));
    m = applySynthLifecycleFrame(m, 'msg-2', planned({ artifact_id: 's-99' }));
    expect(m['msg-1'][0].artifactId).toBe('s-1');
    expect(m['msg-2'][0].artifactId).toBe('s-99');
    expect(m['msg-1']).toHaveLength(1);
    expect(m['msg-2']).toHaveLength(1);
  });
});

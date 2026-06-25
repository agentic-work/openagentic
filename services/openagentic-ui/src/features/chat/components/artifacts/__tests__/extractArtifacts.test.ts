/**
 * #781 Phase D.2 — extractArtifacts helper tests.
 *
 * Scans a chat Message for new-pipeline artifacts:
 *   - Source A: message.visualizations[] entries (persisted from
 *     compose_visual / compose_app frames by A1 in this issue).
 *   - Source B: tool_result blocks with `_meta.artifactKind` set
 *     (A2/A3 wired the server to stamp this on synth_execute /
 *     compose_visual / compose_app emissions).
 *
 * Contract: returns a list of `{ kind, title, payload, status }`
 * descriptors that MessageBubble feeds into
 * `ArtifactSlideOutLauncher` instances.
 *
 * Legacy ```artifact:html fences are NOT picked up — those route
 * through the legacy ArtifactRenderer until Phase D.3 ripping.
 */
import { describe, it, expect } from 'vitest';
import { extractArtifacts } from '../extractArtifacts.js';

describe('extractArtifacts — #781 Phase D.2', () => {
  it('returns empty array when message has neither visualizations nor _meta.artifactKind', () => {
    const msg: any = {
      id: 'm1',
      content: 'Just text, no artifacts.',
    };
    expect(extractArtifacts(msg)).toEqual([]);
  });

  it('extracts a single visualization', () => {
    const msg: any = {
      id: 'm1',
      visualizations: [
        {
          kind: 'chart',
          title: 'AWS cost spike',
          payload: { kind: 'bar', data: [{ label: 'Jan', value: 100 }] },
        },
      ],
    };
    const out = extractArtifacts(msg);
    expect(out).toHaveLength(1);
    expect(out[0].kind).toBe('chart');
    expect(out[0].title).toBe('AWS cost spike');
    expect(out[0].status).toBe('success');
  });

  it('extracts multiple visualizations in order', () => {
    const msg: any = {
      id: 'm1',
      visualizations: [
        { kind: 'chart', title: 'A', payload: {} },
        { kind: 'table', title: 'B', payload: {} },
        { kind: 'runbook', title: 'C', payload: {} },
      ],
    };
    const out = extractArtifacts(msg);
    expect(out.map((a) => a.title)).toEqual(['A', 'B', 'C']);
  });

  it('extracts artifacts from tool_result blocks with _meta.artifactKind', () => {
    const msg: any = {
      id: 'm1',
      toolResults: [
        {
          tool_use_id: 't1',
          content: 'output here',
          _meta: {
            artifactKind: 'python-report',
            artifactTitle: 'Cost analysis',
            payload: { stdout: '# Report\n\nbody', executionTimeMs: 142 },
          },
        },
      ],
    };
    const out = extractArtifacts(msg);
    expect(out).toHaveLength(1);
    expect(out[0].kind).toBe('python-report');
    expect(out[0].title).toBe('Cost analysis');
    expect(out[0].payload).toEqual({
      stdout: '# Report\n\nbody',
      executionTimeMs: 142,
    });
  });

  it('combines visualizations + tool_result artifacts (no duplication)', () => {
    const msg: any = {
      id: 'm1',
      visualizations: [
        { kind: 'chart', title: 'Viz', payload: {} },
      ],
      toolResults: [
        {
          tool_use_id: 't1',
          content: '',
          _meta: {
            artifactKind: 'runbook',
            artifactTitle: 'Runbook',
            payload: { id: 'rb1', steps: [] },
          },
        },
      ],
    };
    const out = extractArtifacts(msg);
    expect(out).toHaveLength(2);
    expect(out.map((a) => a.kind).sort()).toEqual(['chart', 'runbook']);
  });

  it('skips tool_result blocks without _meta.artifactKind', () => {
    const msg: any = {
      id: 'm1',
      toolResults: [
        { tool_use_id: 't1', content: 'plain tool output, no artifact' },
        {
          tool_use_id: 't2',
          content: '',
          _meta: {
            artifactKind: 'table',
            artifactTitle: 'T',
            payload: { rows: [], columns: [] },
          },
        },
      ],
    };
    const out = extractArtifacts(msg);
    expect(out).toHaveLength(1);
    expect(out[0].kind).toBe('table');
  });

  it('marks artifacts with status="error" when _meta.status is "error"', () => {
    const msg: any = {
      id: 'm1',
      toolResults: [
        {
          tool_use_id: 't1',
          content: 'failed',
          _meta: {
            artifactKind: 'mini-app',
            artifactTitle: 'Sandbox',
            status: 'error',
            payload: { error: 'capability outside scope' },
          },
        },
      ],
    };
    const out = extractArtifacts(msg);
    expect(out[0].status).toBe('error');
  });

  it('falls back to the kind label as title when _meta.artifactTitle is missing', () => {
    const msg: any = {
      id: 'm1',
      toolResults: [
        {
          tool_use_id: 't1',
          content: '',
          _meta: { artifactKind: 'chart', payload: {} },
        },
      ],
    };
    const out = extractArtifacts(msg);
    expect(out[0].title.toLowerCase()).toContain('chart');
  });

  // Phase D regression — strict allowlist filtering.
  //
  // Live verify on 0.7.1-3d7fb248 surfaced 60+ "unknown Artifact"
  // launchers on a single message because Message.visualizations[]
  // is the legacy catch-all array — it holds hitl_approval / follow_up /
  // sub_agent / tool_call frames mixed with real visualizations. The
  // helper must only emit launchers for entries whose `kind` is a
  // known ArtifactKind (the 6 production kinds, NOT 'unknown').
  it('skips visualization entries with unknown or missing kind (regression: 60-launchers bug)', () => {
    const msg: any = {
      id: 'm1',
      visualizations: [
        { /* no kind */ title: 'orphan', payload: {} },
        { kind: 'hitl_approval', title: 'hitl', payload: {} },
        { kind: 'follow_up', title: 'follow', payload: {} },
        { kind: 'sub_agent', title: 'sub', payload: {} },
        { kind: 'tool_call', title: 'tc', payload: {} },
        { kind: 'chart', title: 'real chart', payload: { kind: 'bar', data: [] } },
      ],
    };
    const out = extractArtifacts(msg);
    expect(out).toHaveLength(1);
    expect(out[0].kind).toBe('chart');
    expect(out[0].title).toBe('real chart');
  });

  it('skips tool_result entries whose _meta.artifactKind is not a known artifact kind', () => {
    const msg: any = {
      id: 'm1',
      toolResults: [
        {
          tool_use_id: 't1',
          _meta: { artifactKind: 'follow_up', artifactTitle: 'bogus' },
        },
        {
          tool_use_id: 't2',
          _meta: {
            artifactKind: 'table',
            artifactTitle: 'real',
            payload: { rows: [], columns: [] },
          },
        },
      ],
    };
    const out = extractArtifacts(msg);
    expect(out).toHaveLength(1);
    expect(out[0].kind).toBe('table');
  });
});

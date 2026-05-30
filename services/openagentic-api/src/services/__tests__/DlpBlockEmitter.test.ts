/**
 * dlp_block NDJSON emitter — UX-facing structured block frame.
 *
 * Today the DLP scanner blocks/redacts content but the user only sees
 * the LLM saying "I was unable to ..." in prose. This emitter takes a
 * DLPScanResult and emits a structured `dlp_block` frame the UI can
 * render as a card with rule name, severity, redaction count, and a
 * "Request exemption" button.
 *
 * No regex tool-name matching, no keyword routing — pure shape mapping.
 */

import { describe, test, expect, vi } from 'vitest';
import { emitDlpBlock, type DlpBlockEmitContext } from '../DlpBlockEmitter.js';
import type { DLPScanResult } from '../DLPScannerService.js';

function makeCtx() {
  const emits: Array<{ event: string; payload: unknown }> = [];
  return {
    emits,
    ctx: {
      emit: (event: string, payload: unknown) => emits.push({ event, payload }),
      logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() },
      sessionId: 's1',
      userId: 'u1',
      messageId: 'm1',
    } as DlpBlockEmitContext,
  };
}

const NOW_FINDING = (over: Partial<any> = {}) => ({
  ruleId: over.ruleId ?? 'DLP-007',
  category: over.category ?? 'pii',
  name: over.name ?? 'Email Address',
  severity: over.severity ?? 'medium',
  match: over.match ?? 'alice@example.com',
  position: over.position ?? 12,
  ...over,
});

describe('emitDlpBlock', () => {
  test('emits no frame when action=allow (no findings)', () => {
    const { ctx, emits } = makeCtx();
    const result: DLPScanResult = {
      findings: [],
      severity: 'low',
      action: 'allow',
      scannedLength: 50,
      scanTimeMs: 1,
    };
    emitDlpBlock(ctx, result, { scanPoint: 'user_input' });
    expect(emits.length).toBe(0);
  });

  test('emits dlp_block frame on action=redact with finding count + masked sample', () => {
    const { ctx, emits } = makeCtx();
    const result: DLPScanResult = {
      findings: [
        NOW_FINDING({ ruleId: 'DLP-007', name: 'Email Address', match: 'alice@example.com' }),
      ],
      severity: 'medium',
      action: 'redact',
      scannedLength: 80,
      scanTimeMs: 2,
    };
    emitDlpBlock(ctx, result, { scanPoint: 'user_input' });
    expect(emits.length).toBe(1);
    const f = emits[0];
    expect(f.event).toBe('dlp_block');
    const p = f.payload as any;
    expect(p.action).toBe('redact');
    expect(p.severity).toBe('medium');
    expect(p.scan_point).toBe('user_input');
    expect(p.finding_count).toBe(1);
    expect(p.rules).toEqual([
      { rule_id: 'DLP-007', name: 'Email Address', category: 'pii', count: 1 },
    ]);
    // The actual matched value MUST NOT appear verbatim — only a masked sample.
    expect(JSON.stringify(p)).not.toContain('alice@example.com');
    expect(p.samples[0]).toMatch(/^a.+m$|^\*+/); // first/last char with stars, or full mask
  });

  test('emits dlp_block frame on action=block with worst-severity', () => {
    const { ctx, emits } = makeCtx();
    const result: DLPScanResult = {
      findings: [
        NOW_FINDING({ ruleId: 'DLP-001', name: 'AWS Access Key', severity: 'critical', match: 'AKIA1234...XYZ' }),
      ],
      severity: 'critical',
      action: 'block',
      scannedLength: 60,
      scanTimeMs: 3,
    };
    emitDlpBlock(ctx, result, { scanPoint: 'tool_input', toolName: 'azure_run_query' });
    expect(emits.length).toBe(1);
    const p = emits[0].payload as any;
    expect(p.action).toBe('block');
    expect(p.severity).toBe('critical');
    expect(p.scan_point).toBe('tool_input');
    expect(p.tool_name).toBe('azure_run_query');
  });

  test('aggregates duplicate ruleId into a single rules entry with count', () => {
    const { ctx, emits } = makeCtx();
    const result: DLPScanResult = {
      findings: [
        NOW_FINDING({ ruleId: 'DLP-007', name: 'Email Address', match: 'a@b.com' }),
        NOW_FINDING({ ruleId: 'DLP-007', name: 'Email Address', match: 'c@d.com' }),
        NOW_FINDING({ ruleId: 'DLP-008', name: 'Phone', match: '555-1234' }),
      ],
      severity: 'medium',
      action: 'redact',
      scannedLength: 100,
      scanTimeMs: 4,
    };
    emitDlpBlock(ctx, result, { scanPoint: 'assistant_output' });
    const p = emits[0].payload as any;
    expect(p.finding_count).toBe(3);
    expect(p.rules.length).toBe(2);
    expect(p.rules.find((r: any) => r.rule_id === 'DLP-007').count).toBe(2);
    expect(p.rules.find((r: any) => r.rule_id === 'DLP-008').count).toBe(1);
  });

  test('payload includes session_id, user_id, message_id for audit correlation', () => {
    const { ctx, emits } = makeCtx();
    const result: DLPScanResult = {
      findings: [NOW_FINDING({})],
      severity: 'medium',
      action: 'redact',
      scannedLength: 30,
      scanTimeMs: 1,
    };
    emitDlpBlock(ctx, result, { scanPoint: 'user_input' });
    const p = emits[0].payload as any;
    expect(p.session_id).toBe('s1');
    expect(p.user_id).toBe('u1');
    expect(p.message_id).toBe('m1');
    expect(typeof p.timestamp).toBe('number');
  });
});

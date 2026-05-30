/**
 * DlpBlockEmitter — translate a DLPScanResult into a structured
 * `dlp_block` NDJSON frame the UI can render as a card.
 *
 * Today the DLP scanner blocks/redacts content but the user only sees
 * a vague "I was unable to ..." in the assistant's prose. This emitter
 * surfaces the policy outcome explicitly: rule name, severity, masked
 * sample, scan point — with a `request_exemption` button on the UI side
 * (frame carries enough context for the request payload).
 *
 * Architecture rules:
 *   - NO regex matching (other than the masking helper, which is per-char).
 *   - NO keyword routing.
 *   - NEVER includes the verbatim matched value in the emitted payload.
 */

import type { DLPScanResult, DLPScanContext } from './DLPScannerService.js';

export type DlpScanPoint =
  | 'user_input'
  | 'tool_input'
  | 'tool_output'
  | 'assistant_output'
  | 'rag_chunk';

export interface DlpBlockEmitContext {
  emit: (frameType: string, payload: unknown) => void;
  logger?: {
    info: (...args: unknown[]) => void;
    warn: (...args: unknown[]) => void;
    error: (...args: unknown[]) => void;
    debug: (...args: unknown[]) => void;
  };
  sessionId?: string;
  userId?: string;
  messageId?: string;
}

export interface DlpBlockEmitOptions {
  scanPoint: DlpScanPoint;
  /** Tool name (when scan_point === 'tool_input' / 'tool_output'). */
  toolName?: string;
}

interface DlpBlockRuleHit {
  rule_id: string;
  name: string;
  category: string;
  count: number;
}

/**
 * Mask a matched value before it leaves the server. Keep first + last
 * char as a hint, blank the middle. Short matches are fully masked.
 */
function maskSample(value: string): string {
  const v = String(value ?? '');
  if (v.length <= 4) return '*'.repeat(v.length);
  return `${v[0]}${'*'.repeat(Math.max(3, v.length - 2))}${v[v.length - 1]}`;
}

/**
 * Emit a `dlp_block` NDJSON frame if the scan blocked or redacted.
 * No-op when action is 'allow'. Aggregates duplicate ruleIds into a
 * single rules entry with a count, masks any matched sample.
 */
export function emitDlpBlock(
  ctx: DlpBlockEmitContext,
  result: DLPScanResult,
  opts: DlpBlockEmitOptions,
): void {
  if (!result || result.action === 'allow' || (result.findings?.length ?? 0) === 0) {
    return;
  }

  const ruleAgg = new Map<string, DlpBlockRuleHit>();
  const samples: string[] = [];
  for (const f of result.findings) {
    const existing = ruleAgg.get(f.ruleId);
    if (existing) {
      existing.count += 1;
    } else {
      ruleAgg.set(f.ruleId, {
        rule_id: f.ruleId,
        name: (f as any).name ?? f.ruleId,
        category: f.category,
        count: 1,
      });
    }
    if (samples.length < 3) {
      const m = (f as any).match;
      if (typeof m === 'string') samples.push(maskSample(m));
    }
  }

  const payload = {
    action: result.action,
    severity: result.severity,
    scan_point: opts.scanPoint,
    tool_name: opts.toolName ?? null,
    finding_count: result.findings.length,
    rules: Array.from(ruleAgg.values()),
    samples,
    session_id: ctx.sessionId ?? null,
    user_id: ctx.userId ?? null,
    message_id: ctx.messageId ?? null,
    timestamp: Date.now(),
  };

  ctx.emit('dlp_block', payload);
  ctx.logger?.warn?.(
    {
      action: payload.action,
      severity: payload.severity,
      scanPoint: payload.scan_point,
      ruleCount: payload.rules.length,
      findingCount: payload.finding_count,
    },
    '[dlp_block] emitted',
  );
}

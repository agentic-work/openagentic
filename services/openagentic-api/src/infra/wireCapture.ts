/**
 * NDJSON wire-capture diagnostic (iteration-1 step-1 of the Q-loop interleave
 * remediation per CLAUDE.md rule 8(a)).
 *
 * When `WIRE_CAPTURE_ENABLED=true`, every frame written through `durableSink`
 * in the chat-stream handler emits one structured log line per frame:
 *
 *     [WIRE-CAPTURE] { tag, turnId, seq, frameType, payload }
 *
 * Operators reconstruct the chronological wire shape per turn from
 * `kubectl logs openagentic-api-... | grep WIRE-CAPTURE` (filter by turnId).
 * The `seq` counter is monotonic per turnId so the relative order of
 * `text_delta` vs `tool_use` content_block_start is unambiguous — that is
 * the exact diagnostic needed for Q7's `TOOL×4 → TOOL×2 → TEXT×7` coalesce.
 *
 * If the wire HAS interleaved text_delta between tool_use blocks → the
 * coalesce is in the UI grouper (AAS `tool_group` while-loop). If the wire
 * has ALL `tool_use` then ALL `text_delta` → the issue is upstream (model
 * system prompt regression or provider/SDK normalizer batching).
 */

interface WireCaptureLogger {
  info(obj: Record<string, unknown>, msg?: string): void;
}

const seqByTurn = new Map<string, number>();

function isEnabled(): boolean {
  return process.env.WIRE_CAPTURE_ENABLED === 'true';
}

function nextSeq(turnId: string): number {
  const cur = seqByTurn.get(turnId) ?? 0;
  const next = cur + 1;
  seqByTurn.set(turnId, next);
  return next;
}

export function maybeEmitWireCapture(
  logger: WireCaptureLogger,
  turnId: string,
  frameType: string,
  payload: Record<string, unknown> | undefined,
): void {
  if (!isEnabled()) return;
  const seq = nextSeq(turnId);
  logger.info(
    {
      tag: 'WIRE-CAPTURE',
      turnId,
      seq,
      frameType,
      payload: payload ?? {},
    },
    '[WIRE-CAPTURE]',
  );
}

// Test-only — drop seq counter for a turn. Production has no use for this
// (each turn has a fresh UUID so the map grows monotonically but each key
// is touched a bounded number of times).
export function __resetWireCaptureSeq(turnId?: string): void {
  if (turnId) seqByTurn.delete(turnId);
  else seqByTurn.clear();
}

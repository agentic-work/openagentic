/**
 * stream-tail.registry — in-memory bridge between live chat turns and
 * durable-tail listeners (task #154).
 *
 * The stream handler registers a `(sessionId, turnId)` pair when it
 * starts streaming and unregisters when the turn finalizes. While the
 * turn is active, every frame written to the wire is ALSO published to
 * any `/tail` listeners subscribed to that turn so reconnected clients
 * see live frames in real time instead of polling the ring buffer.
 *
 * The ring buffer (`StreamRingBuffer`) handles missed-frame replay
 * from before the reconnect. This registry handles the *ongoing* fan-
 * out after a tail subscriber has caught up.
 *
 * Memory semantics:
 *   - Per pod (local Map). On a multi-pod deploy a tail request MUST
 *     land on the same pod that's serving the live turn to get the
 *     "still live" path. If it doesn't, it falls back to ring-buffer
 *     replay and a `{type:'resume_exhausted'}` frame — correct, just
 *     not ideal. Pub/sub across pods is a v0.8 follow-up.
 *   - Entries are keyed by `(sessionId, turnId)`. One active turn per
 *     session is the common case, but the Map allows N if the user
 *     somehow starts a new turn on one tab before the old turn closed.
 *   - Each entry holds a `Set<Listener>` of callbacks. `publishFrame`
 *     walks the set and invokes each; listeners that throw are
 *     silently dropped so a broken listener can't stall the hot path.
 */

export type TailListener = (line: string) => void;

interface TurnEntry {
  listeners: Set<TailListener>;
  /** Populated on `finalizeActiveTurn` so late subscribers can fall through. */
  finalized: boolean;
}

const activeTurns = new Map<string, TurnEntry>();

function keyOf(sessionId: string, turnId: string): string {
  return `${sessionId}::${turnId}`;
}

// ---------------------------------------------------------------------------
// Live-turn lifecycle (called from stream.handler.ts)
// ---------------------------------------------------------------------------

/** Mark `(sessionId, turnId)` as an actively-writing turn. */
export function registerActiveTurn(sessionId: string, turnId: string): void {
  const k = keyOf(sessionId, turnId);
  if (!activeTurns.has(k)) {
    activeTurns.set(k, { listeners: new Set(), finalized: false });
  }
}

/** Fan a just-written NDJSON line out to every attached tail listener. */
export function publishFrame(sessionId: string, turnId: string, line: string): void {
  const entry = activeTurns.get(keyOf(sessionId, turnId));
  if (!entry || entry.listeners.size === 0) return;
  for (const listener of entry.listeners) {
    try {
      listener(line);
    } catch {
      // Broken listener — drop it so the hot path isn't blocked.
      entry.listeners.delete(listener);
    }
  }
}

/**
 * Mark a turn finalized and drop the entry. Any still-attached listeners
 * receive one last signal via the sentinel line so they can close their
 * NDJSON responses cleanly.
 */
export function unregisterActiveTurn(sessionId: string, turnId: string): void {
  const k = keyOf(sessionId, turnId);
  const entry = activeTurns.get(k);
  if (!entry) return;
  entry.finalized = true;
  // Publish a synthetic end-of-turn line so any subscribed listeners
  // wake up and close.
  const sentinel = JSON.stringify({ type: '__turn_finalized', sessionId, turnId });
  for (const listener of entry.listeners) {
    try {
      listener(sentinel);
    } catch {
      /* ignored */
    }
  }
  activeTurns.delete(k);
}

// ---------------------------------------------------------------------------
// Tail-subscriber lifecycle (called from stream-tail.route.ts)
// ---------------------------------------------------------------------------

/** True iff a turn is currently registered + not finalized. */
export function isTurnActive(sessionId: string, turnId: string): boolean {
  const entry = activeTurns.get(keyOf(sessionId, turnId));
  return Boolean(entry && !entry.finalized);
}

/**
 * Attach a listener; returns an `unsubscribe` function. No-op if the
 * turn isn't active (caller should check `isTurnActive` first and fall
 * back to ring-buffer-only replay).
 */
export function subscribeToTurn(
  sessionId: string,
  turnId: string,
  listener: TailListener,
): () => void {
  const k = keyOf(sessionId, turnId);
  const entry = activeTurns.get(k);
  if (!entry || entry.finalized) {
    return () => { /* nothing to unsubscribe */ };
  }
  entry.listeners.add(listener);
  return () => {
    const cur = activeTurns.get(k);
    cur?.listeners.delete(listener);
  };
}

// ---------------------------------------------------------------------------
// Test seams
// ---------------------------------------------------------------------------

/** Reset state between tests. */
export function resetTailRegistryForTests(): void {
  activeTurns.clear();
}

/** Introspection for tests / admin debug. */
export function activeTurnCount(): number {
  return activeTurns.size;
}

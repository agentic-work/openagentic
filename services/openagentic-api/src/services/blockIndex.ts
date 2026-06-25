/**
 * blockIndex — per-turn content-block indexer.
 *
 * Stamps a 0-based monotonic `index` onto every content-producing NDJSON
 * frame so the UI can reassemble interleaved deltas by slot. Matches
 * Claude's content_block_start/delta/stop `index` contract.
 *
 * Usage:
 *   const idx = new BlockIndexer();
 *   emit('stream',          { ..., index: idx.indexFor({ blockKind: 'text', blockId: 't1' }) });
 *   emit('tool_executing',  { ..., index: idx.indexFor({ blockKind: 'tool_use', blockId: toolCallId }) });
 *   emit('thinking_event',  { ..., index: idx.indexFor({ blockKind: 'thinking', blockId: turnId }) });
 *   idx.closeBlock('t1'); // optional — forces next 't1' to a new index
 */

export type BlockKind =
  | 'text'
  | 'tool_use'
  | 'tool_result'
  | 'thinking'
  | 'image'
  | 'browser_exec';

export interface BlockHandle {
  blockKind: BlockKind;
  blockId: string;
}

export class BlockIndexer {
  private nextIndex = 0;
  /** Active blockId → its assigned index. */
  private active = new Map<string, number>();

  indexFor(h: BlockHandle): number {
    const existing = this.active.get(h.blockId);
    if (existing !== undefined) return existing;
    const assigned = this.nextIndex++;
    this.active.set(h.blockId, assigned);
    return assigned;
  }

  /**
   * Mark a block closed so future indexFor() calls with the same blockId
   * start a fresh slot. Useful when a tool_use block's lifetime ends and
   * later a follow-up tool call reuses the same id (shouldn't happen in
   * practice but keeps the contract strict).
   */
  closeBlock(blockId: string): void {
    this.active.delete(blockId);
  }

  /** Total distinct blocks issued so far. */
  size(): number {
    return this.nextIndex;
  }

  /** Reset all state — use at turn start if reusing an instance. */
  reset(): void {
    this.nextIndex = 0;
    this.active.clear();
  }
}

/**
 * Copyright 2026 Gnomus.ai
 *
 * Licensed under the Apache License, Version 2.0 (the "License");
 * you may not use this file except in compliance with the License.
 * You may obtain a copy of the License at
 *
 *     http://www.apache.org/licenses/LICENSE-2.0
 *
 * Unless required by applicable law or agreed to in writing, software
 * distributed under the License is distributed on an "AS IS" BASIS,
 * WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
 * See the License for the specific language governing permissions and
 * limitations under the License.
 */


export interface ApprovalResult {
  approved: boolean;
  timedOut: boolean;
  waitMs: number;
}

export class PendingApprovalStore {
  private pending = new Map<string, { resolve: (result: ApprovalResult) => void; timer: ReturnType<typeof setTimeout>; createdAt: number }>();

  /**
   * Create a new pending approval. Returns a promise that resolves when
   * approve/deny is called, or rejects after timeout.
   */
  create(toolCallId: string, timeoutMs: number = 300000): { promise: Promise<ApprovalResult>; id: string } {
    const id = `hitl-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
    const createdAt = Date.now();

    const promise = new Promise<ApprovalResult>((resolve) => {
      const timer = setTimeout(() => {
        this.pending.delete(id);
        resolve({ approved: false, timedOut: true, waitMs: timeoutMs });
      }, timeoutMs);
      this.pending.set(id, { resolve, timer, createdAt });
    });

    return { promise, id };
  }

  /**
   * Resolve a pending approval. Returns false if the ID doesn't exist (already resolved or timed out).
   */
  resolve(id: string, approved: boolean): boolean {
    const entry = this.pending.get(id);
    if (!entry) return false;
    clearTimeout(entry.timer);
    const waitMs = Date.now() - entry.createdAt;
    this.pending.delete(id);
    entry.resolve({ approved, timedOut: false, waitMs });
    return true;
  }

  /**
   * Check if an approval is pending.
   */
  has(id: string): boolean {
    return this.pending.has(id);
  }

  /**
   * Get count of pending approvals.
   */
  get size(): number {
    return this.pending.size;
  }

  /**
   * Clean up all pending approvals (e.g., on shutdown).
   */
  clear(): void {
    for (const [id, entry] of this.pending) {
      clearTimeout(entry.timer);
      entry.resolve({ approved: false, timedOut: false, waitMs: Date.now() - entry.createdAt });
    }
    this.pending.clear();
  }
}

// Singleton instance
let _instance: PendingApprovalStore | null = null;
export function getPendingApprovalStore(): PendingApprovalStore {
  if (!_instance) _instance = new PendingApprovalStore();
  return _instance;
}

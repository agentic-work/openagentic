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

/**
 * Pipeline Hook System
 *
 * 16 hook points where modifying, void, or sync hooks can be registered.
 * Hooks run in priority order. Modifying hooks transform data through
 * the chain; void hooks observe without modifying.
 *
 * This is the integration point where security (DLP, HITL) meets
 * architecture (cost tracking, audit, sequencing).
 */

import type { Logger } from 'pino';
import { type HookMergeStrategy, MERGE_STRATEGIES } from './hook-merge-strategies.js';

// ---------------------------------------------------------------------------
// Hook point names
// ---------------------------------------------------------------------------

export type HookPoint =
  // Modifying hooks (transform input → output)
  | 'before_model_resolve'    // Agent picks model before SmartRouter
  | 'before_prompt_build'     // Inject persona / system prompt fragment
  | 'before_tool_call'        // Gate or modify tool call (HITL lives here)
  | 'before_mcp_request'      // Modify MCP request payload
  | 'before_streaming'        // Modify response before streaming to client
  | 'before_message_save'     // Modify message before DB persist
  // Void hooks (observe only)
  | 'after_tool_call'         // DLP scan, audit, telemetry
  | 'after_completion'        // Cost tracking, metrics
  | 'after_message_save'      // Post-persist notifications
  | 'after_error'             // Error telemetry
  | 'on_stream_chunk'         // Per-chunk observer (DLP inline scan)
  | 'on_pipeline_start'       // Pipeline lifecycle
  | 'on_pipeline_end'         // Pipeline lifecycle
  // Sync hooks (must be synchronous — called in hot paths)
  | 'validate_input'          // Pre-pipeline input validation
  | 'enrich_sse_event'        // Add metadata to SSE events (sequencer)
  | 'on_abort';               // Cleanup on abort

export type HookKind = 'modifying' | 'void' | 'sync';

/** Map each hook point to its kind */
export const HOOK_KINDS: Record<HookPoint, HookKind> = {
  before_model_resolve: 'modifying',
  before_prompt_build: 'modifying',
  before_tool_call: 'modifying',
  before_mcp_request: 'modifying',
  before_streaming: 'modifying',
  before_message_save: 'modifying',
  after_tool_call: 'void',
  after_completion: 'void',
  after_message_save: 'void',
  after_error: 'void',
  on_stream_chunk: 'void',
  on_pipeline_start: 'void',
  on_pipeline_end: 'void',
  validate_input: 'sync',
  enrich_sse_event: 'sync',
  on_abort: 'sync',
};

// ---------------------------------------------------------------------------
// Hook function types
// ---------------------------------------------------------------------------

export type ModifyingHookFn<T = unknown> = (data: T, context: HookContext) => Promise<T>;
export type VoidHookFn<T = unknown> = (data: T, context: HookContext) => Promise<void>;
export type SyncHookFn<T = unknown> = (data: T, context: HookContext) => T;

export type AnyHookFn = ModifyingHookFn | VoidHookFn | SyncHookFn;

export interface HookContext {
  userId: string;
  sessionId?: string;
  messageId?: string;
  logger: Logger;
  /** Metadata bag for hooks to communicate with each other */
  meta: Record<string, unknown>;
}

// ---------------------------------------------------------------------------
// Hook registration
// ---------------------------------------------------------------------------

export interface HookRegistration {
  /** Unique ID for this hook (for removal) */
  id: string;
  /** Hook point to attach to */
  point: HookPoint;
  /** The hook function */
  fn: AnyHookFn;
  /** Lower priority runs first. Default 100. */
  priority: number;
  /** Optional: only runs for specific agent IDs */
  agentFilter?: string[];
  /** Optional: description for admin UI */
  description?: string;
}

// ---------------------------------------------------------------------------
// HookRunner
// ---------------------------------------------------------------------------

export class HookRunner {
  private hooks = new Map<HookPoint, HookRegistration[]>();
  private logger: Logger;

  constructor(logger: Logger) {
    this.logger = logger.child({ component: 'HookRunner' });
  }

  /**
   * Register a hook.
   */
  register(reg: HookRegistration): void {
    const existing = this.hooks.get(reg.point) ?? [];
    // Replace if same ID exists
    const filtered = existing.filter(h => h.id !== reg.id);
    filtered.push(reg);
    // Sort by priority (lower first)
    filtered.sort((a, b) => a.priority - b.priority);
    this.hooks.set(reg.point, filtered);

    this.logger.debug({ hookId: reg.id, point: reg.point, priority: reg.priority }, 'Hook registered');
  }

  /**
   * Unregister a hook by ID.
   */
  unregister(hookId: string): boolean {
    for (const [point, hooks] of this.hooks) {
      const idx = hooks.findIndex(h => h.id === hookId);
      if (idx !== -1) {
        hooks.splice(idx, 1);
        this.logger.debug({ hookId, point }, 'Hook unregistered');
        return true;
      }
    }
    return false;
  }

  /**
   * Run modifying hooks — data flows through each hook in order.
   * The merge strategy determines how multiple hook results combine.
   */
  async runModifying<T>(
    point: HookPoint,
    data: T,
    context: HookContext,
    mergeStrategy?: HookMergeStrategy<T>,
  ): Promise<T> {
    const hooks = this.getHooks(point);
    if (hooks.length === 0) return data;

    const strategy = mergeStrategy ?? (MERGE_STRATEGIES.passthrough as unknown as HookMergeStrategy<T>);
    let current = data;

    for (const hook of hooks) {
      try {
        const fn = hook.fn as ModifyingHookFn<T>;
        const result = await fn(current, context);
        current = strategy(current, result, hook.id);
      } catch (error) {
        this.logger.error({
          hookId: hook.id,
          point,
          error: (error as Error).message,
        }, 'Modifying hook threw — skipping');
        // Continue with unmodified data
      }
    }

    return current;
  }

  /**
   * Run void hooks — all run in parallel, errors are logged.
   */
  async runVoid<T>(point: HookPoint, data: T, context: HookContext): Promise<void> {
    const hooks = this.getHooks(point);
    if (hooks.length === 0) return;

    await Promise.allSettled(
      hooks.map(async (hook) => {
        try {
          const fn = hook.fn as VoidHookFn<T>;
          await fn(data, context);
        } catch (error) {
          this.logger.error({
            hookId: hook.id,
            point,
            error: (error as Error).message,
          }, 'Void hook threw');
        }
      }),
    );
  }

  /**
   * Run sync hooks — runs synchronously in order.
   * For hot paths where async overhead is unacceptable.
   */
  runSync<T>(point: HookPoint, data: T, context: HookContext): T {
    const hooks = this.getHooks(point);
    let current = data;

    for (const hook of hooks) {
      try {
        const fn = hook.fn as SyncHookFn<T>;
        current = fn(current, context);
      } catch (error) {
        this.logger.error({
          hookId: hook.id,
          point,
          error: (error as Error).message,
        }, 'Sync hook threw — skipping');
      }
    }

    return current;
  }

  /**
   * List all registered hooks (for admin UI).
   */
  listHooks(): Array<{ id: string; point: HookPoint; priority: number; description?: string }> {
    const result: Array<{ id: string; point: HookPoint; priority: number; description?: string }> = [];
    for (const [point, hooks] of this.hooks) {
      for (const hook of hooks) {
        result.push({ id: hook.id, point, priority: hook.priority, description: hook.description });
      }
    }
    return result;
  }

  /**
   * Get hook count per point (for diagnostics).
   */
  getHookCounts(): Record<HookPoint, number> {
    const counts = {} as Record<HookPoint, number>;
    for (const point of Object.keys(HOOK_KINDS) as HookPoint[]) {
      counts[point] = (this.hooks.get(point) ?? []).length;
    }
    return counts;
  }

  // -----------------------------------------------------------------------
  // Internal
  // -----------------------------------------------------------------------

  private getHooks(point: HookPoint): HookRegistration[] {
    return this.hooks.get(point) ?? [];
  }
}

// ---------------------------------------------------------------------------
// Singleton
// ---------------------------------------------------------------------------

let _runner: HookRunner | null = null;

export function getHookRunner(logger?: Logger): HookRunner {
  if (!_runner) {
    if (!logger) throw new Error('HookRunner not initialized — call initializeHookRunner first');
    _runner = new HookRunner(logger);
  }
  return _runner;
}

export function initializeHookRunner(logger: Logger): HookRunner {
  _runner = new HookRunner(logger);
  return _runner;
}

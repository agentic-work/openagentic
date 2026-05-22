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

/**
 * Per-hook failure handling.
 *
 * - `fail_closed` (default): a thrown error from this hook propagates out of
 *   HookRunner.run* and aborts the surrounding pipeline. Use for security
 *   gates (DLP, HITL) where silently swallowing the error would let unsafe
 *   data through.
 * - `fail_open`: errors thrown by this hook are caught and logged; the
 *   pipeline continues with un-modified data. Use for observers (audit,
 *   metrics, telemetry) where a downstream sink failure shouldn't block
 *   the user's request.
 */
export type HookFailureMode = 'fail_closed' | 'fail_open';

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
  /**
   * Optional: how this hook handles thrown errors. Defaults to `fail_closed`
   * (Phase 3): errors propagate. Hooks that want the legacy "log and
   * continue" behaviour must opt in via `failureMode: 'fail_open'`.
   */
  failureMode?: HookFailureMode;
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
        // Phase 3: fail_closed by default. fail_open hooks are caught
        // and logged so the pipeline continues with unmodified data.
        if (hook.failureMode === 'fail_open') {
          this.logger.error({
            hookId: hook.id,
            point,
            error: (error as Error).message,
          }, 'Modifying hook threw (fail_open) — skipping');
          continue;
        }
        this.logger.error({
          hookId: hook.id,
          point,
          error: (error as Error).message,
        }, 'Modifying hook threw (fail_closed) — propagating');
        throw error;
      }
    }

    return current;
  }

  /**
   * Run void hooks — fail-closed by default (errors propagate). Per-hook
   * `failureMode: 'fail_open'` retains the legacy "log and continue"
   * behaviour for observer-style hooks (audit, metrics, telemetry).
   *
   * Phase 3: changed from previous parallel-allSettled-with-swallow to
   * sequential fail-closed by default. Sequential ordering matches the
   * priority contract (hooks run in priority order); parallel made
   * priority meaningless.
   */
  async runVoid<T>(point: HookPoint, data: T, context: HookContext): Promise<void> {
    const hooks = this.getHooks(point);
    if (hooks.length === 0) return;

    for (const hook of hooks) {
      try {
        const fn = hook.fn as VoidHookFn<T>;
        await fn(data, context);
      } catch (error) {
        if (hook.failureMode === 'fail_open') {
          this.logger.error({
            hookId: hook.id,
            point,
            error: (error as Error).message,
          }, 'Void hook threw (fail_open) — continuing');
          continue;
        }
        this.logger.error({
          hookId: hook.id,
          point,
          error: (error as Error).message,
        }, 'Void hook threw (fail_closed) — propagating');
        throw error;
      }
    }
  }

  /**
   * Convenience entry: dispatch to runVoid / runModifying / runSync based on
   * the hook point's declared kind. The Phase 3 chatLoop wires hook calls as
   * `await hooks.run(point, data, ctx)` and lets HookRunner pick the kind.
   *
   * Modifying hooks: prefer calling `runModifying(point, data, ctx)` directly
   * so the (possibly transformed) result is captured. `run()` discards the
   * return value — fine for observer points (`on_turn_start`,
   * `before_streaming`, `after_tool_call`, `on_turn_end`, `on_pipeline_end`)
   * but loses the transform when used for `before_tool_call` etc.
   */
  async run<T>(point: HookPoint, data: T, context: HookContext): Promise<void> {
    const kind = HOOK_KINDS[point];
    if (kind === 'void') {
      await this.runVoid(point, data, context);
      return;
    }
    if (kind === 'modifying') {
      await this.runModifying(point, data, context);
      return;
    }
    // sync — call synchronously, ignore returned value
    this.runSync(point, data, context);
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
        if (hook.failureMode === 'fail_open') {
          this.logger.error({
            hookId: hook.id,
            point,
            error: (error as Error).message,
          }, 'Sync hook threw (fail_open) — skipping');
          continue;
        }
        this.logger.error({
          hookId: hook.id,
          point,
          error: (error as Error).message,
        }, 'Sync hook threw (fail_closed) — propagating');
        throw error;
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

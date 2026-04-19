/**
 * Background Job State Machine — 0.6.6 P8 (task #113)
 *
 * Pure state-transition logic for long-running background jobs. Lives
 * in its own file so it's unit-testable in isolation, without pulling
 * Prisma / Redis / agent-runtime dependencies in.
 *
 * Lifecycle:
 *
 *   queued ─► running ─► completed (terminal)
 *                │
 *                └─► failed (terminal)
 *                │
 *                └─► parked ─► resumable ─► running ─► …
 *
 * `parked` is the new state that 0.6.5 didn't have — it represents a
 * job waiting on an external side effect (AKS provision, RDS snapshot,
 * human approval for a subsequent step). Jobs set `resume_at` when
 * they park. The BackgroundJobPoller walks the queue on an interval,
 * and any parked job whose resume_at has passed transitions to
 * `resumable` where a worker picks it up.
 *
 * The `state_transitions` JSON column is an append-only audit trail
 * of every transition. Each entry:
 *   { from: string, to: string, ts: ISO string, reason?: string }
 */

export type JobState =
  | 'queued'
  | 'running'
  | 'parked'
  | 'resumable'
  | 'completed'
  | 'failed';

export interface StateTransition {
  from: JobState;
  to: JobState;
  ts: string;     // ISO-8601
  reason?: string;
}

/** Build the full set of legal transitions. */
const LEGAL_TRANSITIONS: ReadonlyMap<JobState, ReadonlySet<JobState>> = new Map([
  ['queued',    new Set<JobState>(['running', 'failed'])],
  ['running',   new Set<JobState>(['parked', 'completed', 'failed'])],
  ['parked',    new Set<JobState>(['resumable', 'failed'])], // poller → resumable, admin kill → failed
  ['resumable', new Set<JobState>(['running', 'failed'])],
  ['completed', new Set<JobState>()],                         // terminal
  ['failed',    new Set<JobState>()],                         // terminal
]);

/** Terminal states cannot transition further. */
export const TERMINAL_STATES: ReadonlySet<JobState> = new Set<JobState>(['completed', 'failed']);

export class IllegalStateTransitionError extends Error {
  readonly from: JobState;
  readonly to: JobState;
  constructor(from: JobState, to: JobState) {
    super(
      `Illegal background-job state transition: ${from} → ${to}. ` +
      `Legal successors of ${from}: [${Array.from(LEGAL_TRANSITIONS.get(from) ?? []).join(', ')}].`,
    );
    this.name = 'IllegalStateTransitionError';
    this.from = from;
    this.to = to;
  }
}

/**
 * Validate a requested transition without mutating anything.
 * Returns true if legal, false if illegal.
 */
export function isLegalTransition(from: JobState, to: JobState): boolean {
  if (from === to) return false;              // no-op "transitions" are not transitions
  const next = LEGAL_TRANSITIONS.get(from);
  return !!next && next.has(to);
}

/**
 * Compute the next state_transitions value given the current
 * transitions list and a new from→to move. Throws if illegal.
 *
 * Returns the NEW list (pure, does not mutate the input).
 */
export function appendTransition(
  transitions: StateTransition[],
  from: JobState,
  to: JobState,
  reason?: string,
  now: Date = new Date(),
): StateTransition[] {
  if (!isLegalTransition(from, to)) {
    throw new IllegalStateTransitionError(from, to);
  }
  const entry: StateTransition = { from, to, ts: now.toISOString() };
  if (reason) entry.reason = reason;
  return [...transitions, entry];
}

/**
 * Decide whether a parked job is due for resumption: status must be
 * 'parked' AND resume_at must be set AND already passed.
 */
export function isDueForResumption(job: {
  status: JobState;
  resume_at?: Date | string | null;
}, now: Date = new Date()): boolean {
  if (job.status !== 'parked') return false;
  if (!job.resume_at) return false;
  const due = typeof job.resume_at === 'string' ? new Date(job.resume_at) : job.resume_at;
  return due.getTime() <= now.getTime();
}

/**
 * Type-guard — useful for validating runtime strings from the DB.
 */
export function isJobState(value: unknown): value is JobState {
  return (
    value === 'queued' ||
    value === 'running' ||
    value === 'parked' ||
    value === 'resumable' ||
    value === 'completed' ||
    value === 'failed'
  );
}

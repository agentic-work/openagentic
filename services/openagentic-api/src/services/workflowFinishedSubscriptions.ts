/**
 * workflow_finished trigger discovery + fire helper (P1.19).
 *
 * After any workflow execution terminates, this helper scans for OTHER
 * workflows whose entry-point trigger node is configured with
 * `triggerType: 'workflow_finished'` AND whose `triggerConfig.sourceWorkflowId`
 * (or `sourceWorkflowSlug`) matches the source execution. Each match is
 * fired via the existing execute path with the source execution surface
 * injected as the trigger input.
 *
 * Design rules:
 *   - Subscription is OPT-IN per target flow (in its trigger node config).
 *     No central subscriptions table; nothing to keep in sync.
 *   - Matching is by ID or slug; both formats accepted in triggerConfig.
 *   - `matchStatus` filter: 'completed' (default) | 'failed' | 'any'.
 *   - Fire path: same as a manual execute via the api so internal-auth,
 *     tenant scoping, and audit trails apply uniformly.
 *   - Fan-out is fire-and-forget — one failing subscriber must NEVER block
 *     other subscribers OR the source execution's own completion path.
 *   - Cycle prevention: subscribers never fire targets whose own execution
 *     is the source (no self-loops). The api could grow a depth limit
 *     here later; for now a one-hop guard catches the obvious case.
 *
 * Pinned by `__tests__/workflowFinishedSubscriptions.test.ts` —
 * discovery is pure (DB-mockable) and exercised independently from the
 * fire path so the routing logic stays testable without a live engine.
 */

import type { PrismaClient } from '@prisma/client';
import { executeViaWorkflowsService } from './executeViaWorkflowsService.js';

export type WorkflowFinishedStatus = 'completed' | 'failed';

export interface WorkflowFinishedSourceFact {
  /** Source workflow's `id` (uuid) — required. */
  sourceWorkflowId: string;
  /** Source workflow's slug (from settings.meta.slug). Optional. */
  sourceWorkflowSlug?: string;
  /** Source execution id. */
  sourceExecutionId: string;
  /** Final source-execution status. */
  sourceStatus: WorkflowFinishedStatus;
  /** Tenant the source ran under — subscribers MUST be in the same tenant. */
  tenantId: string;
}

export interface SubscriberWorkflowMatch {
  workflowId: string;
  workflowName: string;
  workflowSlug: string | null;
  matchKind: 'id' | 'slug';
  matchStatus: 'completed' | 'failed' | 'any';
}

interface WorkflowRow {
  id: string;
  name: string;
  tenant_id: string | null;
  is_active: boolean;
  definition: unknown;
  settings: unknown;
}

/**
 * Discover workflows that subscribe to the given source. Pure DB query +
 * shape-check; no execution side effects. Caller decides whether to fire.
 *
 * Scope is intentionally restricted to:
 *   - tenant-matched workflows (cross-tenant fan-out is a leak)
 *   - is_active=true
 *   - exactly one trigger node with triggerType:'workflow_finished'
 *   - sourceWorkflowId OR sourceWorkflowSlug match
 *   - matchStatus = 'any' | sourceStatus | undefined (defaults to 'completed')
 */
export async function findWorkflowFinishedSubscribers(
  prisma: PrismaClient,
  source: WorkflowFinishedSourceFact,
): Promise<SubscriberWorkflowMatch[]> {
  // Pull every active workflow in the same tenant. Filtering on JSON
  // path equality is supported in Postgres but cross-engine portability
  // + the small candidate set make an in-memory filter the right call
  // for now — when the candidate set grows past ~1k we move this to a
  // Prisma raw query with a GIN index on definition.nodes.data.triggerType.
  const candidates = (await prisma.workflow.findMany({
    where: {
      tenant_id: source.tenantId,
      is_active: true,
    },
    select: {
      id: true,
      name: true,
      tenant_id: true,
      is_active: true,
      definition: true,
      settings: true,
    },
  })) as unknown as WorkflowRow[];

  const matches: SubscriberWorkflowMatch[] = [];

  for (const row of candidates) {
    if (row.id === source.sourceWorkflowId) continue; // skip self-loop

    // Defense-in-depth: re-check tenant + active flags even though the
    // DB query restricts the candidate set. Caller-side stub / mock
    // might return rows the prisma filter would have dropped.
    if (row.tenant_id !== source.tenantId) continue;
    if (row.is_active !== true) continue;

    const def = row.definition as { nodes?: Array<{ type?: string; data?: Record<string, unknown> }> } | null;
    const triggerNode = (def?.nodes ?? []).find((n) => n?.type === 'trigger');
    if (!triggerNode) continue;

    const data = (triggerNode.data ?? {}) as Record<string, unknown>;
    const triggerType = String(data.triggerType ?? '');
    if (triggerType !== 'workflow_finished') continue;

    const triggerConfig = (data.triggerConfig ?? {}) as Record<string, unknown>;
    const cfgId = triggerConfig.sourceWorkflowId
      ? String(triggerConfig.sourceWorkflowId)
      : undefined;
    const cfgSlug = triggerConfig.sourceWorkflowSlug
      ? String(triggerConfig.sourceWorkflowSlug)
      : undefined;
    const cfgMatchStatus = String(triggerConfig.matchStatus ?? 'completed') as
      | 'completed'
      | 'failed'
      | 'any';

    let matchKind: 'id' | 'slug' | undefined;
    if (cfgId && cfgId === source.sourceWorkflowId) {
      matchKind = 'id';
    } else if (cfgSlug && source.sourceWorkflowSlug && cfgSlug === source.sourceWorkflowSlug) {
      matchKind = 'slug';
    }
    if (!matchKind) continue;

    if (cfgMatchStatus !== 'any' && cfgMatchStatus !== source.sourceStatus) continue;

    const settings = (row.settings ?? {}) as Record<string, unknown>;
    const meta = (settings.meta ?? {}) as Record<string, unknown>;
    matches.push({
      workflowId: row.id,
      workflowName: row.name,
      workflowSlug: typeof meta.slug === 'string' ? (meta.slug as string) : null,
      matchKind,
      matchStatus: cfgMatchStatus,
    });
  }

  return matches;
}

export interface FireSubscribersOpts {
  prisma: PrismaClient;
  logger: {
    info: (...args: unknown[]) => void;
    warn: (...args: unknown[]) => void;
    error: (...args: unknown[]) => void;
    debug?: (...args: unknown[]) => void;
  };
  sourceWorkflowId: string;
  sourceWorkflowSlug?: string;
  sourceExecutionId: string;
  sourceStatus: WorkflowFinishedStatus;
  sourceOutput?: unknown;
  tenantId: string;
  /** User to run the subscribers AS. Inherits the source executor's user. */
  userId: string;
}

/**
 * Discover-and-fire entry point. Fire-and-forget per the route hook —
 * subscriber failure must never block the source execution's completion
 * path. Each subscriber is executed via the SAME `executeViaWorkflowsService`
 * the regular execute route uses, so tenant scoping + internal auth flow
 * the same way.
 */
export async function fireWorkflowFinishedSubscribers(
  opts: FireSubscribersOpts,
): Promise<void> {
  const {
    prisma,
    logger,
    sourceWorkflowId,
    sourceWorkflowSlug,
    sourceExecutionId,
    sourceStatus,
    sourceOutput,
    tenantId,
    userId,
  } = opts;

  let subscribers;
  try {
    subscribers = await findWorkflowFinishedSubscribers(prisma, {
      sourceWorkflowId,
      sourceWorkflowSlug,
      sourceExecutionId,
      sourceStatus,
      tenantId,
    });
  } catch (err) {
    logger.warn(
      { err: err instanceof Error ? err.message : String(err), sourceWorkflowId },
      '[workflow_finished] subscriber discovery failed',
    );
    return;
  }

  if (subscribers.length === 0) return;

  logger.info(
    {
      sourceWorkflowId,
      sourceWorkflowSlug,
      sourceExecutionId,
      sourceStatus,
      subscribers: subscribers.length,
    },
    '[workflow_finished] firing subscribers',
  );

  const triggerInput = {
    sourceExecutionId,
    sourceWorkflowId,
    sourceWorkflowSlug,
    sourceStatus,
    sourceOutput,
  };

  // Look up each subscriber's definition + version once, then call
  // executeViaWorkflowsService directly (matches the route's
  // workflows-svc-only execute path post-Phase-B).
  for (const sub of subscribers) {
    try {
      const target = await prisma.workflow.findUnique({
        where: { id: sub.workflowId },
        include: { versions: { where: { is_active: true }, take: 1 } },
      });
      if (!target) {
        logger.warn(
          { subscriber: sub.workflowId },
          '[workflow_finished] subscriber not found at fire time (race?)',
        );
        continue;
      }
      const versionDef = (target.versions[0]?.definition as any) ?? null;
      const definition =
        versionDef && Array.isArray(versionDef.nodes)
          ? versionDef
          : ((target as any).definition as { nodes?: unknown[]; edges?: unknown[] });
      if (!definition?.nodes) {
        logger.warn(
          { subscriber: sub.workflowId },
          '[workflow_finished] subscriber has no definition — skipped',
        );
        continue;
      }
      // Generate a new execution id; persist as a pending row first so
      // the subscriber's `status: 'failed'` updates have somewhere to land.
      const execRow = await prisma.workflowExecution.create({
        data: {
          workflow_id: sub.workflowId,
          trigger_type: 'workflow_finished',
          trigger_data: { source: 'workflow_finished', sourceExecutionId, sourceWorkflowId },
          status: 'pending',
          input: triggerInput as any,
          total_nodes: (definition.nodes as unknown[]).length ?? 0,
          started_by: userId,
          started_at: new Date(),
        },
      });
      executeViaWorkflowsService(
        sub.workflowId,
        execRow.id,
        definition as any,
        triggerInput as any,
        userId,
        undefined, // authToken — subscriber runs in the source user's tenant
        () => { /* fire-and-forget */ },
        { tenantId },
      )
        .then(async () => {
          await prisma.workflowExecution
            .update({
              where: { id: execRow.id },
              data: { status: 'completed', completed_at: new Date() },
            })
            .catch(() => { /* upstream may have already updated */ });
        })
        .catch(async (err: Error) => {
          await prisma.workflowExecution
            .update({
              where: { id: execRow.id },
              data: { status: 'failed', error: err.message, completed_at: new Date() },
            })
            .catch(() => {});
        });
    } catch (err) {
      logger.warn(
        {
          err: err instanceof Error ? err.message : String(err),
          subscriber: sub.workflowId,
        },
        '[workflow_finished] subscriber fire failed (non-fatal)',
      );
    }
  }
}

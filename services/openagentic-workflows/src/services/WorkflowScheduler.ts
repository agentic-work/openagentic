/**
 * WorkflowScheduler
 *
 * Polls for workflows with active cron schedules and triggers their execution
 * when the schedule matches. Uses a simple setInterval-based polling approach.
 *
 * On startup:
 *   1. Loads all active WorkflowSchedule records from the database
 *   2. Every POLL_INTERVAL_MS, checks if any schedule's next_run_at has passed
 *   3. If so, triggers a workflow execution and advances next_run_at
 *
 * Cron parsing is backed by croner, which supports:
 *   - Standard 5-field expressions (minute hour dom month dow)
 *   - Day-of-week names (MON, TUE … SUN, ranges like MON-FRI)
 *   - Macros: @hourly, @daily, @weekly, @monthly, @yearly, @annually
 *   - @reboot: treated as a no-op (never matches at runtime; fires once at boot in the old design)
 *   - IANA timezone handling with proper DST support
 */

import { Cron } from 'croner';
import { prisma } from '../utils/prisma.js';
import { loggers } from '../utils/logger.js';
import { withSystemTenant, withTenant } from '../utils/tenantPrismaExtension.js';
import { executeWorkflow } from './WorkflowExecutionEngine.js';
import { WorkflowCompiler } from './WorkflowCompiler.js';
import { sweepExpiredKeys } from './IdempotencyService.js';

const logger = loggers.services;
const compiler = new WorkflowCompiler();

// How often to poll for due schedules (default: 30 seconds)
const POLL_INTERVAL_MS = Number.parseInt(process.env.WORKFLOW_SCHEDULER_POLL_MS || '30000', 10);

// Maximum schedules to process per poll cycle (prevent thundering herd)
const MAX_PER_CYCLE = Number.parseInt(process.env.WORKFLOW_SCHEDULER_MAX_PER_CYCLE || '10', 10);

// =============================================================================
// Cron Helpers — backed by croner (IANA TZ, day names, macros, DST-safe)
// =============================================================================

/** @reboot sentinel — fires once at scheduler startup; never matches at runtime. */
const REBOOT_MACRO = '@reboot';

/**
 * Build a paused Cron instance for one-shot computation (no callbacks, no timers).
 * Returns null for @reboot (which croner doesn't support — we handle it separately).
 */
function buildCron(expression: string, timezone?: string): Cron | null {
  if (expression.trim().toLowerCase() === REBOOT_MACRO) return null;
  const opts: Record<string, any> = { paused: true };
  if (timezone) opts.timezone = timezone;
  return new Cron(expression, opts);
}

/**
 * Check if a cron expression matches the given date.
 *
 * @param expression  5-field cron or macro (@hourly, @daily, @weekly, @monthly, @yearly, @annually, @reboot)
 * @param date        The date to test
 * @param timezone    IANA timezone (e.g. "America/Los_Angeles"). Defaults to UTC.
 */
function cronMatches(expression: string, date: Date, timezone?: string): boolean {
  const cron = buildCron(expression, timezone ?? 'UTC');
  if (!cron) return false; // @reboot never matches at runtime
  try {
    const matched = cron.match(date);
    cron.stop();
    return matched;
  } catch {
    cron.stop();
    return false;
  }
}

/**
 * Calculate the next matching time for a cron expression, starting from `after`.
 *
 * @param expression  5-field cron or macro
 * @param after       Lower-bound date (exclusive — next run is strictly after this)
 * @param timezone    IANA timezone. Defaults to UTC.
 */
function getNextCronTime(expression: string, after: Date, timezone?: string): Date {
  const cron = buildCron(expression, timezone ?? 'UTC');
  if (!cron) {
    // @reboot: treated as "run once at scheduler boot" — return 1ms in the future as sentinel
    return new Date(after.getTime() + 1);
  }
  try {
    const next = cron.nextRun(after);
    cron.stop();
    if (next) return next;
    // Fallback: 24h
    return new Date(after.getTime() + 86400_000);
  } catch {
    cron.stop();
    return new Date(after.getTime() + 86400_000);
  }
}

/**
 * @deprecated Legacy export kept for backward compat — use cronMatches / getNextCronTime directly.
 * Parses a 5-field expression via croner (throws on invalid).
 */
function parseCronExpression(expression: string): { expression: string } {
  if (expression.trim().toLowerCase() === REBOOT_MACRO) return { expression };
  // Validate by constructing a paused Cron (will throw if invalid)
  const c = new Cron(expression, { paused: true });
  c.stop();
  return { expression };
}

// =============================================================================
// Scheduler Singleton
// =============================================================================

export class WorkflowScheduler {
  private static instance: WorkflowScheduler | null = null;
  private intervalHandle: ReturnType<typeof setInterval> | null = null;
  private sweepHandle: ReturnType<typeof setInterval> | null = null;
  private running = false;
  private processing = false;
  // True once we've logged the "tables not present yet" warning, so the
  // fresh-install migration race only warns once instead of every poll cycle.
  private warnedMigrationPending = false;

  private constructor() {}

  static getInstance(): WorkflowScheduler {
    if (!WorkflowScheduler.instance) {
      WorkflowScheduler.instance = new WorkflowScheduler();
    }
    return WorkflowScheduler.instance;
  }

  /**
   * Start the scheduler. Call once during server startup.
   */
  async start(): Promise<void> {
    if (this.running) {
      logger.warn('[WorkflowScheduler] Already running');
      return;
    }

    this.running = true;

    logger.info({
      pollIntervalMs: POLL_INTERVAL_MS,
      maxPerCycle: MAX_PER_CYCLE,
    }, '[WorkflowScheduler] Starting workflow scheduler');

    // Initialize next_run_at for schedules that don't have one yet
    await this.initializeSchedules();

    // Start polling
    this.intervalHandle = setInterval(() => {
      this.pollAndExecute().catch((err) => {
        logger.error({ err }, '[WorkflowScheduler] Poll cycle error');
      });
    }, POLL_INTERVAL_MS);

    // Run once immediately
    this.pollAndExecute().catch((err) => {
      logger.error({ err }, '[WorkflowScheduler] Initial poll error');
    });

    // Hourly sweep: purge expired idempotency keys (I5)
    this.sweepHandle = setInterval(() => {
      sweepExpiredKeys().catch((err) => {
        logger.error({ err }, '[WorkflowScheduler] Idempotency sweep error');
      });
    }, 60 * 60 * 1000);
  }

  /**
   * Stop the scheduler gracefully.
   */
  stop(): void {
    if (this.intervalHandle) {
      clearInterval(this.intervalHandle);
      this.intervalHandle = null;
    }
    if (this.sweepHandle) {
      clearInterval(this.sweepHandle);
      this.sweepHandle = null;
    }
    this.running = false;
    logger.info('[WorkflowScheduler] Stopped');
  }

  /**
   * Initialize next_run_at for any active schedules missing it.
   *
   * Tenant scope (S5.e, 2026-05-09): runs as `withSystemTenant` because the
   * findMany enumerates schedules across ALL tenants. Per-schedule updates
   * inside the loop are administrative bookkeeping (next_run_at advance);
   * they intentionally inherit the system bypass — we don't switch into
   * `withTenant` per row here because nothing else in this method touches
   * tenanted data downstream of the update.
   */
  private async initializeSchedules(): Promise<void> {
    return withSystemTenant(async () => {
      try {
        const uninitializedSchedules = await prisma.workflowSchedule.findMany({
          where: {
            is_active: true,
            next_run_at: null,
          },
        });

        for (const schedule of uninitializedSchedules) {
          try {
            const nextRun = getNextCronTime(schedule.cron_expression, new Date(), schedule.timezone);
            await prisma.workflowSchedule.update({
              where: { id: schedule.id },
              data: { next_run_at: nextRun },
            });
            logger.info({
              scheduleId: schedule.id,
              cronExpression: schedule.cron_expression,
              nextRun: nextRun.toISOString(),
            }, '[WorkflowScheduler] Initialized schedule next_run_at');
          } catch (err) {
            logger.error({
              err,
              scheduleId: schedule.id,
              cronExpression: schedule.cron_expression,
            }, '[WorkflowScheduler] Failed to parse cron expression for schedule');
          }
        }

        logger.info({
          initializedCount: uninitializedSchedules.length,
        }, '[WorkflowScheduler] Schedule initialization complete');
      } catch (err) {
        logger.error({ err }, '[WorkflowScheduler] Failed to initialize schedules');
      }
    });
  }

  /**
   * Main poll cycle: find due schedules and trigger their workflows.
   *
   * Tenant scope (S5.e, 2026-05-09):
   *   - The `findMany` is cross-tenant (enumerates all tenants' due
   *     schedules) and runs inside `withSystemTenant`.
   *   - Each `executeSchedule(schedule)` call is invoked OUTSIDE the
   *     system bypass scope; `executeSchedule` itself wraps its body in
   *     `withTenant({ tenantId: schedule.tenant_id })`, so every Prisma
   *     write performed for a single schedule (workflowSchedule.update,
   *     workflowExecution.create, workflow.update, and the chained
   *     callbacks of executeWorkflow) runs under that tenant's scope.
   *   - The await-in-for-loop is intentional: we want each schedule's
   *     tenant scope to fully complete (or fail) before moving on, with
   *     no scope-bleed across tenants.
   */
  private async pollAndExecute(): Promise<void> {
    // Prevent overlapping cycles
    if (this.processing) return;
    this.processing = true;

    try {
      const now = new Date();

      // Cross-tenant: enumerate due schedules across ALL tenants.
      //
      // IMPORTANT: the arrow MUST be `async () => await prisma...`, NOT
      // `() => prisma...`. PrismaPromise is lazy — a non-async arrow just
      // returns the unstarted promise and `tenantStorage.run()` exits BEFORE
      // the query actually executes, dropping the AsyncLocalStorage scope.
      // The fail-closed gate in tenantPrismaExtension then throws
      // TenantNotSetError. With `async () => await`, the prisma operation
      // begins inside the ALS frame and the bypass:true context is visible
      // when the extension's $allOperations handler fires. (Flows SEV-0 #3,
      // 2026-05-13 — caused every poll cycle to crash for ~24h.)
      const dueSchedules = await withSystemTenant(async () =>
        await prisma.workflowSchedule.findMany({
          where: {
            is_active: true,
            next_run_at: { lte: now },
          },
          take: MAX_PER_CYCLE,
          orderBy: { next_run_at: 'asc' },
          include: {
            workflow: {
              select: {
                id: true,
                name: true,
                is_active: true,
                created_by: true,
                definition: true,
                deleted_at: true,
                versions: {
                  where: { is_active: true },
                  take: 1,
                },
              },
            },
          },
        }),
      );

      if (dueSchedules.length === 0) return;

      logger.info({
        dueCount: dueSchedules.length,
      }, '[WorkflowScheduler] Processing due schedules');

      for (const schedule of dueSchedules) {
        // executeSchedule wraps its body in withTenant({ tenantId: schedule.tenant_id }).
        await this.executeSchedule(schedule);
      }
    } catch (err) {
      // P2021 = "table does not exist". On a fresh install the workflows pod
      // can start polling BEFORE the api service has finished running DB
      // migrations. That's a transient startup race, not a fault — the next
      // poll succeeds once the tables exist. Log it quietly (warn, no stack)
      // and back off so we don't spam scary errors during the first ~1-2 min.
      const code = (err as { code?: string } | undefined)?.code;
      if (code === 'P2021' || code === 'P2022') {
        if (!this.warnedMigrationPending) {
          logger.warn(
            '[WorkflowScheduler] workflow tables not present yet — waiting for migrations to finish (this is normal on a fresh install)',
          );
          this.warnedMigrationPending = true;
        }
      } else {
        // A real error: log it (and clear the migration-pending flag so a
        // genuine recurrence of P2021 later would warn again).
        this.warnedMigrationPending = false;
        logger.error({ err }, '[WorkflowScheduler] Poll cycle failed');
      }
    } finally {
      this.processing = false;
    }
  }

  /**
   * Execute a single scheduled workflow.
   *
   * Tenant scope (S5.e, 2026-05-09): the entire body runs inside
   * `withTenant({ tenantId: schedule.tenant_id })` so every Prisma call —
   * direct (workflowSchedule.update / workflowExecution.create) AND
   * delegated (executeWorkflow → WorkflowExecutionEngine) — runs in the
   * correct tenant scope, picked up automatically via AsyncLocalStorage.
   *
   * Fail-CLOSED for legacy null-tenant rows: schedules whose
   * `tenant_id` is missing/empty are SKIPPED with a warn-log rather than
   * silently bypassed. The fail-closed contract in tenantPrismaExtension
   * would throw on any tenanted Prisma call without a scope, so opening a
   * `withTenant({ tenantId: null })` would crash on the first write.
   * Skipping is the safer behaviour — operations can backfill the row.
   */
  private async executeSchedule(schedule: any): Promise<void> {
    // Fail-CLOSED: legacy rows without tenant_id MUST be skipped, not bypassed.
    const tenantId: unknown = schedule?.tenant_id;
    if (typeof tenantId !== 'string' || tenantId.trim() === '') {
      logger.warn({
        scheduleId: schedule?.id,
        workflowId: schedule?.workflow_id,
      }, '[WorkflowScheduler] Skipping schedule with missing tenant_id (legacy row — backfill required)');
      return;
    }

    return withTenant({ tenantId }, async () => {
      const workflow = schedule.workflow;

      // Advance next_run_at immediately (prevents duplicate execution)
      try {
        const nextRun = getNextCronTime(schedule.cron_expression, new Date(), schedule.timezone);
        await prisma.workflowSchedule.update({
          where: { id: schedule.id },
          data: {
            next_run_at: nextRun,
            last_run_at: new Date(),
            total_runs: { increment: 1 },
          },
        });
      } catch (err) {
        logger.error({ err, scheduleId: schedule.id }, '[WorkflowScheduler] Failed to advance next_run_at');
        return;
      }

      // Validate workflow
      if (!workflow || workflow.deleted_at || !workflow.is_active) {
        logger.warn({
          scheduleId: schedule.id,
          workflowId: schedule.workflow_id,
        }, '[WorkflowScheduler] Skipping schedule - workflow inactive or deleted');

        await prisma.workflowSchedule.update({
          where: { id: schedule.id },
          data: { last_run_status: 'skipped_inactive_workflow' },
        });
        return;
      }

      // Get definition
      const version = workflow.versions[0];
      const definition = (version?.definition || workflow.definition) as any;

      if (!definition?.nodes || definition.nodes.length === 0) {
        logger.warn({
          scheduleId: schedule.id,
          workflowId: workflow.id,
        }, '[WorkflowScheduler] Skipping schedule - workflow has no nodes');

        await prisma.workflowSchedule.update({
          where: { id: schedule.id },
          data: { last_run_status: 'skipped_empty_workflow' },
        });
        return;
      }

      // Compile
      const compilationResult = compiler.compile({
        nodes: definition.nodes,
        edges: definition.edges || [],
      });

      if (!compilationResult.valid) {
        logger.error({
          scheduleId: schedule.id,
          workflowId: workflow.id,
          errors: compilationResult.errors,
        }, '[WorkflowScheduler] Skipping schedule - workflow compilation failed');

        await prisma.workflowSchedule.update({
          where: { id: schedule.id },
          data: { last_run_status: 'compilation_failed' },
        });
        return;
      }

      // Create execution record
      const inputData = (schedule.input_template as Record<string, any>) || {};
      let execution;

      try {
        execution = await prisma.workflowExecution.create({
          data: {
            workflow_id: workflow.id,
            version_id: version?.id,
            trigger_type: 'schedule',
            trigger_data: {
              schedule_id: schedule.id,
              cron_expression: schedule.cron_expression,
              scheduled_at: schedule.next_run_at,
            },
            status: 'pending',
            input: inputData,
            total_nodes: definition.nodes.length,
            started_by: workflow.created_by,
            started_at: new Date(),
          },
        });
      } catch (err) {
        logger.error({ err, scheduleId: schedule.id }, '[WorkflowScheduler] Failed to create execution record');
        return;
      }

      logger.info({
        scheduleId: schedule.id,
        workflowId: workflow.id,
        executionId: execution.id,
        cronExpression: schedule.cron_expression,
      }, '[WorkflowScheduler] Triggering scheduled workflow execution');

      // Execute workflow (fire-and-forget). The .then/.catch callbacks below
      // run AFTER this withTenant scope returns, so we re-enter the tenant
      // scope inside each callback before issuing Prisma writes.
      executeWorkflow(
        workflow.id,
        execution.id,
        { nodes: definition.nodes, edges: definition.edges || [] },
        inputData,
        workflow.created_by,
        undefined, // No auth token for scheduled executions
      ).then(async (result) => {
        await withTenant({ tenantId }, async () => {
          // Update schedule stats
          await prisma.workflowSchedule.update({
            where: { id: schedule.id },
            data: {
              last_run_status: result.success ? 'success' : 'failed',
              successful_runs: result.success ? { increment: 1 } : undefined,
              failed_runs: !result.success ? { increment: 1 } : undefined,
            },
          });

          // Update workflow stats
          await prisma.workflow.update({
            where: { id: workflow.id },
            data: {
              total_executions: { increment: 1 },
              successful_executions: result.success ? { increment: 1 } : undefined,
              failed_executions: !result.success ? { increment: 1 } : undefined,
            },
          });

          logger.info({
            scheduleId: schedule.id,
            executionId: execution.id,
            success: result.success,
          }, '[WorkflowScheduler] Scheduled execution completed');
        });
      }).catch(async (error) => {
        logger.error({
          error: error.message,
          scheduleId: schedule.id,
          executionId: execution.id,
        }, '[WorkflowScheduler] Scheduled execution failed');

        await withTenant({ tenantId }, async () => {
          await prisma.workflowSchedule.update({
            where: { id: schedule.id },
            data: {
              last_run_status: 'error',
              failed_runs: { increment: 1 },
            },
          }).catch(() => {});
        });
      });
    });
  }
}

// =============================================================================
// Convenience functions
// =============================================================================

let schedulerStarted = false;

/**
 * Start the workflow scheduler. Safe to call multiple times (no-ops after first).
 * Call this from server startup.
 */
export async function startWorkflowScheduler(): Promise<void> {
  if (schedulerStarted) return;
  schedulerStarted = true;

  const scheduler = WorkflowScheduler.getInstance();
  await scheduler.start();
}

/**
 * Stop the workflow scheduler. Call during graceful shutdown.
 */
export function stopWorkflowScheduler(): void {
  const scheduler = WorkflowScheduler.getInstance();
  scheduler.stop();
  schedulerStarted = false;
}

/**
 * Exported for testing: compute the next cron run time
 */
export { getNextCronTime, parseCronExpression, cronMatches };

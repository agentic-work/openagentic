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
 * WorkflowScheduler
 *
 * Polls for workflows with active cron schedules and triggers their execution
 * when the schedule matches. Uses a simple setInterval-based polling approach
 * rather than a cron library to keep dependencies minimal.
 *
 * On startup:
 *   1. Loads all active WorkflowSchedule records from the database
 *   2. Every POLL_INTERVAL_MS, checks if any schedule's next_run_at has passed
 *   3. If so, triggers a workflow execution and advances next_run_at
 *
 * Cron parsing is handled by a lightweight built-in parser that supports
 * standard 5-field cron expressions (minute hour day-of-month month day-of-week).
 */

import { prisma } from '../utils/prisma.js';
import { loggers } from '../utils/logger.js';
import { executeWorkflow } from './WorkflowExecutionEngine.js';
import { WorkflowCompiler } from './WorkflowCompiler.js';

const logger = loggers.services;
const compiler = new WorkflowCompiler();

// How often to poll for due schedules (default: 30 seconds)
const POLL_INTERVAL_MS = parseInt(process.env.WORKFLOW_SCHEDULER_POLL_MS || '30000', 10);

// Maximum schedules to process per poll cycle (prevent thundering herd)
const MAX_PER_CYCLE = parseInt(process.env.WORKFLOW_SCHEDULER_MAX_PER_CYCLE || '10', 10);

// =============================================================================
// Cron Expression Parser (5-field: min hour dom month dow)
// =============================================================================

interface CronFields {
  minutes: Set<number>;
  hours: Set<number>;
  daysOfMonth: Set<number>;
  months: Set<number>;
  daysOfWeek: Set<number>;
}

/**
 * Parse a single cron field into a set of matching values.
 * Supports: *, N, N-M, N/S, *\/S, N-M/S, comma-separated
 */
function parseCronField(field: string, min: number, max: number): Set<number> {
  const values = new Set<number>();

  for (const part of field.split(',')) {
    const trimmed = part.trim();

    // Handle */N (every N)
    if (trimmed.includes('/')) {
      const [rangePart, stepStr] = trimmed.split('/');
      const step = parseInt(stepStr, 10);
      if (isNaN(step) || step <= 0) continue;

      let start = min;
      let end = max;

      if (rangePart !== '*') {
        if (rangePart.includes('-')) {
          const [s, e] = rangePart.split('-').map(Number);
          start = s;
          end = e;
        } else {
          start = parseInt(rangePart, 10);
        }
      }

      for (let i = start; i <= end; i += step) {
        values.add(i);
      }
      continue;
    }

    // Handle *
    if (trimmed === '*') {
      for (let i = min; i <= max; i++) values.add(i);
      continue;
    }

    // Handle N-M (range)
    if (trimmed.includes('-')) {
      const [s, e] = trimmed.split('-').map(Number);
      for (let i = s; i <= e; i++) values.add(i);
      continue;
    }

    // Handle single value
    const val = parseInt(trimmed, 10);
    if (!isNaN(val) && val >= min && val <= max) {
      values.add(val);
    }
  }

  return values;
}

/**
 * Parse a standard 5-field cron expression
 */
function parseCronExpression(expression: string): CronFields {
  const parts = expression.trim().split(/\s+/);
  if (parts.length !== 5) {
    throw new Error(`Invalid cron expression: expected 5 fields, got ${parts.length}`);
  }

  return {
    minutes: parseCronField(parts[0], 0, 59),
    hours: parseCronField(parts[1], 0, 23),
    daysOfMonth: parseCronField(parts[2], 1, 31),
    months: parseCronField(parts[3], 1, 12),
    daysOfWeek: parseCronField(parts[4], 0, 6), // 0=Sunday
  };
}

/**
 * Check if a given Date matches a cron expression
 */
function cronMatches(date: Date, fields: CronFields): boolean {
  return (
    fields.minutes.has(date.getMinutes()) &&
    fields.hours.has(date.getHours()) &&
    fields.daysOfMonth.has(date.getDate()) &&
    fields.months.has(date.getMonth() + 1) &&
    fields.daysOfWeek.has(date.getDay())
  );
}

/**
 * Calculate the next matching time for a cron expression, starting from `after`.
 * Searches minute-by-minute up to 366 days into the future.
 */
function getNextCronTime(expression: string, after: Date): Date {
  const fields = parseCronExpression(expression);
  const candidate = new Date(after);

  // Round up to next full minute
  candidate.setSeconds(0, 0);
  candidate.setMinutes(candidate.getMinutes() + 1);

  const maxIterations = 366 * 24 * 60; // ~1 year of minutes
  for (let i = 0; i < maxIterations; i++) {
    if (cronMatches(candidate, fields)) {
      return candidate;
    }
    candidate.setMinutes(candidate.getMinutes() + 1);
  }

  // Fallback: 24 hours from now
  return new Date(after.getTime() + 86400_000);
}

// =============================================================================
// Scheduler Singleton
// =============================================================================

export class WorkflowScheduler {
  private static instance: WorkflowScheduler | null = null;
  private intervalHandle: ReturnType<typeof setInterval> | null = null;
  private running = false;
  private processing = false;

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
  }

  /**
   * Stop the scheduler gracefully.
   */
  stop(): void {
    if (this.intervalHandle) {
      clearInterval(this.intervalHandle);
      this.intervalHandle = null;
    }
    this.running = false;
    logger.info('[WorkflowScheduler] Stopped');
  }

  /**
   * Initialize next_run_at for any active schedules missing it
   */
  private async initializeSchedules(): Promise<void> {
    try {
      const uninitializedSchedules = await prisma.workflowSchedule.findMany({
        where: {
          is_active: true,
          next_run_at: null,
        },
      });

      for (const schedule of uninitializedSchedules) {
        try {
          const nextRun = getNextCronTime(schedule.cron_expression, new Date());
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
  }

  /**
   * Main poll cycle: find due schedules and trigger their workflows
   */
  private async pollAndExecute(): Promise<void> {
    // Prevent overlapping cycles
    if (this.processing) return;
    this.processing = true;

    try {
      const now = new Date();

      // Find schedules that are due
      const dueSchedules = await prisma.workflowSchedule.findMany({
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
      });

      if (dueSchedules.length === 0) return;

      logger.info({
        dueCount: dueSchedules.length,
      }, '[WorkflowScheduler] Processing due schedules');

      for (const schedule of dueSchedules) {
        await this.executeSchedule(schedule);
      }
    } catch (err) {
      logger.error({ err }, '[WorkflowScheduler] Poll cycle failed');
    } finally {
      this.processing = false;
    }
  }

  /**
   * Execute a single scheduled workflow
   */
  private async executeSchedule(schedule: any): Promise<void> {
    const workflow = schedule.workflow;

    // Advance next_run_at immediately (prevents duplicate execution)
    try {
      const nextRun = getNextCronTime(schedule.cron_expression, new Date());
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

    // Execute workflow (fire-and-forget)
    executeWorkflow(
      workflow.id,
      execution.id,
      { nodes: definition.nodes, edges: definition.edges || [] },
      inputData,
      workflow.created_by,
      undefined // No auth token for scheduled executions
    ).then(async (result) => {
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
    }).catch(async (error) => {
      logger.error({
        error: error.message,
        scheduleId: schedule.id,
        executionId: execution.id,
      }, '[WorkflowScheduler] Scheduled execution failed');

      await prisma.workflowSchedule.update({
        where: { id: schedule.id },
        data: {
          last_run_status: 'error',
          failed_runs: { increment: 1 },
        },
      }).catch(() => {});
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

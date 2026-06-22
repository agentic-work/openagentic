/**
 * Architecture source-regression test (Task 1.5 / V3 Enterprise Chatmode S5.e):
 *
 * The WorkflowScheduler is the SECOND tenanted entry point of the
 * workflows-service (Fastify routes are the first — covered by Task 1.4).
 * It runs as a `setInterval`-driven cron-style poller, has NO request
 * context, and yet performs Prisma operations against tenanted models
 * (`WorkflowSchedule`, `WorkflowExecution`, `Workflow`).
 *
 * Therefore each scheduler tick must wrap its work in:
 *   - withSystemTenant(...) when enumerating schedules across ALL tenants
 *     (initializeSchedules, the cross-tenant findMany in pollAndExecute)
 *   - withTenant({ tenantId: schedule.tenant_id }, ...) when executing
 *     the work for a SINGLE schedule (executeSchedule), so every Prisma
 *     write inside it (workflowSchedule.update / workflowExecution.create /
 *     workflow.update / nested executeWorkflow callbacks) runs under the
 *     correct tenant scope.
 *
 * This is a SOURCE-text regex scan; it pins the structural contract of
 * the scheduler file without needing a live database or scheduler boot.
 */

import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
const SCHEDULER_TS = resolve(__dirname, '../../services/WorkflowScheduler.ts');

describe('arch: WorkflowScheduler tick wraps in withTenant per active tenant (S5.e)', () => {
  const content = readFileSync(SCHEDULER_TS, 'utf8');

  it('imports withSystemTenant + withTenant from tenantPrismaExtension', () => {
    expect(content).toMatch(
      /import\s*\{[^}]*withSystemTenant[^}]*\}\s*from\s*['"][^'"]*tenantPrismaExtension(?:\.js)?['"]/,
    );
    expect(content).toMatch(
      /import\s*\{[^}]*withTenant[^}]*\}\s*from\s*['"][^'"]*tenantPrismaExtension(?:\.js)?['"]/,
    );
  });

  it('initializeSchedules() runs cross-tenant findMany inside withSystemTenant', () => {
    // initializeSchedules calls prisma.workflowSchedule.findMany across ALL tenants — needs withSystemTenant.
    // The function body must reference withSystemTenant.
    const fnRe = /private\s+async\s+initializeSchedules\s*\(\)[\s\S]+?(?=\n\s*\/\*\*|\n\s*private\s+async\s+\w+|\n\s*}\s*$)/;
    const match = content.match(fnRe);
    expect(match, 'initializeSchedules() not found').toBeTruthy();
    expect(match![0]).toMatch(/withSystemTenant\s*\(/);
  });

  it('pollAndExecute() runs cross-tenant findMany inside withSystemTenant', () => {
    const fnRe = /private\s+async\s+pollAndExecute\s*\(\)[\s\S]+?(?=\n\s*\/\*\*|\n\s*private\s+async\s+\w+|\n\s*}\s*$)/;
    const match = content.match(fnRe);
    expect(match, 'pollAndExecute() not found').toBeTruthy();
    expect(match![0]).toMatch(/withSystemTenant\s*\(/);
  });

  it('executeSchedule() wraps its body in withTenant({ tenantId })', () => {
    // executeSchedule does multiple prisma writes tenant-scoped to schedule.tenant_id.
    // The function body must wrap its core in withTenant({ tenantId: schedule.tenant_id })
    const fnRe = /private\s+async\s+executeSchedule\s*\([\s\S]+?(?=\n\s*\/\*\*|\n\s*private\s+async\s+\w+|\n\s*}\s*\n\s*}\s*$)/;
    const match = content.match(fnRe);
    expect(match, 'executeSchedule() not found').toBeTruthy();
    expect(match![0]).toMatch(/withTenant\s*\(\s*\{\s*tenantId/);
  });
});

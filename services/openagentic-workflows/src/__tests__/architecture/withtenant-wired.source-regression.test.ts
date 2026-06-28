import { describe, it, expect } from 'vitest';
import { existsSync, readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

/**
 * Substrate-fix S5 (spec §3) entry-point arch test.
 *
 * Originally this test scanned every src/services file for
 * "uses-prisma-without-withTenant" violations. After Tasks 1.4 (Fastify
 * wraps) and 1.5 (scheduler wraps) landed, the correct contract is:
 *
 *   Services using prisma INHERIT tenant context via AsyncLocalStorage from
 *   the entry point that wrapped (Fastify route handler in index.ts, or the
 *   scheduler tick in WorkflowScheduler.ts). Services do NOT need to call
 *   withTenant themselves — the AsyncLocalStorage scope propagates.
 *
 *   The actual contract this arch test pins is: every entry-point file MUST
 *   wrap its prisma-using code in withTenant() or withSystemTenant().
 *
 * Two more granular tests already exist for the per-route + per-tick wrap:
 *   - withtenant-wraps-routes.source-regression.test.ts (Task 1.4)
 *   - withtenant-wraps-scheduler.source-regression.test.ts (Task 1.5)
 *
 * This test is the OUTER gate that pins ENTRY POINTS exhaustively — if a new
 * entry point is added (e.g., a queue consumer, a websocket handler), it MUST
 * import withTenant or withSystemTenant.
 */

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

const ENTRY_POINTS = [
  resolve(__dirname, '../../index.ts'),
  resolve(__dirname, '../../services/WorkflowScheduler.ts'),
];

describe('arch: every workflows entry point imports withTenant or withSystemTenant (S5)', () => {
  it.each(ENTRY_POINTS.map((p) => [p]))('%s imports withTenant or withSystemTenant', (entry) => {
    expect(existsSync(entry), `entry point not found: ${entry}`).toBe(true);
    const content = readFileSync(entry, 'utf8');
    const importsWrap =
      /from ['"][^'"]*tenantPrismaExtension(?:\.js)?['"]/.test(content) &&
      /\b(withTenant|withSystemTenant)\s*\(/.test(content);
    expect(
      importsWrap,
      `entry point ${entry} must import withTenant or withSystemTenant from tenantPrismaExtension`,
    ).toBe(true);
  });

  it('contains the expected entry-point list (regression guard against silent removal)', () => {
    expect(ENTRY_POINTS).toHaveLength(2);
    expect(ENTRY_POINTS[0]).toMatch(/\/index\.ts$/);
    expect(ENTRY_POINTS[1]).toMatch(/\/WorkflowScheduler\.ts$/);
  });
});

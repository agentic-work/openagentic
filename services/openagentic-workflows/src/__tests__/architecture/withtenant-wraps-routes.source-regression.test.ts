/**
 * Architecture source-regression test (Task 1.4 / V3 Enterprise Chatmode S5):
 *
 * Every Fastify route handler in services/openagentic-workflows/src/index.ts
 * that performs a Prisma operation on a tenanted model MUST run its body
 * inside `withTenant({ tenantId }, async () => { ... })` so the
 * AsyncLocalStorage tenant scope is in effect for every awaited Prisma call
 * (including those made by delegated services like WorkflowExecutionEngine,
 * IdempotencyService, etc.).
 *
 * This test is intentionally a SOURCE-text regex scan rather than a runtime
 * test — at the level of "did the implementer wrap the handler body" it's
 * a structural property of the source, not behavioural.
 *
 * Routes EXEMPT from this contract (no Prisma on tenanted models):
 *   - GET /health
 *   - GET /metrics
 *   - GET /metrics/json
 *   - POST /compile
 *   - GET /node-schemas
 *
 * If a NEW Prisma-using route is added to index.ts, append it to
 * ROUTES_REQUIRING_WRAP below.
 */

import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
const INDEX_TS = resolve(__dirname, '../../index.ts');

// Routes that MUST wrap their handler body in withTenant({ tenantId }, ...).
// Each tuple: [routeMethod, routePath]
const ROUTES_REQUIRING_WRAP: Array<[string, string]> = [
  ['post', '/execute'],
  ['post', '/execute-sync'],
  ['post', '/resume-execution'],
];

describe('arch: every Prisma-using Fastify route wraps in withTenant', () => {
  const content = readFileSync(INDEX_TS, 'utf8');

  it.each(ROUTES_REQUIRING_WRAP)(
    '%s %s wraps body in withTenant({ tenantId })',
    (method, path) => {
      // Find the route registration block. Routes are registered with
      // either a typed generic (`fastify.post<{ Body: ... }>('/path', ...)`)
      // or a plain form (`fastify.post('/path', ...)`). Match from the
      // `fastify.<verb>` declaration up to (but not including) the next
      // `fastify.<verb>` registration or section divider.
      // NOTE: do NOT use the /m flag — under /m, `$` matches end-of-line,
      // which would let the lazy `[\s\S]+?` stop at the FIRST newline,
      // capturing only the typed-generic block. We want a plain regex
      // here; `[\s\S]` already crosses newlines in default mode.
      const routeRe = new RegExp(
        `fastify\\.${method}\\b[\\s\\S]*?['"]${path}['"][\\s\\S]+?(?=\\n\\s*fastify\\.(?:get|post|put|delete|patch)\\b|\\n\\s*\\/\\/ ====)`
      );
      const match = content.match(routeRe);
      expect(
        match,
        `route ${method.toUpperCase()} ${path} not found in index.ts`
      ).toBeTruthy();
      const handlerBody = match![0];
      expect(
        handlerBody,
        `route ${method.toUpperCase()} ${path} body must call withTenant({ tenantId }, ...)`
      ).toMatch(/withTenant\s*\(\s*\{\s*tenantId/);
    }
  );

  it('imports withTenant from tenantPrismaExtension', () => {
    expect(content).toMatch(
      /import\s*\{[^}]*\bwithTenant\b[^}]*\}\s*from\s*['"][^'"]*tenantPrismaExtension(?:\.js)?['"]/
    );
  });
});

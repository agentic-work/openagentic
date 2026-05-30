import { describe, it, expect, vi } from 'vitest';
import Fastify, { type FastifyInstance, type FastifyRequest } from 'fastify';

vi.mock('../../../utils/logger.js', () => {
  const noop = { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn(), fatal: vi.fn() };
  const cats = ['server','auth','chat','mcp','database','admin','routes','middleware','services','pipeline','storage','prompt'];
  const loggers: Record<string, typeof noop> = {};
  for (const c of cats) loggers[c] = { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn(), fatal: vi.fn() };
  return { default: noop, logger: noop, loggers, logError: vi.fn(), shutdown: vi.fn() };
});

vi.mock('../../../utils/prisma.js', () => ({
  prisma: {
    integration: { findFirst: vi.fn().mockResolvedValue(null) },
    workflowWebhook: { findUnique: vi.fn().mockResolvedValue(null), findMany: vi.fn().mockResolvedValue([]) },
    workflow: { findMany: vi.fn().mockResolvedValue([]) },
    workflowExecution: { create: vi.fn().mockResolvedValue({ id: 'exec-1' }), update: vi.fn() },
  },
}));

vi.mock('../../../services/SlackIntegrationService.js', () => ({
  slackIntegrationService: {
    verifySignature: vi.fn().mockReturnValue(false),
    handleEvent: vi.fn().mockResolvedValue({ statusCode: 200, body: { ok: true } }),
  },
  SlackIntegrationService: vi.fn(),
}));

vi.mock('../../../services/TeamsIntegrationService.js', () => ({
  TeamsIntegrationService: vi.fn().mockImplementation(() => ({
    verifyToken: vi.fn().mockResolvedValue(false),
    handleActivity: vi.fn().mockResolvedValue({ statusCode: 200, body: {} }),
  })),
}));

vi.mock('../../../services/WebhookSecurityService.js', () => ({
  webhookSecurityService: {
    validateRequest: vi.fn().mockResolvedValue({ allowed: true, status: 'allowed', statusCode: 200 }),
    auditLog: vi.fn().mockResolvedValue(undefined),
  },
}));

vi.mock('../../../services/WorkflowExecutionEngine.js', () => ({
  executeWorkflow: vi.fn(),
  ExecutionEvent: {},
}));

vi.mock('../../../services/WorkflowCompiler.js', () => ({
  WorkflowCompiler: vi.fn().mockImplementation(() => ({})),
}));

/** Replicates the root-level parser registration in
 *  `src/config/fastify.config.ts:82`. Anything that imports webhookRoutes via
 *  the production app graph will see this parser already in scope. */
function installRootJsonParser(app: FastifyInstance): void {
  app.addContentTypeParser('application/json', { parseAs: 'string' }, (_req: FastifyRequest, body: string | Buffer, done: (err: Error | null, body?: unknown) => void) => {
    const str = typeof body === 'string' ? body : body.toString('utf8');
    try {
      done(null, !str || str.trim() === '' ? {} : JSON.parse(str));
    } catch (err) {
      (err as { statusCode?: number }).statusCode = 400;
      done(err as Error, undefined);
    }
  });
}

describe('webhooks router — root parser collision (regression #371)', () => {
  it('registers cleanly even when the root scope already overrides application/json', async () => {
    const app = Fastify({ logger: false });
    installRootJsonParser(app);

    const { webhookRoutes } = await import('../webhooks.js');
    await expect(app.register(webhookRoutes, { prefix: '/hooks' })).resolves.not.toThrow();
    await expect(app.ready()).resolves.not.toThrow();

    await app.close();
  });

  it('registers cleanly when nested two scopes deep behind a root parser (mirrors v1Router → /api/v1 path)', async () => {
    const app = Fastify({ logger: false });
    installRootJsonParser(app);

    const { webhookRoutes } = await import('../webhooks.js');
    const v1Router = async (scope: FastifyInstance) => {
      await scope.register(webhookRoutes, { prefix: '/hooks' });
    };
    await expect(app.register(v1Router, { prefix: '/api/v1' })).resolves.not.toThrow();
    await expect(app.ready()).resolves.not.toThrow();

    await app.close();
  });

  it('registers cleanly twice (mirrors /api/v1 + /v1 alias both mounting v1Router)', async () => {
    const app = Fastify({ logger: false });
    installRootJsonParser(app);

    const { webhookRoutes } = await import('../webhooks.js');
    const v1Router = async (scope: FastifyInstance) => {
      await scope.register(webhookRoutes, { prefix: '/hooks' });
    };
    // Each register returns the chainable FastifyInstance synchronously;
    // the actual plugin lifecycle resolves on app.ready().
    app.register(v1Router, { prefix: '/api/v1' });
    app.register(v1Router, { prefix: '/v1' });
    await expect(app.ready()).resolves.not.toThrow();

    await app.close();
  });
});

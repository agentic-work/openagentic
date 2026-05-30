/**
 * Code Mode Sessions Routes
 *
 * Registers CRUD + resize endpoints under the /sessions prefix.
 * The parent plugin applies /api/code prefix and authMiddleware.
 * This module does NOT import authMiddleware — it relies on the
 * request.user guard to stay self-contained and unit-testable.
 *
 * Injectable deps via opts:
 *   opts.execClient       — CodeExecClient instance (or stub in tests)
 *   opts.codeModeSettings — CodeModeSettingsService instance (or stub)
 */

import { FastifyPluginAsync } from 'fastify';
import { randomUUID } from 'crypto';
import { mintCodeSessionToken } from '../../services/CodeSessionTokenService.js';
import { CodeExecClient } from '../../services/CodeExecClient.js';
import { CodeModeSettingsService } from '../../services/CodeModeSettingsService.js';
import { loggers } from '../../utils/logger.js';

export interface CodeSessionsPluginOptions {
  /** Injected exec HTTP client (defaults to a real CodeExecClient). */
  execClient?: Pick<CodeExecClient, 'createSession' | 'getSession' | 'stopSession' | 'resize'>;
  /** Injected settings service (defaults to a real CodeModeSettingsService). */
  codeModeSettings?: Pick<CodeModeSettingsService, 'getCodeModeSettings' | 'setCodeModeSettings'>;
}

const codeSessionsRoutes: FastifyPluginAsync<CodeSessionsPluginOptions> = async (
  fastify,
  opts,
) => {
  const logger = loggers?.api
    ? loggers.api.child({ module: 'code/sessions' })
    : (fastify.log as any);

  // Resolve injectable deps — real instances if not provided.
  const execClient: Pick<CodeExecClient, 'createSession' | 'getSession' | 'stopSession' | 'resize'> =
    opts.execClient ?? new CodeExecClient();

  // Lazy-init real CodeModeSettingsService only when needed (avoids importing
  // UserSettingsService / prisma in the hot path of tests that stub it).
  let resolvedCodeModeSettings: Pick<CodeModeSettingsService, 'getCodeModeSettings' | 'setCodeModeSettings'>;
  if (opts.codeModeSettings) {
    resolvedCodeModeSettings = opts.codeModeSettings;
  } else {
    // Defer real service construction to avoid prisma load in tests.
    const { UserSettingsService } = await import('../../services/UserSettingsService.js');
    const { createRequire } = await import('module');
    // pino logger required by UserSettingsService
    const pinoLogger = (fastify.log ?? logger) as any;
    const uss = new UserSettingsService(pinoLogger);
    resolvedCodeModeSettings = new CodeModeSettingsService(uss);
  }

  /**
   * POST /sessions
   * Body: { model?: string; repoUrl?: string }
   * Creates a new exec session and returns session metadata.
   */
  fastify.post<{ Body: { model?: string; repoUrl?: string } }>(
    '/sessions',
    async (request, reply) => {
      const user = (request as any).user;
      const userId: string | undefined = user?.id || user?.userId;

      if (!userId) {
        return reply.code(401).send({ error: 'unauthorized' });
      }

      const body = (request.body as { model?: string; repoUrl?: string }) ?? {};
      const sessionId = randomUUID();
      const workspacePath = `/workspaces/${userId}/${sessionId}`;

      const authToken = mintCodeSessionToken({ userId, sessionId });

      const apiEndpoint =
        process.env.OPENAGENTIC_API_INTERNAL_URL || 'http://api:8000';

      const session = await execClient.createSession({
        sessionId,
        userId,
        userEmail: user?.email,
        workspacePath,
        model: body.model || '',
        authToken,
        apiEndpoint,
      });

      await resolvedCodeModeSettings.setCodeModeSettings(userId, {
        lastModel: body.model || '',
        lastWorkspace: body.repoUrl || '',
      });

      return reply.code(200).send({
        sessionId: session.sessionId,
        status: session.status,
        workspacePath: session.workspacePath,
        repoUrl: body.repoUrl || null,
      });
    },
  );

  /**
   * GET /sessions/:id
   * Returns the exec session record.
   */
  fastify.get<{ Params: { id: string } }>(
    '/sessions/:id',
    async (request, reply) => {
      const user = (request as any).user;
      const userId: string | undefined = user?.id || user?.userId;

      if (!userId) {
        return reply.code(401).send({ error: 'unauthorized' });
      }

      const { id } = request.params;

      try {
        const session = await execClient.getSession(id);
        return reply.code(200).send(session);
      } catch (err: any) {
        const msg: string = err?.message ?? '';
        if (msg.includes('404') || msg.toLowerCase().includes('not found')) {
          return reply.code(404).send({ error: 'session not found' });
        }
        logger.error?.({ err, sessionId: id }, 'getSession failed');
        throw err;
      }
    },
  );

  /**
   * DELETE /sessions/:id
   * Stops (terminates) the exec session.
   */
  fastify.delete<{ Params: { id: string } }>(
    '/sessions/:id',
    async (request, reply) => {
      const user = (request as any).user;
      const userId: string | undefined = user?.id || user?.userId;

      if (!userId) {
        return reply.code(401).send({ error: 'unauthorized' });
      }

      const { id } = request.params;
      await execClient.stopSession(id);
      return reply.code(200).send({ stopped: true });
    },
  );

  /**
   * POST /sessions/:id/resize
   * Body: { cols: number; rows: number }
   * Sends a PTY resize event to the exec service.
   */
  fastify.post<{ Params: { id: string }; Body: { cols: number; rows: number } }>(
    '/sessions/:id/resize',
    async (request, reply) => {
      const user = (request as any).user;
      const userId: string | undefined = user?.id || user?.userId;

      if (!userId) {
        return reply.code(401).send({ error: 'unauthorized' });
      }

      const { id } = request.params;
      const { cols, rows } = request.body ?? {};
      await execClient.resize(id, cols, rows);
      return reply.code(200).send({ ok: true });
    },
  );
};

export default codeSessionsRoutes;

/**
 * Code Routes
 * API endpoints for AgenticWorkCode functionality
 *
 * Adapted for Fastify from the AgenticWorkCode specification
 */

import { FastifyInstance, FastifyRequest, FastifyReply } from 'fastify';
import type { Logger } from 'pino';
import { ProviderManager } from '../services/llm-providers/ProviderManager.js';
import { UserPermissionsService } from '../services/UserPermissionsService.js';
import { prisma } from '../utils/prisma.js';

// SECURITY: Internal API key for code-manager authentication.
// Read fresh per-call from the Vault → ESO → projected Secret mount (#416).
import { getInternalKey } from '../utils/internalKeyReader.js';

// OSS stub — AgenticCodeService pending sync
class AgenticCodeService {
  constructor(..._: any[]) {}
  async createSession(..._: any[]): Promise<any> { throw new Error('AgenticCodeService pending sync'); }
  async getSession(..._: any[]): Promise<any> { return null; }
  async deleteSession(..._: any[]): Promise<any> { return; }
  async executeAgentLoop(..._: any[]): Promise<any> { throw new Error('AgenticCodeService pending sync'); }
  async listFiles(..._: any[]): Promise<any> { return []; }
  async readFile(..._: any[]): Promise<any> { return ''; }
  async writeFile(..._: any[]): Promise<any> { return; }
  async deleteFile(..._: any[]): Promise<any> { return; }
}


/**
 * Create fetch headers with internal authentication
 * SECURITY: All requests to code-manager must include the internal API key
 */
function createInternalHeaders(contentType = false): HeadersInit {
  const headers: HeadersInit = {};
  const key = getInternalKey();
  if (key) {
    headers['X-Internal-API-Key'] = key;
  }
  if (contentType) {
    headers['Content-Type'] = 'application/json';
  }
  return headers;
}

// Types for request bodies
interface CreateSessionBody {
  model?: string;
}

interface ExecuteBody {
  sessionId: string;
  prompt: string;
  model?: string;
}

interface WriteFileBody {
  sessionId?: string;
  content: string;
}

interface FilesQuery {
  sessionId?: string;
  path?: string;
}

interface CodeRoutesOptions {
  providerManager?: ProviderManager;
}

/**
 * Register code routes
 */
export default async function codeRoutes(fastify: FastifyInstance, options: CodeRoutesOptions) {
  // Initialize permissions service
  const permissionsService = new UserPermissionsService(prisma, fastify.log as Logger);

  // Get providerManager from options (passed from server.ts)
  const providerManager = options.providerManager;

  if (!providerManager) {
    fastify.log.warn('ProviderManager not available, AgenticCodeService will have limited functionality');
  }

  const managerUrl = process.env.CODE_MANAGER_URL || 'http://agenticode-manager:3050';

  // Middleware to check AWCode permission
  // Admins always have access, non-admins need explicit canUseAwcode permission
  fastify.addHook('preHandler', async (request: FastifyRequest, reply: FastifyReply) => {
    // Skip permission check for health endpoint (unauthenticated)
    if (request.url.endsWith('/health')) {
      return;
    }

    // Skip permission check for access-check endpoint (internal MCP use)
    if (request.url.includes('/access-check')) {
      return;
    }

    // Ensure user is authenticated
    if (!request.user || !request.user.id) {
      reply.code(401).send({ error: 'Unauthorized' });
      return;
    }

    const userId = request.user.id;
    const isAdmin = request.user.isAdmin || false;
    const userGroups = request.user.groups || [];

    // Check AWCode access permission
    const canAccess = await permissionsService.canAccessAwcode(userId, isAdmin, userGroups);

    if (!canAccess) {
      request.log.warn({ userId, isAdmin }, 'AWCode access denied - user lacks permission');
      reply.code(403).send({
        error: 'AWCode access denied',
        message: 'You do not have permission to use AgenticWork Code. Please contact an administrator to enable this feature.'
      });
      return;
    }
  });

  // Only create codeService if providerManager is available
  // The execute endpoint requires LLM access.
  // M17c: defaultModel left undefined here so AgenticCodeService resolves
  // each session's model at request time via
  // ModelConfigurationService.getDefaultChatModel() (registry SoT).
  // Replaces an env-driven bypass that pinned a constructor-time default
  // even after the operator changed the registry's chat row.
  const codeService = providerManager ? new AgenticCodeService(
    fastify.log as Logger,
    providerManager,
    {
      managerUrl,
    }
  ) : null;

  // NOTE: access-check endpoint moved to server.ts (outside auth wrapper for internal MCP use)
  // NOTE: Health check endpoint is registered at server level (no auth required)
  // See server.ts for /api/code/health and /api/code/access-check endpoints

  /**
   * Create or get existing code session
   * POST /api/code/sessions
   *
   * For managed mode, the auth token is passed to the CLI so it can
   * route LLM calls through the AgenticWork API.
   */
  fastify.post<{ Body: CreateSessionBody }>(
    '/sessions',
    async (request: FastifyRequest<{ Body: CreateSessionBody }>, reply: FastifyReply) => {
      try {
        if (!codeService) {
          return reply.code(503).send({ error: 'AWCode service unavailable - ProviderManager not initialized' });
        }

        // Ensure user is authenticated
        if (!request.user || !request.user.id) {
          return reply.code(401).send({ error: 'Unauthorized' });
        }

        const userId = request.user.id;
        const { model } = request.body;

        // Extract auth token for managed mode - CLI will use this to call AgenticWork API
        const authHeader = request.headers.authorization;
        const apiKey = authHeader?.startsWith('Bearer ') ? authHeader.slice(7) : undefined;

        const session = await codeService.createSession(userId, model, {
          apiKey,
          userEmail: (request.user as any).email,  // For Linux username in sandbox (e.g., john.doe@company.com -> john-doe)
        });
        return reply.send(session);
      } catch (error) {
        request.log.error({ err: error }, 'Failed to create code session');
        return reply.code(500).send({ error: 'Failed to create session' });
      }
    }
  );

  /**
   * Get session status
   * GET /api/code/sessions/:sessionId
   */
  fastify.get<{ Params: { sessionId: string } }>(
    '/sessions/:sessionId',
    async (request: FastifyRequest<{ Params: { sessionId: string } }>, reply: FastifyReply) => {
      try {
        if (!codeService) {
          return reply.code(503).send({ error: 'AWCode service unavailable - ProviderManager not initialized' });
        }

        // Ensure user is authenticated
        if (!request.user || !request.user.id) {
          return reply.code(401).send({ error: 'Unauthorized' });
        }

        const userId = request.user.id;
        const { sessionId } = request.params;

        const session = await codeService.getSession(sessionId, userId);
        if (!session) {
          return reply.code(404).send({ error: 'Session not found' });
        }
        return reply.send(session);
      } catch (error) {
        request.log.error({ err: error }, 'Failed to get session');
        return reply.code(500).send({ error: 'Failed to get session' });
      }
    }
  );

  // NOTE: The legacy SSE bridge POST /api/code/sessions/:sessionId/chat
  // was removed in #324 Phase 3-4. The single transport for native
  // chat-mode is now the WebSocket at GET /api/code/ws/chat (registered
  // in server.ts), which proxies to agenticode-exec's /ws/chat/:sessionId
  // and carries both the stream-json turn and control frames on one
  // persistent connection. Do not reintroduce an HTTP chat route here.

  /**
   * Native chat control-frame injector
   * POST /api/code/sessions/:sessionId/chat/control
   *
   * Body: a raw stream-json control record, e.g.
   *   { type: 'control_request', request: { subtype: 'interrupt' } }
   *   { type: 'control_response', response: { ... } }
   *
   * Thin proxy to agenticode-manager → agenticode-exec, which holds
   * the in-flight agenticode child's stdin. Used by the browser to
   * send Esc/Ctrl+C interrupts and permission dialog approve/deny
   * responses mid-turn. See the chat/control handler in
   * agenticode-exec/src/index.ts for the frame semantics.
   */
  fastify.post<{
    Params: { sessionId: string };
    Body: Record<string, unknown>;
  }>(
    '/sessions/:sessionId/chat/control',
    async (request, reply) => {
      try {
        if (!request.user || !request.user.id) {
          return reply.code(401).send({ error: 'Unauthorized' });
        }
        const { sessionId } = request.params;
        const body = (request.body || {}) as Record<string, unknown>;
        if (!body || typeof body !== 'object' || !body.type) {
          return reply.code(400).send({ error: 'body must be a control frame with a `type` field' });
        }

        const upstream = await fetch(
          `${managerUrl}/sessions/${encodeURIComponent(sessionId)}/chat/control`,
          {
            method: 'POST',
            headers: createInternalHeaders(true),
            body: JSON.stringify(body),
          },
        );
        const text = await upstream.text();
        reply.code(upstream.status);
        reply.header(
          'content-type',
          upstream.headers.get('content-type') || 'application/json',
        );
        return reply.send(text);
      } catch (err) {
        request.log.error({ err }, 'chat-control: proxy failed');
        return reply.code(502).send({ error: 'Failed to forward chat control frame' });
      }
    },
  );

  /**
   * Upload a file to the session's workspace
   * POST /api/code/sessions/:sessionId/upload
   *
   * Body: { filename: string, content: string (base64), targetPath?: string }
   *
   * Proxies to agenticode-exec's /sessions/:id/upload endpoint which
   * writes the decoded file to the pod's workspace (default: uploads/).
   */
  fastify.post<{
    Params: { sessionId: string };
    Body: { filename: string; content: string; targetPath?: string };
  }>(
    '/sessions/:sessionId/upload',
    async (request, reply) => {
      try {
        if (!request.user || !request.user.id) {
          return reply.code(401).send({ error: 'Unauthorized' });
        }
        const { sessionId } = request.params;
        const body = request.body || {};

        const upstream = await fetch(
          `${managerUrl}/sessions/${encodeURIComponent(sessionId)}/upload`,
          {
            method: 'POST',
            headers: createInternalHeaders(true),
            body: JSON.stringify(body),
          },
        );
        const text = await upstream.text();
        reply.code(upstream.status);
        reply.header('content-type', upstream.headers.get('content-type') || 'application/json');
        return reply.send(text);
      } catch (err) {
        request.log.error({ err }, 'file-upload: proxy failed');
        return reply.code(502).send({ error: 'Failed to upload file' });
      }
    },
  );

  /**
   * Delete session and cleanup container
   * DELETE /api/code/sessions/:sessionId
   */
  fastify.delete<{ Params: { sessionId: string } }>(
    '/sessions/:sessionId',
    async (request: FastifyRequest<{ Params: { sessionId: string } }>, reply: FastifyReply) => {
      try {
        if (!codeService) {
          return reply.code(503).send({ error: 'AWCode service unavailable - ProviderManager not initialized' });
        }

        // Ensure user is authenticated
        if (!request.user || !request.user.id) {
          return reply.code(401).send({ error: 'Unauthorized' });
        }

        const userId = request.user.id;
        const { sessionId } = request.params;

        await codeService.deleteSession(sessionId, userId);
        return reply.send({ status: 'deleted' });
      } catch (error) {
        request.log.error({ err: error }, 'Failed to delete session');
        return reply.code(500).send({ error: 'Failed to delete session' });
      }
    }
  );

  /**
   * Execute agentic code loop (SSE streaming)
   * POST /api/code/execute
   */
  fastify.post<{ Body: ExecuteBody }>(
    '/execute',
    async (request: FastifyRequest<{ Body: ExecuteBody }>, reply: FastifyReply): Promise<void> => {
      try {
        if (!codeService) {
          reply.code(503).send({ error: 'AWCode service unavailable - ProviderManager not initialized' });
          return;
        }

        // Ensure user is authenticated
        if (!request.user || !request.user.id) {
          reply.code(401).send({ error: 'Unauthorized' });
          return;
        }

        const userId = request.user.id;
        const { sessionId, prompt, model } = request.body;

        if (!sessionId || !prompt) {
          reply.code(400).send({ error: 'sessionId and prompt required' });
          return;
        }

        // Hijack the connection for SSE streaming
        reply.hijack();

        // Set up SSE headers
        reply.raw.writeHead(200, {
          'Content-Type': 'text/event-stream',
          'Cache-Control': 'no-cache',
          'Connection': 'keep-alive',
          'X-Accel-Buffering': 'no' // CRITICAL: Disable NGINX buffering for SSE streaming
        });

        try {
          await codeService.executeAgentLoop(
            sessionId,
            userId,
            prompt,
            model,
            (event) => {
              reply.raw.write(`data: ${JSON.stringify(event)}\n\n`);
            }
          );
          reply.raw.write(`data: ${JSON.stringify({ type: 'done' })}\n\n`);
        } catch (error: any) {
          request.log.error({ err: error }, 'Agentic loop error');
          reply.raw.write(`data: ${JSON.stringify({
            type: 'error',
            content: error.message || 'Execution failed'
          })}\n\n`);
        }
        reply.raw.end();
      } catch (error) {
        request.log.error({ err: error }, 'Agentic loop setup error');
        if (!reply.raw.headersSent) {
          reply.hijack();
          reply.raw.writeHead(200, {
            'Content-Type': 'text/event-stream',
            'Cache-Control': 'no-cache',
            'Connection': 'keep-alive',
            'X-Accel-Buffering': 'no' // CRITICAL: Disable NGINX buffering for SSE streaming
          });
        }
        reply.raw.write(`data: ${JSON.stringify({
          type: 'error',
          message: 'Execution failed'
        })}\n\n`);
        reply.raw.end();
      }
    }
  );

  /**
   * List files in workspace
   * GET /api/code/files
   */
  fastify.get<{ Querystring: FilesQuery }>(
    '/files',
    async (request: FastifyRequest<{ Querystring: FilesQuery }>, reply: FastifyReply) => {
      try {
        if (!codeService) {
          return reply.code(503).send({ error: 'AWCode service unavailable - ProviderManager not initialized' });
        }

        // Ensure user is authenticated
        if (!request.user || !request.user.id) {
          return reply.code(401).send({ error: 'Unauthorized' });
        }

        const userId = request.user.id;
        const { sessionId, path = '.' } = request.query;

        if (!sessionId) {
          return reply.code(400).send({ error: 'sessionId required' });
        }

        const files = await codeService.listFiles(sessionId, userId, path);
        return reply.send(files);
      } catch (error) {
        request.log.error({ err: error }, 'Failed to list files');
        return reply.code(500).send({ error: 'Failed to list files' });
      }
    }
  );

  /**
   * Read file content
   * GET /api/code/files/*
   */
  fastify.get<{ Params: { '*': string }, Querystring: { sessionId?: string } }>(
    '/files/*',
    async (request: FastifyRequest<{ Params: { '*': string }, Querystring: { sessionId?: string } }>, reply: FastifyReply) => {
      try {
        if (!codeService) {
          return reply.code(503).send({ error: 'AWCode service unavailable - ProviderManager not initialized' });
        }

        // Ensure user is authenticated
        if (!request.user || !request.user.id) {
          return reply.code(401).send({ error: 'Unauthorized' });
        }

        const userId = request.user.id;
        const { sessionId } = request.query;
        const filePath = request.params['*'];

        if (!sessionId) {
          return reply.code(400).send({ error: 'sessionId required' });
        }

        const content = await codeService.readFile(sessionId, userId, filePath);
        return reply.send({ path: filePath, content });
      } catch (error) {
        request.log.error({ err: error }, 'Failed to read file');
        return reply.code(500).send({ error: 'Failed to read file' });
      }
    }
  );

  /**
   * Write file content
   * PUT /api/code/files/*
   */
  fastify.put<{ Params: { '*': string }, Querystring: { sessionId?: string }, Body: WriteFileBody }>(
    '/files/*',
    async (request: FastifyRequest<{ Params: { '*': string }, Querystring: { sessionId?: string }, Body: WriteFileBody }>, reply: FastifyReply) => {
      try {
        if (!codeService) {
          return reply.code(503).send({ error: 'AWCode service unavailable - ProviderManager not initialized' });
        }

        // Ensure user is authenticated
        if (!request.user || !request.user.id) {
          return reply.code(401).send({ error: 'Unauthorized' });
        }

        const userId = request.user.id;
        const { sessionId } = request.query;
        const { content } = request.body;
        const filePath = request.params['*'];

        if (!sessionId) {
          return reply.code(400).send({ error: 'sessionId required' });
        }

        await codeService.writeFile(sessionId, userId, filePath, content);
        return reply.send({ status: 'written', path: filePath });
      } catch (error) {
        request.log.error({ err: error }, 'Failed to write file');
        return reply.code(500).send({ error: 'Failed to write file' });
      }
    }
  );

  /**
   * Delete file
   * DELETE /api/code/files/*
   */
  fastify.delete<{ Params: { '*': string }, Querystring: { sessionId?: string } }>(
    '/files/*',
    async (request: FastifyRequest<{ Params: { '*': string }, Querystring: { sessionId?: string } }>, reply: FastifyReply) => {
      try {
        if (!codeService) {
          return reply.code(503).send({ error: 'AWCode service unavailable - ProviderManager not initialized' });
        }

        // Ensure user is authenticated
        if (!request.user || !request.user.id) {
          return reply.code(401).send({ error: 'Unauthorized' });
        }

        const userId = request.user.id;
        const { sessionId } = request.query;
        const filePath = request.params['*'];

        if (!sessionId) {
          return reply.code(400).send({ error: 'sessionId required' });
        }

        await codeService.deleteFile(sessionId, userId, filePath);
        return reply.send({ status: 'deleted', path: filePath });
      } catch (error) {
        request.log.error({ err: error }, 'Failed to delete file');
        return reply.code(500).send({ error: 'Failed to delete file' });
      }
    }
  );

}

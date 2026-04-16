import type { FastifyInstance, FastifyReply } from 'fastify';
import { SSERelay } from '../services/SSERelay';
import { authMiddleware } from '../middleware/auth';
import { logger } from '../utils/logger';

export async function streamRoutes(app: FastifyInstance): Promise<void> {
  app.get<{ Params: { executionId: string } }>('/api/agents/stream/:executionId', {
    preHandler: authMiddleware,
  }, async (request, reply: FastifyReply) => {
    const { executionId } = request.params;

    reply.raw.writeHead(200, {
      'Content-Type': 'text/event-stream',
      'Cache-Control': 'no-cache',
      'Connection': 'keep-alive',
      'X-Accel-Buffering': 'no',
    });

    // Send initial connection event
    reply.raw.write(`data: ${JSON.stringify({ event: 'connected', executionId })}\n\n`);

    // Subscribe to Redis pub/sub for this execution
    const unsubscribe = await SSERelay.subscribe(executionId, (event, data) => {
      try {
        reply.raw.write(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`);
      } catch {
        // Client disconnected
      }

      // Close stream on execution_complete
      if (event === 'execution_complete') {
        setTimeout(() => {
          try { reply.raw.end(); } catch {}
        }, 500);
      }
    });

    // Cleanup on client disconnect
    request.raw.on('close', () => {
      unsubscribe();
      logger.debug({ executionId }, 'SSE client disconnected');
    });

    // Keep connection alive
    const keepAlive = setInterval(() => {
      try { reply.raw.write(':keepalive\n\n'); } catch { clearInterval(keepAlive); }
    }, 15000);

    request.raw.on('close', () => clearInterval(keepAlive));
  });
}

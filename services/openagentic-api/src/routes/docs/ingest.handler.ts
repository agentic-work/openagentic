/**
 * Documentation Ingestion Handler
 *
 * Admin-only endpoint to trigger reconciliation of platform documentation
 * against the UI image's manifest fingerprint (task #157). Re-embeds only
 * when the hash has drifted, so repeated calls are cheap.
 *
 * POST /api/docs/ingest
 *   ?force=true  → bypass hash check, always reingest
 *   ?force=false → reconcile path (default)
 *
 * Response:
 *   { action: 'reingested' | 'skipped' | 'first-ingest',
 *     manifestHash, rowsBefore, rowsAfter, durationMs, reason }
 */

import { FastifyRequest, FastifyReply } from 'fastify';
import { loggers } from '../../utils/logger.js';
import { ragInitService } from '../../services/RAGInitService.js';

export async function docsIngestHandler(
  request: FastifyRequest,
  reply: FastifyReply,
): Promise<void> {
  const logger = loggers.routes;
  const user = (request as any).user;
  const query = (request.query as Record<string, unknown>) || {};
  const forceRaw = query.force;
  const force = forceRaw === true || forceRaw === 'true' || forceRaw === '1';

  logger.info({ userId: user?.id, force }, '[docs-ingest] Reconcile triggered');

  try {
    const result = await ragInitService.reconcileDocsIngest({ force });

    logger.info(
      { ...result, userId: user?.id },
      '[docs-ingest] Reconcile complete',
    );

    reply.send({
      success: true,
      action: result.action,
      manifestHash: result.manifestHash,
      rowsBefore: result.rowsBefore,
      rowsAfter: result.rowsAfter,
      durationMs: result.durationMs,
      reason: result.reason,
    });
  } catch (err: any) {
    logger.error({ err }, '[docs-ingest] Reconcile failed');
    reply.code(500).send({
      success: false,
      error: { code: 'INGESTION_FAILED', message: err.message || 'Documentation ingestion failed' },
    });
  }
}

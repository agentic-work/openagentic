/**
 * Documentation Ingestion Handler
 *
 * Admin-only endpoint to trigger re-ingestion of all platform documentation
 * into the Milvus vector collection for RAG-powered doc search.
 *
 * POST /api/docs/ingest
 */

import { FastifyRequest, FastifyReply } from 'fastify';
import { loggers } from '../../utils/logger.js';
import { getDocsRAGService } from '../../services/DocsRAGService.js';

export async function docsIngestHandler(
  request: FastifyRequest,
  reply: FastifyReply,
): Promise<void> {
  const logger = loggers.routes;
  const user = (request as any).user;

  logger.info({ userId: user?.id }, '[docs-ingest] Ingestion triggered');

  try {
    const docsRAG = getDocsRAGService(logger);
    const result = await docsRAG.ingestDocs();

    logger.info({ chunksIngested: result.chunksIngested, userId: user?.id }, '[docs-ingest] Ingestion complete');

    reply.send({
      success: true,
      chunksIngested: result.chunksIngested,
      message: `Successfully ingested ${result.chunksIngested} documentation chunks into the vector store.`,
    });
  } catch (err: any) {
    logger.error({ err }, '[docs-ingest] Ingestion failed');
    reply.code(500).send({
      success: false,
      error: { code: 'INGESTION_FAILED', message: err.message || 'Documentation ingestion failed' },
    });
  }
}

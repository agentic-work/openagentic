import { prisma } from '../../utils/prisma.js';
import { loggers } from '../../utils/logger.js';

const logger = loggers.services;

export class ModuleEmbeddingService {
  static async ensureTable(): Promise<void> {
    // Embedding column is declared as untyped `halfvec` — no hardcoded dim.
    // DatabaseService.ensureEmbeddingDimensions() ALTERs it to halfvec(N)
    // at startup using the active embedding provider's dimensions.
    // See docs/rules/no-hardcoded-models.md.
    await prisma.$executeRawUnsafe(`
      CREATE TABLE IF NOT EXISTS prompt_module_embeddings (
        id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
        module_id UUID NOT NULL,
        module_name VARCHAR(100) NOT NULL,
        description TEXT NOT NULL,
        embedding halfvec,
        created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
        updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
      )
    `);
    // Create btree index on module_id (HNSW index on embedding is created
    // by DatabaseService.ensureEmbeddingDimensions after dim is bound).
    try {
      await prisma.$executeRawUnsafe(`
        CREATE INDEX IF NOT EXISTS idx_pme_module_id ON prompt_module_embeddings(module_id)
      `);
    } catch {
      /* index may already exist */
    }
  }

  static async upsertEmbedding(
    moduleId: string,
    moduleName: string,
    description: string,
    embedding: number[],
  ): Promise<void> {
    const vectorStr = `[${embedding.join(',')}]`;
    // Delete existing then insert (upsert pattern for pgvector)
    await prisma.$executeRawUnsafe(
      `DELETE FROM prompt_module_embeddings WHERE module_id = $1::uuid`,
      moduleId,
    );
    await prisma.$executeRawUnsafe(
      `INSERT INTO prompt_module_embeddings (module_id, module_name, description, embedding) VALUES ($1::uuid, $2, $3, $4::halfvec)`,
      moduleId,
      moduleName,
      description,
      vectorStr,
    );
  }

  static async searchSimilar(
    queryEmbedding: number[],
    limit: number = 10,
  ): Promise<Array<{ module_id: string; module_name: string; similarity: number }>> {
    const vectorStr = `[${queryEmbedding.join(',')}]`;
    const results = await prisma.$queryRawUnsafe<any[]>(
      `SELECT module_id, module_name, 1 - (embedding <=> $1::halfvec) as similarity
       FROM prompt_module_embeddings
       ORDER BY embedding <=> $1::halfvec
       LIMIT $2`,
      vectorStr,
      limit,
    );
    return results.map((r) => ({
      module_id: r.module_id,
      module_name: r.module_name,
      similarity: Number(r.similarity),
    }));
  }

  static async generateAndStoreEmbeddings(
    modules: Array<{ id: string; name: string; description: string }>,
  ): Promise<number> {
    let count = 0;
    for (const mod of modules) {
      try {
        // Dynamic import to avoid circular dependencies
        const { UniversalEmbeddingService } = await import('../UniversalEmbeddingService.js');
        const embeddingService = new UniversalEmbeddingService();
        const result = await embeddingService.generateEmbedding(mod.description);
        const embedding = result?.embedding;
        if (embedding && embedding.length > 0) {
          await ModuleEmbeddingService.upsertEmbedding(mod.id, mod.name, mod.description, embedding);
          count++;
        }
      } catch (err: any) {
        // Non-fatal — module works without embedding, just won't be found via semantic search
        logger.warn(
          { moduleName: mod.name, error: err.message },
          `[ModuleEmbeddingService] Failed to embed module ${mod.name}`,
        );
      }
    }
    return count;
  }
}

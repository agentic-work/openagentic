/**
 * Copyright 2026 Gnomus.ai
 *
 * Licensed under the Apache License, Version 2.0 (the "License");
 * you may not use this file except in compliance with the License.
 * You may obtain a copy of the License at
 *
 *     http://www.apache.org/licenses/LICENSE-2.0
 *
 * Unless required by applicable law or agreed to in writing, software
 * distributed under the License is distributed on an "AS IS" BASIS,
 * WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
 * See the License for the specific language governing permissions and
 * limitations under the License.
 */

/**
 * Semantic Response Cache (Dedup Layer 1)
 *
 * Caches full LLM responses keyed by semantic embedding of the user message.
 * RBAC-scoped: only users with the same credential scope can share cached responses.
 * Cross-user dedup: if two users with identical RBAC scope ask semantically equivalent
 * questions, the second user gets the cached response instantly.
 */

import { prisma } from '../utils/prisma.js';
import { createHash } from 'crypto';

export class SemanticResponseCache {
  private static instance: SemanticResponseCache;

  static getInstance(): SemanticResponseCache {
    if (!this.instance) this.instance = new SemanticResponseCache();
    return this.instance;
  }

  /**
   * Check whether a semantically equivalent response exists for the RBAC scope.
   * Returns cached row or null on miss / error.
   */
  async checkCache(
    message: string,
    rbacScopeHash: string,
    threshold = 0.92,
  ): Promise<any | null> {
    try {
      const { UniversalEmbeddingService } = await import('./UniversalEmbeddingService.js');
      const embeddingService = new UniversalEmbeddingService();
      const result = await embeddingService.generateEmbedding(message);
      const embedding = result?.embedding;
      if (!embedding || embedding.length === 0) return null;

      const vectorStr = `[${embedding.join(',')}]`;
      const results = await prisma.$queryRawUnsafe<any[]>(
        `
        SELECT response, tool_results, similarity, created_at
        FROM semantic_response_cache
        WHERE rbac_scope_hash = $1
          AND 1 - (embedding <=> $2::halfvec) >= $3
          AND created_at > now() - interval '1 hour'
        ORDER BY embedding <=> $2::halfvec
        LIMIT 1
        `,
        rbacScopeHash,
        vectorStr,
        threshold,
      );

      return results.length > 0 ? results[0] : null;
    } catch {
      return null;
    }
  }

  /**
   * Store a response in the semantic cache.
   * Non-fatal — any errors are swallowed.
   */
  async storeResponse(
    message: string,
    response: string,
    toolResults: any[],
    rbacScopeHash: string,
    ttlSeconds = 900,
  ): Promise<void> {
    try {
      const { UniversalEmbeddingService } = await import('./UniversalEmbeddingService.js');
      const embeddingService = new UniversalEmbeddingService();
      const result = await embeddingService.generateEmbedding(message);
      const embedding = result?.embedding;
      if (!embedding || embedding.length === 0) return;

      const vectorStr = `[${embedding.join(',')}]`;
      await prisma.$executeRawUnsafe(
        `
        INSERT INTO semantic_response_cache (message, response, tool_results, embedding, rbac_scope_hash, ttl_seconds)
        VALUES ($1, $2, $3::jsonb, $4::halfvec, $5, $6)
        `,
        message,
        response,
        JSON.stringify(toolResults || []),
        vectorStr,
        rbacScopeHash,
        ttlSeconds,
      );
    } catch {
      /* non-fatal */
    }
  }

  /**
   * Generate a stable RBAC scope hash from the user's credentials.
   * Two users with identical credentials will get the same hash → cross-user dedup.
   */
  static generateRbacHash(user: any): string {
    const scopeData =
      (user.accessToken?.substring(0, 50) || '') +
      (user.azureTenantId || '') +
      (user.awsAccountId || '') +
      user.id;
    return createHash('sha256').update(scopeData).digest('hex');
  }

  /**
   * Create the semantic_response_cache table and indexes if they don't exist.
   * Called once during API startup.
   */
  static async ensureTable(): Promise<void> {
    // Embedding column declared as untyped `halfvec`. DatabaseService.
    // ensureEmbeddingDimensions() ALTERs to halfvec(N) matching the active
    // embedding provider at startup. See docs/rules/no-hardcoded-models.md.
    await prisma.$executeRawUnsafe(`
      CREATE TABLE IF NOT EXISTS semantic_response_cache (
        id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
        message TEXT NOT NULL,
        response TEXT NOT NULL,
        tool_results JSONB,
        embedding halfvec,
        rbac_scope_hash VARCHAR(64) NOT NULL,
        ttl_seconds INT DEFAULT 900,
        created_at TIMESTAMPTZ NOT NULL DEFAULT now()
      )
    `);
    try {
      await prisma.$executeRawUnsafe(
        `CREATE INDEX IF NOT EXISTS idx_src_rbac ON semantic_response_cache(rbac_scope_hash)`,
      );
      await prisma.$executeRawUnsafe(
        `CREATE INDEX IF NOT EXISTS idx_src_created ON semantic_response_cache(created_at)`,
      );
    } catch {
      /* indexes may already exist */
    }
  }
}

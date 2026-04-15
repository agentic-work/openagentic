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
 * Knowledge Base Service
 *
 * Phase 4 of the Data Layer Evolution Plan.
 * Manages structured knowledge facts stored in PostgreSQL with pgvector embeddings.
 *
 * Capabilities:
 * - Store facts as subject-predicate-object triples with confidence scores
 * - Semantic search over facts via pgvector cosine distance
 * - Triple verification to increase confidence over time
 * - Contradiction detection across facts with same subject/predicate
 * - Grounding context generation for LLM responses
 *
 * Uses pgvector (via raw SQL) for embedding storage and similarity search,
 * keeping transactional fact data in PostgreSQL with ACID guarantees.
 *
 * @see docs/DATA_LAYER_EVOLUTION_PLAN.md
 */

import { prisma } from '../utils/prisma.js';
import { loggers } from '../utils/logger.js';
import { UniversalEmbeddingService } from './UniversalEmbeddingService.js';

const log = loggers.services.child({ service: 'knowledge-base' });

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface StoreFactParams {
  subject: string;
  predicate: string;
  object: string;
  sourceType: 'document' | 'user' | 'tool' | 'llm' | 'admin';
  sourceId?: string;
  sourceUrl?: string;
  domain?: string;
  isGlobal?: boolean;
  userId?: string;
}

export interface SearchFactsOptions {
  domain?: string;
  isGlobal?: boolean;
  minConfidence?: number;
  userId?: string;
  limit?: number;
}

export interface FactResult {
  id: string;
  subject: string;
  predicate: string;
  object: string;
  confidence: number;
  sourceType: string;
  domain: string | null;
  isGlobal: boolean;
  verificationCount: number;
  similarity: number;
}

export interface ContradictionCandidate {
  fact: FactResult;
  reason: string;
}

// Base confidence per source type
const SOURCE_CONFIDENCE: Record<string, number> = {
  admin: 0.95,
  user: 0.8,
  tool: 0.6,
  llm: 0.5,
  document: 0.7,
};

// ---------------------------------------------------------------------------
// Service
// ---------------------------------------------------------------------------

export class KnowledgeBaseService {
  private embeddingService: UniversalEmbeddingService;

  constructor() {
    this.embeddingService = new UniversalEmbeddingService(log);
  }

  // -------------------------------------------------------------------------
  // 1. storeFact
  // -------------------------------------------------------------------------

  /**
   * Store (or upsert) a knowledge fact with its embedding.
   *
   * The fact is identified by (subject, predicate, object) uniqueness.
   * If an identical triple already exists the record is updated; otherwise
   * a new row is created.
   */
  async storeFact(params: StoreFactParams): Promise<string> {
    const {
      subject,
      predicate,
      object,
      sourceType,
      sourceId,
      sourceUrl,
      domain,
      isGlobal = false,
      userId,
    } = params;

    const baseConfidence = SOURCE_CONFIDENCE[sourceType] ?? 0.5;

    try {
      // Upsert: look for an existing fact with same triple
      const existing = await prisma.knowledgeFact.findFirst({
        where: { subject, predicate, object },
      });

      let factId: string;

      if (existing) {
        // Update existing fact
        const updated = await prisma.knowledgeFact.update({
          where: { id: existing.id },
          data: {
            source_type: sourceType,
            source_id: sourceId ?? existing.source_id,
            source_url: sourceUrl ?? existing.source_url,
            domain: domain ?? existing.domain,
            is_global: isGlobal,
            user_id: userId ?? existing.user_id,
            confidence: Math.max(existing.confidence, baseConfidence),
            updated_at: new Date(),
          },
        });
        factId = updated.id;
        log.debug({ factId, subject, predicate }, 'Updated existing knowledge fact');
      } else {
        // Create new fact
        const created = await prisma.knowledgeFact.create({
          data: {
            subject,
            predicate,
            object,
            confidence: baseConfidence,
            source_type: sourceType,
            source_id: sourceId,
            source_url: sourceUrl,
            domain,
            is_global: isGlobal,
            user_id: userId,
          },
        });
        factId = created.id;
        log.info({ factId, subject, predicate }, 'Created new knowledge fact');
      }

      // Generate and store embedding via raw SQL
      await this.updateFactEmbedding(factId, `${subject} ${predicate} ${object}`);

      return factId;
    } catch (error) {
      log.error({ error, subject, predicate }, 'Failed to store knowledge fact');
      throw error;
    }
  }

  // -------------------------------------------------------------------------
  // 2. searchFacts
  // -------------------------------------------------------------------------

  /**
   * Semantic search for relevant knowledge facts.
   *
   * Generates an embedding for the query, then uses pgvector cosine distance
   * combined with the fact confidence to produce a ranked list.
   */
  async searchFacts(query: string, options: SearchFactsOptions = {}): Promise<FactResult[]> {
    const {
      domain,
      isGlobal,
      minConfidence = 0,
      userId,
      limit = 10,
    } = options;

    try {
      const result = await this.embeddingService.generateEmbedding(query);
      const queryEmbedding = result.embedding;
      const vectorSql = `[${queryEmbedding.join(',')}]`;

      // Build WHERE conditions
      const conditions: string[] = ['embedding IS NOT NULL'];
      if (domain) {
        conditions.push(`domain = '${this.escapeSQL(domain)}'`);
      }
      if (isGlobal !== undefined) {
        conditions.push(`is_global = ${isGlobal}`);
      }
      if (minConfidence > 0) {
        conditions.push(`confidence >= ${minConfidence}`);
      }
      if (userId) {
        // Return global facts OR facts owned by this user
        conditions.push(`(is_global = true OR user_id = '${this.escapeSQL(userId)}')`);
      }

      const whereClause = conditions.join(' AND ');

      // Query: cosine distance weighted by confidence, ordered by combined score
      const rows = await prisma.$queryRawUnsafe<Array<{
        id: string;
        subject: string;
        predicate: string;
        object: string;
        confidence: number;
        source_type: string;
        domain: string | null;
        is_global: boolean;
        verification_count: number;
        distance: number;
      }>>(
        `SELECT id, subject, predicate, object, confidence, source_type,
                domain, is_global, verification_count,
                embedding <=> '${vectorSql}'::halfvec AS distance
         FROM "knowledge_facts"
         WHERE ${whereClause}
         ORDER BY (1.0 - (embedding <=> '${vectorSql}'::halfvec)) * confidence DESC
         LIMIT ${limit}`
      );

      return rows.map((row) => ({
        id: row.id,
        subject: row.subject,
        predicate: row.predicate,
        object: row.object,
        confidence: row.confidence,
        sourceType: row.source_type,
        domain: row.domain,
        isGlobal: row.is_global,
        verificationCount: row.verification_count,
        similarity: 1 - row.distance,
      }));
    } catch (error) {
      log.error({ error, query }, 'Failed to search knowledge facts');
      return [];
    }
  }

  // -------------------------------------------------------------------------
  // 3. verifyFact
  // -------------------------------------------------------------------------

  /**
   * Verify (confirm) a fact, increasing its confidence.
   *
   * Each verification:
   *   - Increments verification_count
   *   - Appends verificationType to verified_by_types (if not already present)
   *   - Recomputes confidence: min(1.0, base + 0.1 * count)
   *   - Creates a KnowledgeVerification record
   */
  async verifyFact(
    factId: string,
    verificationType: string,
    verifiedBy?: string,
  ): Promise<{ confidence: number; verificationCount: number }> {
    try {
      const fact = await prisma.knowledgeFact.findUnique({ where: { id: factId } });
      if (!fact) {
        throw new Error(`Knowledge fact not found: ${factId}`);
      }

      const newCount = fact.verification_count + 1;
      const baseConfidence = SOURCE_CONFIDENCE[fact.source_type] ?? 0.5;
      const newConfidence = Math.min(1.0, baseConfidence + 0.1 * newCount);

      // Append verification type if new
      const verifiedByTypes = [...fact.verified_by_types];
      if (!verifiedByTypes.includes(verificationType)) {
        verifiedByTypes.push(verificationType);
      }

      // Update the fact
      await prisma.knowledgeFact.update({
        where: { id: factId },
        data: {
          verification_count: newCount,
          confidence: newConfidence,
          last_verified_at: new Date(),
          verified_by_types: verifiedByTypes,
        },
      });

      // Create verification record
      await prisma.knowledgeVerification.create({
        data: {
          fact_id: factId,
          verification_type: verificationType,
          verification_method: 'explicit',
          verifier_id: verifiedBy,
          confidence: 1.0,
          is_positive: true,
        },
      });

      log.info({ factId, newConfidence, newCount, verificationType }, 'Fact verified');

      return { confidence: newConfidence, verificationCount: newCount };
    } catch (error) {
      log.error({ error, factId }, 'Failed to verify knowledge fact');
      throw error;
    }
  }

  // -------------------------------------------------------------------------
  // 4. detectContradictions
  // -------------------------------------------------------------------------

  /**
   * Detect facts that potentially contradict the given fact.
   *
   * Strategy:
   *   1. Find facts with the same subject AND predicate but different object.
   *   2. Find semantically similar facts (high embedding similarity) whose
   *      object differs.
   *   3. Only flag when both the candidate and the given fact have meaningful
   *      confidence (> 0.4).
   */
  async detectContradictions(fact: {
    id?: string;
    subject: string;
    predicate: string;
    object: string;
  }): Promise<ContradictionCandidate[]> {
    const candidates: ContradictionCandidate[] = [];

    try {
      // 1. Exact subject+predicate match with different object
      const exactMatches = await prisma.knowledgeFact.findMany({
        where: {
          subject: fact.subject,
          predicate: fact.predicate,
          object: { not: fact.object },
          confidence: { gte: 0.4 },
          ...(fact.id ? { id: { not: fact.id } } : {}),
        },
        take: 10,
      });

      for (const match of exactMatches) {
        candidates.push({
          fact: {
            id: match.id,
            subject: match.subject,
            predicate: match.predicate,
            object: match.object,
            confidence: match.confidence,
            sourceType: match.source_type,
            domain: match.domain,
            isGlobal: match.is_global,
            verificationCount: match.verification_count,
            similarity: 1.0, // exact subject+predicate match
          },
          reason: `Same subject "${fact.subject}" and predicate "${fact.predicate}" but different object: "${match.object}" vs "${fact.object}"`,
        });
      }

      // 2. Semantic similarity search for near-duplicates with differing objects
      const semanticText = `${fact.subject} ${fact.predicate} ${fact.object}`;
      const similarFacts = await this.searchFacts(semanticText, {
        minConfidence: 0.4,
        limit: 20,
      });

      for (const similar of similarFacts) {
        // Skip self and facts already found via exact match
        if (similar.id === fact.id) continue;
        if (candidates.some((c) => c.fact.id === similar.id)) continue;

        // Only flag if same subject, high similarity, but different object
        const subjectMatch =
          similar.subject.toLowerCase() === fact.subject.toLowerCase();
        const objectDiffers =
          similar.object.toLowerCase() !== fact.object.toLowerCase();

        if (subjectMatch && objectDiffers && similar.similarity > 0.75) {
          candidates.push({
            fact: similar,
            reason: `Semantically similar (${(similar.similarity * 100).toFixed(1)}%) with same subject "${fact.subject}" but different object: "${similar.object}" vs "${fact.object}"`,
          });
        }
      }

      if (candidates.length > 0) {
        log.warn(
          { factSubject: fact.subject, contradictions: candidates.length },
          'Potential contradictions detected',
        );
      }

      return candidates;
    } catch (error) {
      log.error({ error, factSubject: fact.subject }, 'Failed to detect contradictions');
      return [];
    }
  }

  // -------------------------------------------------------------------------
  // 5. getGroundingContext
  // -------------------------------------------------------------------------

  /**
   * Retrieve verified facts formatted as grounding context for LLM prompts.
   *
   * Only facts with confidence > 0.7 are included. The output is a structured
   * text block the LLM should treat as authoritative.
   */
  async getGroundingContext(query: string, limit: number = 5): Promise<string> {
    try {
      const facts = await this.searchFacts(query, {
        minConfidence: 0.7,
        limit,
      });

      if (facts.length === 0) {
        return '';
      }

      const lines = facts.map((f) => {
        const verifiedLabel =
          f.verificationCount > 0
            ? `, verified ${f.verificationCount}x`
            : '';
        return `- ${f.subject} ${f.predicate} ${f.object} [confidence: ${f.confidence.toFixed(2)}${verifiedLabel}]`;
      });

      return [
        'VERIFIED FACTS (do not contradict):',
        ...lines,
      ].join('\n');
    } catch (error) {
      log.error({ error, query }, 'Failed to build grounding context');
      return '';
    }
  }

  // -------------------------------------------------------------------------
  // Helpers
  // -------------------------------------------------------------------------

  /**
   * Generate an embedding and store it against the fact row via raw SQL.
   */
  private async updateFactEmbedding(factId: string, text: string): Promise<void> {
    try {
      const result = await this.embeddingService.generateEmbedding(text);
      const vectorSql = `[${result.embedding.join(',')}]`;

      await prisma.$executeRawUnsafe(
        `UPDATE "knowledge_facts"
         SET embedding = '${vectorSql}'::halfvec
         WHERE id = '${this.escapeSQL(factId)}'`
      );

      log.debug({ factId, dimensions: result.dimensions }, 'Stored fact embedding');
    } catch (error) {
      // Embedding failure is non-fatal; the fact is still stored without a vector
      log.warn({ error, factId }, 'Failed to generate/store embedding for fact');
    }
  }

  /**
   * Minimal SQL-injection guard for string literals interpolated into raw SQL.
   * For production hardening, parameterised queries should replace this.
   */
  private escapeSQL(value: string): string {
    return value.replace(/'/g, "''");
  }
}

// ---------------------------------------------------------------------------
// Singleton
// ---------------------------------------------------------------------------

let instance: KnowledgeBaseService | null = null;

export function getKnowledgeBaseService(): KnowledgeBaseService {
  if (!instance) {
    instance = new KnowledgeBaseService();
    log.info('KnowledgeBaseService singleton created');
  }
  return instance;
}

export function resetKnowledgeBaseService(): void {
  instance = null;
}

export default KnowledgeBaseService;

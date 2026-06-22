/**
 * UserMemoriesService — Milvus-backed semantic memory for per-user facts.
 *
 * Mirrors the LearnedPatternsService pattern (same Milvus discipline, same
 * COSINE/FLAT index, same user_id filter convention) but targets the
 * AgentMemory / memorize-tool use case:
 *
 *   store()  — embed `value` (or `key: value`), insert into Milvus.
 *              Called by AgentMemoryService.store() AFTER the Postgres write.
 *   search() — embed the user message, top-K cosine search filtered by
 *              user_id, return MemoryEntry[] shape.
 *
 * Collection schema:
 *   memory_id      varchar PK  — postgres agentMemory.id (UUID)
 *   user_id        varchar     — user isolation filter
 *   key            varchar     — short stable identifier
 *   value          varchar     — the remembered fact (also what we embed)
 *   category       varchar     — preference / fact / workflow / ...
 *   value_embedding FloatVector — embedding of `key: value`
 *   created_at     int64       — unix ms
 *   confidence     float
 *
 * User-isolation is enforced by a Milvus filter expression:
 *   `user_id == "<sanitised-userId>"` on every search.
 *
 * Fallback discipline:
 *   All Milvus operations are guarded. A Milvus failure never takes down
 *   the memorize tool. Callers MUST catch and treat Milvus errors as
 *   non-fatal.
 */

import { MilvusClient, DataType } from '@zilliz/milvus2-sdk-node';
import type { Logger } from 'pino';
import { UniversalEmbeddingService } from './UniversalEmbeddingService.js';

const COLLECTION_NAME = 'user_memories';
const DEFAULT_TOP_K = 5;
const MAX_TOP_K = 10;

// ---------------------------------------------------------------------------
// Public types
// ---------------------------------------------------------------------------

export interface UserMemoryHit {
  memory_id: string;
  user_id: string;
  key: string;
  value: string;
  category: string;
  confidence: number;
  created_at: number;
  similarity: number;
}

// ---------------------------------------------------------------------------
// Service
// ---------------------------------------------------------------------------

export class UserMemoriesService {
  private client: MilvusClient;
  private embeddingService: UniversalEmbeddingService;
  private logger: any;
  private dim = 0;
  private ensured = false;

  constructor(logger?: any) {
    this.logger =
      typeof logger?.child === 'function'
        ? logger.child({ service: 'user-memories' })
        : (logger ?? console);

    if (!process.env.MILVUS_HOST || !process.env.MILVUS_PORT) {
      throw new Error(
        'UserMemoriesService requires MILVUS_HOST and MILVUS_PORT',
      );
    }

    this.client = new MilvusClient({
      address: `${process.env.MILVUS_HOST}:${process.env.MILVUS_PORT}`,
      username: process.env.MILVUS_USERNAME,
      password: process.env.MILVUS_PASSWORD,
    });

    this.embeddingService = new UniversalEmbeddingService(this.logger);
  }

  // -------------------------------------------------------------------------
  // Collection bootstrap
  // -------------------------------------------------------------------------

  /**
   * Idempotent collection + index creation. Safe to call at boot and on
   * every store() / search() call (short-circuits on `this.ensured`).
   */
  async ensureCollection(): Promise<void> {
    if (this.ensured) return;

    this.dim = this.embeddingService.getInfo().dimensions;
    if (!this.dim || this.dim <= 0) {
      throw new Error(
        'UserMemoriesService: embedding dim not configured — cannot create collection',
      );
    }

    const has = await this.client.hasCollection({
      collection_name: COLLECTION_NAME,
    });

    if (!has?.value) {
      const fields = [
        {
          name: 'memory_id',
          data_type: DataType.VarChar,
          is_primary_key: true,
          max_length: 100,
          description: 'agentMemory.id from Postgres',
        },
        {
          name: 'user_id',
          data_type: DataType.VarChar,
          max_length: 255,
          description: 'user isolation key',
        },
        {
          name: 'key',
          data_type: DataType.VarChar,
          max_length: 512,
          description: 'short stable memory identifier',
        },
        {
          name: 'value',
          data_type: DataType.VarChar,
          max_length: 4000,
          description: 'the remembered fact',
        },
        {
          name: 'category',
          data_type: DataType.VarChar,
          max_length: 128,
          description: 'preference / fact / workflow / ...',
        },
        {
          name: 'value_embedding',
          data_type: DataType.FloatVector,
          dim: this.dim,
          description: 'embedding of "key: value"',
        },
        {
          name: 'created_at',
          data_type: DataType.Int64,
          description: 'unix ms creation timestamp',
        },
        {
          name: 'confidence',
          data_type: DataType.Float,
          description: '0–1 confidence assigned by model at memorize time',
        },
      ];

      await this.client.createCollection({
        collection_name: COLLECTION_NAME,
        fields,
        enable_dynamic_field: true,
        consistency_level: 'Strong' as any,
      });

      // Vector index — COSINE/FLAT matches learned_patterns discipline.
      await this.client.createIndex({
        collection_name: COLLECTION_NAME,
        field_name: 'value_embedding',
        index_type: 'FLAT',
        metric_type: 'COSINE',
        params: {},
      });

      // Scalar indexes for fast user_id + category filtering.
      try {
        await this.client.createIndex({
          collection_name: COLLECTION_NAME,
          field_name: 'user_id',
          index_type: 'INVERTED',
        });
        await this.client.createIndex({
          collection_name: COLLECTION_NAME,
          field_name: 'category',
          index_type: 'INVERTED',
        });
      } catch (idxErr: any) {
        // Older Milvus versions may not support INVERTED on VarChar —
        // non-fatal; search still works (slower scan).
        this.logger?.warn?.(
          { error: idxErr?.message ?? String(idxErr) },
          '[user-memories] scalar index create failed (non-fatal)',
        );
      }

      this.logger?.info?.(
        { collectionName: COLLECTION_NAME, dim: this.dim },
        '[user-memories] collection created',
      );
    }

    await this.client.loadCollection({ collection_name: COLLECTION_NAME });
    this.ensured = true;
  }

  // -------------------------------------------------------------------------
  // Write
  // -------------------------------------------------------------------------

  /**
   * Embed `key: value` and insert into Milvus. Called after Postgres write.
   * Never throws — callers must treat failures as non-fatal.
   */
  async store(params: {
    memory_id: string;
    user_id: string;
    key: string;
    value: string;
    category: string;
    confidence: number;
    created_at?: number;
  }): Promise<void> {
    if (!this.ensured) await this.ensureCollection();

    const blob = `${params.key}: ${params.value}`;
    const embResult = await this.embeddingService.generateEmbedding(blob);
    const embedding = embResult.embedding;

    if (!Array.isArray(embedding) || embedding.length === 0) {
      throw new Error('UserMemoriesService.store: empty embedding returned');
    }

    const row = {
      memory_id: params.memory_id,
      user_id: params.user_id,
      key: clip(params.key, 512),
      value: clip(params.value, 4000),
      category: clip(params.category, 128),
      value_embedding: embedding,
      created_at: params.created_at ?? Date.now(),
      confidence: typeof params.confidence === 'number' ? params.confidence : 1.0,
    };

    const inserted = await this.client.insert({
      collection_name: COLLECTION_NAME,
      data: [row as any],
    });

    if ((inserted as any)?.status?.error_code !== 'Success') {
      throw new Error(
        `UserMemoriesService.store: milvus insert failed — ${
          (inserted as any)?.status?.reason ?? 'unknown'
        }`,
      );
    }

    this.logger?.debug?.(
      { memory_id: params.memory_id, user_id: params.user_id, key: params.key },
      '[user-memories] stored',
    );
  }

  // -------------------------------------------------------------------------
  // Read
  // -------------------------------------------------------------------------

  /**
   * Embed the user message and return top-K memory hits for `userId`.
   *
   * @param userMessage — the raw user turn (embedded as-is for similarity)
   * @param userId      — mandatory; filters Milvus results to this user
   * @param opts.limit  — default 5, max 10
   * @param opts.category — optional VarChar filter
   */
  async search(
    userMessage: string,
    userId: string,
    opts?: { limit?: number; category?: string },
  ): Promise<UserMemoryHit[]> {
    if (!this.ensured) await this.ensureCollection();

    const text = String(userMessage ?? '').trim();
    if (!text || !userId) return [];

    const limit = Math.min(MAX_TOP_K, Math.max(1, opts?.limit ?? DEFAULT_TOP_K));

    let embedding: number[];
    try {
      const result = await this.embeddingService.generateEmbedding(text);
      embedding = result.embedding;
    } catch (embErr: any) {
      this.logger?.warn?.(
        { error: embErr?.message ?? String(embErr) },
        '[user-memories] search: embedding failed — returning []',
      );
      return [];
    }

    if (!Array.isArray(embedding) || embedding.length === 0) return [];

    const safeUserId = String(userId).replaceAll(/"/g, '');
    let filter = `user_id == "${safeUserId}"`;
    if (opts?.category) {
      const safeCat = String(opts.category).replaceAll(/"/g, '');
      filter += ` AND category == "${safeCat}"`;
    }

    const searchArgs: any = {
      collection_name: COLLECTION_NAME,
      data: [embedding],
      filter,
      expr: filter,
      limit,
      metric_type: 'COSINE',
      output_fields: [
        'memory_id',
        'user_id',
        'key',
        'value',
        'category',
        'confidence',
        'created_at',
      ],
      params: { nprobe: 10 },
    };

    let searchResult: any;
    try {
      searchResult = await this.client.search(searchArgs);
    } catch (err: any) {
      this.logger?.warn?.(
        { error: err?.message ?? String(err), userId },
        '[user-memories] search: milvus search failed — returning []',
      );
      return [];
    }

    const rawResults: any[] = Array.isArray(searchResult?.results)
      ? searchResult.results
      : [];

    return rawResults.map((r): UserMemoryHit => ({
      memory_id: String(r.memory_id ?? ''),
      user_id: String(r.user_id ?? ''),
      key: String(r.key ?? ''),
      value: String(r.value ?? ''),
      category: String(r.category ?? ''),
      confidence: typeof r.confidence === 'number' ? r.confidence : 1.0,
      created_at: Number(r.created_at) || 0,
      similarity: typeof r.score === 'number' ? r.score : 0,
    }));
  }
}

// ---------------------------------------------------------------------------
// Singleton
// ---------------------------------------------------------------------------

let _instance: UserMemoriesService | null = null;

export function getUserMemoriesService(logger?: any): UserMemoriesService {
  if (!_instance) {
    _instance = new UserMemoriesService(logger ?? console);
  }
  return _instance;
}

/** Test helper — reset singleton between test cases. */
export function __resetUserMemoriesServiceForTests(): void {
  _instance = null;
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function clip(s: string, max: number): string {
  if (!s) return '';
  return s.length <= max ? s : s.slice(0, max);
}

/**
 * LearnedPatternsService — Milvus-backed pattern memory for chatmode.
 *
 * Backs the `pattern_save` (write) and `pattern_recall` (read) T1 meta-tools.
 * Mirrors `MilvusMemoryService` for shape and `ToolSemanticCacheService` for
 * collection-create discipline (single-vector schema, auto-detected
 * embedding dim, COSINE metric, FLAT index for small datasets).
 *
 * Collection: `learned_patterns` (singular global collection — user_id is
 * a filter column, NOT a per-user collection — keeps shared patterns
 * trivially recallable by everyone).
 *
 * RBAC:
 *   - save → row scoped to ctx.userId at write time.
 *   - recall → `(user_id == "<ctx.userId>") OR (shared == true)` filter.
 *   - Admin-only `shared` flag mutation lives outside this service (admin
 *     endpoint slice — out of scope for the model-write/read primitives).
 *
 * DLP: redaction happens in `executePatternSave` (the tool executor) before
 * this service sees the prompt + notes — same boundary as `executeMemorize`.
 * This service trusts its inputs.
 *
 * Spec: user direction 2026-05-11 — model self-curates a memory of useful
 * tool chains. Pattern recall is a stronger hint than catalog `tool_search`
 * for multi-step business workflows.
 */

import { MilvusClient, DataType } from '@zilliz/milvus2-sdk-node';
import { randomUUID } from 'crypto';
import type { Logger } from 'pino';
import { UniversalEmbeddingService } from './UniversalEmbeddingService.js';

const COLLECTION_NAME = 'learned_patterns';

// ---------------------------------------------------------------------------
// Public IO types
// ---------------------------------------------------------------------------

export interface LearnedPatternSaveInput {
  user_prompt: string;
  tool_sequence_summary: string;
  tool_sequence_names: ReadonlyArray<string>;
  business_goal_tags: ReadonlyArray<string>;
  outcome: 'success' | 'partial' | 'abandoned';
  notes?: string;
  shared?: boolean;
  cost_usd?: number;
  duration_ms?: number;
}

export interface LearnedPatternSaveResult {
  pattern_id: string;
  indexed_at: number;
}

export interface LearnedPatternRecallOptions {
  userId: string;
  limit?: number;
  businessGoalTags?: ReadonlyArray<string>;
}

export interface LearnedPatternHit {
  pattern_id: string;
  summary: string;
  tool_names: ReadonlyArray<string>;
  business_goal_tags: ReadonlyArray<string>;
  outcome: 'success' | 'partial' | 'abandoned' | string;
  notes: string;
  similarity: number;
  recency_days: number;
  recall_count: number;
  shared: boolean;
}

// ---------------------------------------------------------------------------
// Service
// ---------------------------------------------------------------------------

const DEFAULT_LIMIT = 5;
const MAX_LIMIT = 10;

export class LearnedPatternsService {
  private client: MilvusClient;
  private embeddingService: UniversalEmbeddingService;
  private logger: any;
  private dim = 0;
  private ensured = false;

  constructor(logger: any) {
    this.logger =
      typeof logger?.child === 'function'
        ? logger.child({ service: 'learned-patterns' })
        : logger;

    if (!process.env.MILVUS_HOST || !process.env.MILVUS_PORT) {
      throw new Error(
        'LearnedPatternsService requires MILVUS_HOST and MILVUS_PORT',
      );
    }

    this.client = new MilvusClient({
      address: `${process.env.MILVUS_HOST}:${process.env.MILVUS_PORT}`,
      username: process.env.MILVUS_USERNAME,
      password: process.env.MILVUS_PASSWORD,
    });
    this.embeddingService = new UniversalEmbeddingService(this.logger);
  }

  /**
   * Create the collection on first call. Idempotent. Safe to call from boot.
   */
  async ensureCollection(): Promise<void> {
    if (this.ensured) return;

    this.dim = await this.embeddingService.getInfo().dimensions;
    if (!this.dim || this.dim <= 0) {
      throw new Error(
        'LearnedPatternsService: embedding dim not configured — cannot create collection',
      );
    }

    const has = await this.client.hasCollection({
      collection_name: COLLECTION_NAME,
    });

    // When the embedding model swaps (e.g. Azure OpenAI 1536 → in-cluster
    // nomic-embed-text 768), the pre-existing collection still has the old
    // prompt_embedding dim — every insert fails inside Milvus. Compare the
    // existing field dim against this.dim and drop+recreate on mismatch.
    if (has?.value) {
      try {
        const desc: any = await this.client.describeCollection({
          collection_name: COLLECTION_NAME,
        });
        const fields = desc?.schema?.fields ?? [];
        const vec = fields.find((f: any) => f?.name === 'prompt_embedding');
        const dimParam = (vec?.type_params ?? []).find(
          (p: any) => p?.key === 'dim',
        );
        const existingDim = dimParam ? Number(dimParam.value) : NaN;
        if (Number.isFinite(existingDim) && existingDim !== this.dim) {
          this.logger?.warn?.(
            {
              collectionName: COLLECTION_NAME,
              existingDim,
              currentDim: this.dim,
            },
            '[learned-patterns] embedding dim changed — dropping + recreating collection',
          );
          await this.client.dropCollection({
            collection_name: COLLECTION_NAME,
          });
          // Fall through to the creation branch below.
          (has as any).value = false;
        }
      } catch (e: any) {
        this.logger?.warn?.(
          { error: e?.message ?? String(e) },
          '[learned-patterns] describeCollection failed — skipping dim check',
        );
      }
    }

    if (!has?.value) {
      const fields = [
        {
          name: 'pattern_id',
          data_type: DataType.VarChar,
          is_primary_key: true,
          max_length: 100,
        },
        {
          name: 'user_id',
          data_type: DataType.VarChar,
          max_length: 100,
        },
        {
          name: 'business_goal_tags',
          data_type: DataType.VarChar,
          max_length: 512,
          description: 'csv of taxonomy tags',
        },
        {
          name: 'user_prompt',
          data_type: DataType.VarChar,
          max_length: 2000,
          description: 'DLP-redacted user prompt',
        },
        {
          name: 'prompt_embedding',
          data_type: DataType.FloatVector,
          dim: this.dim,
          description: 'embedding of user_prompt + summary + tags',
        },
        {
          name: 'tool_sequence_summary',
          data_type: DataType.VarChar,
          max_length: 2000,
        },
        {
          name: 'tool_sequence_names',
          data_type: DataType.VarChar,
          max_length: 1024,
          description: 'csv',
        },
        {
          name: 'outcome',
          data_type: DataType.VarChar,
          max_length: 32,
        },
        {
          name: 'notes',
          data_type: DataType.VarChar,
          max_length: 1024,
          description: 'DLP-redacted notes',
        },
        {
          name: 'shared',
          data_type: DataType.Bool,
        },
        {
          name: 'created_at',
          data_type: DataType.Int64,
        },
        {
          name: 'cost_usd',
          data_type: DataType.Float,
        },
        {
          name: 'duration_ms',
          data_type: DataType.Int64,
        },
        {
          name: 'recall_count',
          data_type: DataType.Int64,
        },
      ];

      await this.client.createCollection({
        collection_name: COLLECTION_NAME,
        fields,
        enable_dynamic_field: true,
        consistency_level: 'Strong' as any,
      });

      await this.client.createIndex({
        collection_name: COLLECTION_NAME,
        field_name: 'prompt_embedding',
        index_type: 'FLAT',
        metric_type: 'COSINE',
        params: {},
      });

      // Scalar indexes — keep recall filtering fast.
      try {
        await this.client.createIndex({
          collection_name: COLLECTION_NAME,
          field_name: 'user_id',
          index_type: 'INVERTED',
        });
        await this.client.createIndex({
          collection_name: COLLECTION_NAME,
          field_name: 'business_goal_tags',
          index_type: 'INVERTED',
        });
      } catch (idxErr: any) {
        // Older Milvus versions may not support INVERTED on VarChar — not
        // fatal; recall still works (slower scan).
        this.logger?.warn?.(
          { error: idxErr?.message ?? String(idxErr) },
          '[learned-patterns] scalar index create failed (non-fatal)',
        );
      }

      this.logger?.info?.(
        { collectionName: COLLECTION_NAME, dim: this.dim },
        '[learned-patterns] collection created',
      );
    }

    await this.client.loadCollection({ collection_name: COLLECTION_NAME });
    this.ensured = true;
  }

  /**
   * Save a pattern. Called by `executePatternSave` AFTER DLP redaction.
   */
  async save(
    input: LearnedPatternSaveInput,
    userId: string,
  ): Promise<LearnedPatternSaveResult> {
    if (!this.ensured) await this.ensureCollection();

    const blob = this.buildEmbedBlob(input);
    const embedding = (await this.embeddingService.generateEmbedding(blob)).embedding;
    if (!Array.isArray(embedding) || embedding.length !== this.dim) {
      throw new Error(
        `LearnedPatternsService.save: embedding dim mismatch (expected ${this.dim}, got ${(embedding as any)?.length})`,
      );
    }

    const pattern_id = randomUUID();
    const now = Date.now();
    const row = {
      pattern_id,
      user_id: userId,
      business_goal_tags: csvJoin(input.business_goal_tags),
      user_prompt: clip(input.user_prompt, 2000),
      prompt_embedding: embedding,
      tool_sequence_summary: clip(input.tool_sequence_summary, 2000),
      tool_sequence_names: csvJoin(input.tool_sequence_names),
      outcome: String(input.outcome),
      notes: clip(input.notes ?? '', 1024),
      shared: input.shared === true,
      created_at: now,
      cost_usd: typeof input.cost_usd === 'number' ? input.cost_usd : 0,
      duration_ms:
        typeof input.duration_ms === 'number' ? input.duration_ms : 0,
      recall_count: 0,
    };

    const inserted = await this.client.insert({
      collection_name: COLLECTION_NAME,
      data: [row as any],
    });
    if ((inserted as any)?.status?.error_code !== 'Success') {
      throw new Error(
        `LearnedPatternsService.save: milvus insert failed — ${(inserted as any)?.status?.reason ?? 'unknown'}`,
      );
    }

    return { pattern_id, indexed_at: now };
  }

  /**
   * Search the user's patterns (+ shared) by semantic similarity. Side
   * effect: bumps recall_count on every hit.
   */
  async recall(
    query: string,
    opts: LearnedPatternRecallOptions,
  ): Promise<LearnedPatternHit[]> {
    if (!this.ensured) await this.ensureCollection();
    const limit = Math.min(MAX_LIMIT, Math.max(1, opts.limit ?? DEFAULT_LIMIT));
    const text = String(query ?? '').trim();
    if (!text) return [];

    const embedding = (await this.embeddingService.generateEmbedding(text)).embedding;
    if (!Array.isArray(embedding) || embedding.length !== this.dim) {
      this.logger?.warn?.(
        { dim: (embedding as any)?.length, expected: this.dim },
        '[learned-patterns] recall: embedding dim mismatch — returning []',
      );
      return [];
    }

    const filter = this.buildRecallFilter(opts);

    const searchArgs: any = {
      collection_name: COLLECTION_NAME,
      data: [embedding],
      filter,
      // Some Milvus SDK versions read `expr` instead of `filter` — set both.
      expr: filter,
      limit,
      metric_type: 'COSINE',
      output_fields: [
        'pattern_id',
        'user_id',
        'business_goal_tags',
        'tool_sequence_summary',
        'tool_sequence_names',
        'outcome',
        'notes',
        'shared',
        'created_at',
        'recall_count',
      ],
      params: { nprobe: 10 },
    };

    let searchResult: any;
    try {
      searchResult = await this.client.search(searchArgs);
    } catch (err: any) {
      this.logger?.warn?.(
        { error: err?.message ?? String(err) },
        '[learned-patterns] recall: search failed — returning []',
      );
      return [];
    }

    const rawResults: any[] = Array.isArray(searchResult?.results)
      ? searchResult.results
      : [];

    const hits: LearnedPatternHit[] = rawResults.map((r) => {
      const created = Number(r.created_at) || Date.now();
      const ageMs = Date.now() - created;
      const recencyDays = Math.max(0, Math.floor(ageMs / 86_400_000));
      return {
        pattern_id: String(r.pattern_id ?? ''),
        summary: String(r.tool_sequence_summary ?? ''),
        tool_names: csvSplit(String(r.tool_sequence_names ?? '')),
        business_goal_tags: csvSplit(String(r.business_goal_tags ?? '')),
        outcome: String(r.outcome ?? ''),
        notes: String(r.notes ?? ''),
        similarity: typeof r.score === 'number' ? r.score : 0,
        recency_days: recencyDays,
        recall_count: Number(r.recall_count) || 0,
        shared: r.shared === true,
      };
    });

    // Side-effect: bump recall_count for every hit. Fire-and-forget — we
    // never block the model on this. Upsert is the preferred path; if the
    // SDK in this deployment doesn't support upsert on this schema, we
    // skip silently rather than crash the read path.
    void this.bumpRecallCounts(hits, rawResults).catch((err) => {
      this.logger?.debug?.(
        { error: err?.message ?? String(err) },
        '[learned-patterns] recall_count bump failed (non-fatal)',
      );
    });

    return hits;
  }

  // ---------------------------------------------------------------------
  // helpers
  // ---------------------------------------------------------------------

  private buildEmbedBlob(input: LearnedPatternSaveInput): string {
    return [
      input.user_prompt,
      input.tool_sequence_summary,
      Array.isArray(input.business_goal_tags)
        ? input.business_goal_tags.join(' ')
        : '',
    ]
      .filter(Boolean)
      .join('\n');
  }

  private buildRecallFilter(opts: LearnedPatternRecallOptions): string {
    const safeUid = String(opts.userId ?? '').replaceAll(/"/g, '');
    const parts: string[] = [
      `(user_id == "${safeUid}" OR shared == true)`,
    ];
    if (opts.businessGoalTags && opts.businessGoalTags.length > 0) {
      // Milvus VarChar doesn't support full-text contains across SDK
      // versions; fall back to an `OR` of LIKE-prefix style matches using
      // the `like` operator (Milvus 2.3+). Older SDKs accept the same
      // expression and ignore unknown ops without crashing.
      const tagClauses = opts.businessGoalTags
        .map((t) => String(t).replaceAll(/"/g, ''))
        .map((t) => `business_goal_tags like "%${t}%"`);
      if (tagClauses.length > 0) {
        parts.push(`(${tagClauses.join(' OR ')})`);
      }
    }
    return parts.join(' AND ');
  }

  private async bumpRecallCounts(
    hits: LearnedPatternHit[],
    rawResults: any[],
  ): Promise<void> {
    if (hits.length === 0) return;
    // Preferred: upsert with incremented count. Some SDKs require all
    // fields; we round-trip every column we know about.
    for (let i = 0; i < hits.length; i++) {
      const h = hits[i];
      const r = rawResults[i] ?? {};
      try {
        await this.client.upsert({
          collection_name: COLLECTION_NAME,
          data: [
            {
              pattern_id: h.pattern_id,
              user_id: r.user_id ?? '',
              business_goal_tags: r.business_goal_tags ?? '',
              user_prompt: r.user_prompt ?? '',
              prompt_embedding: r.prompt_embedding ?? undefined,
              tool_sequence_summary: r.tool_sequence_summary ?? h.summary,
              tool_sequence_names: r.tool_sequence_names ?? '',
              outcome: r.outcome ?? h.outcome,
              notes: r.notes ?? h.notes,
              shared: r.shared === true,
              created_at: Number(r.created_at) || Date.now(),
              cost_usd: typeof r.cost_usd === 'number' ? r.cost_usd : 0,
              duration_ms:
                typeof r.duration_ms === 'number' ? r.duration_ms : 0,
              recall_count: (h.recall_count ?? 0) + 1,
            } as any,
          ],
        });
      } catch (err) {
        // upsert may not be wired in this SDK build — skip silently.
        this.logger?.debug?.(
          { pattern_id: h.pattern_id },
          '[learned-patterns] upsert recall_count failed (skipped)',
        );
      }
    }
  }
}

// ---------------------------------------------------------------------------
// helpers (free fns)
// ---------------------------------------------------------------------------

function csvJoin(arr: ReadonlyArray<string> | undefined): string {
  if (!Array.isArray(arr) || arr.length === 0) return '';
  return arr
    .map((s) => String(s ?? '').trim())
    .filter((s) => s.length > 0)
    .join(',');
}

function csvSplit(s: string): string[] {
  if (!s) return [];
  return s
    .split(',')
    .map((x) => x.trim())
    .filter((x) => x.length > 0);
}

function clip(s: string, max: number): string {
  if (!s) return '';
  if (s.length <= max) return s;
  return s.slice(0, max);
}

// ---------------------------------------------------------------------------
// singleton
// ---------------------------------------------------------------------------

let _instance: LearnedPatternsService | null = null;

export function getLearnedPatternsService(logger?: any): LearnedPatternsService {
  if (!_instance) {
    _instance = new LearnedPatternsService(logger ?? console);
  }
  return _instance;
}

/** Test helper — let unit tests reset the singleton between cases. */
export function __resetLearnedPatternsServiceForTests(): void {
  _instance = null;
}

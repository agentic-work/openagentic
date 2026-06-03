/**
 * AgentSemanticSearchService — Milvus-backed agent catalog search.
 *
 * Companion to ToolSemanticCacheService but for the sub-agent catalog.
 * Indexes the platform's built-in agents + DB-managed user agents
 * into a dedicated Milvus collection (`agents`; renamed Phase E.9 on
 * 2026-05-10 from the legacy `mcp_*` prefixed name). The
 * chatmode loop's synthetic `agent_search` meta-tool calls into this
 * service via the openagentic-proxy route → /api/internal/agent-search.
 *
 * Schema mirrors `mcp_tools_cache` with field-level renames:
 *   id (varchar primary)         — Milvus row id (== agent.id)
 *   agent_id (varchar)           — public agent identifier (e.g. "code-reviewer")
 *   name (varchar)               — display name
 *   description (varchar 2048)   — long-form text used for retrieval
 *   role (varchar)               — agent role / category
 *   tools (varchar 1024)         — comma-joined tool whitelist
 *   embedding (FloatVector dim)  — UniversalEmbeddingService output
 *   metadata (JSON)              — open-ended for future fields
 *
 * Reuses UniversalEmbeddingService so the platform's embedding-model
 * choice (Azure / Bedrock / Ollama) flows through automatically.
 *
 * Plan: docs/superpowers/specs/2026-05-02-tool-selection-at-scale-research.md
 */

import { DataType } from '@zilliz/milvus2-sdk-node';
import type { MilvusClient } from '@zilliz/milvus2-sdk-node';
import type { Logger } from 'pino';
import { escapeMilvusFilterValue } from '../utils/milvusFilter.js';

const COLLECTION_NAME = 'agents';

export interface AgentDefinition {
  /** Milvus primary id. Use a stable, unique string (often == agent_id). */
  id: string;
  /** Public agent identifier — what the model passes as Task({subagent_type}). */
  agent_id: string;
  /** Display name. */
  name: string;
  /** Long description used for embedding + retrieval. */
  description: string;
  /** Role / category label. */
  role: string;
  /** Tool whitelist for this agent. */
  tools: string[];
  /** Optional metadata bag. */
  metadata?: Record<string, unknown>;
}

/** Minimal embedding service contract — matches `UniversalEmbeddingService`. */
export interface EmbeddingServiceLike {
  isConfigured(): Promise<boolean>;
  getInfo(): { dimensions: number; model: string };
  generateEmbedding(text: string): Promise<{ embedding: number[]; tokens?: number }>;
}

export interface AgentSemanticSearchServiceOptions {
  milvusClient: MilvusClient;
  embeddingService: EmbeddingServiceLike;
  logger?: Logger;
}

export class AgentSemanticSearchService {
  private readonly client: MilvusClient;
  private readonly embedding: EmbeddingServiceLike;
  private readonly logger: Logger | { info: (...a: any[]) => void; warn: (...a: any[]) => void; error: (...a: any[]) => void; debug: (...a: any[]) => void };
  private _isInitialized = false;
  private dim = 768;

  constructor(opts: AgentSemanticSearchServiceOptions) {
    this.client = opts.milvusClient;
    this.embedding = opts.embeddingService;
    this.logger = (opts.logger ?? {
      info: () => {},
      warn: () => {},
      error: () => {},
      debug: () => {},
    }) as any;
  }

  get isInitialized(): boolean {
    return this._isInitialized;
  }

  /**
   * Ensure the agent collection exists with the right embedding dim,
   * create + index if missing, drop+recreate on dimension mismatch.
   */
  async init(): Promise<void> {
    try {
      this.dim = this.embedding.getInfo().dimensions || 768;

      const has = await this.client.hasCollection({ collection_name: COLLECTION_NAME });
      const exists = !!(has as any).value;

      if (!exists) {
        await this.createCollection();
      } else {
        const info = await this.client.describeCollection({ collection_name: COLLECTION_NAME });
        const embeddingField = (info as any).schema?.fields?.find((f: any) => f.name === 'embedding');
        const existingDim = embeddingField?.dim != null ? Number(embeddingField.dim) : null;
        if (existingDim !== null && existingDim !== this.dim) {
          this.logger.warn?.(
            { existingDim, expected: this.dim, collection: COLLECTION_NAME },
            '[AgentSemanticSearch] dimension mismatch — dropping + recreating',
          );
          await this.client.dropCollection({ collection_name: COLLECTION_NAME });
          await this.createCollection();
        } else {
          await this.client.loadCollection({ collection_name: COLLECTION_NAME });
        }
      }

      this._isInitialized = true;
      this.logger.info?.(
        { collection: COLLECTION_NAME, dim: this.dim },
        '[AgentSemanticSearch] initialized',
      );
    } catch (err: any) {
      this.logger.error?.({ err: err?.message }, '[AgentSemanticSearch] init failed');
      throw err;
    }
  }

  private async createCollection(): Promise<void> {
    const fields = [
      { name: 'id', data_type: DataType.VarChar, is_primary_key: true, max_length: 256 },
      { name: 'agent_id', data_type: DataType.VarChar, max_length: 256 },
      { name: 'name', data_type: DataType.VarChar, max_length: 256 },
      { name: 'description', data_type: DataType.VarChar, max_length: 2048 },
      { name: 'role', data_type: DataType.VarChar, max_length: 256 },
      { name: 'tools', data_type: DataType.VarChar, max_length: 1024 },
      { name: 'embedding', data_type: DataType.FloatVector, dim: this.dim },
      { name: 'metadata', data_type: DataType.JSON },
    ];

    await this.client.createCollection({
      collection_name: COLLECTION_NAME,
      fields,
      enable_dynamic_field: true,
      consistency_level: 'Strong' as any,
    });

    await this.client.createIndex({
      collection_name: COLLECTION_NAME,
      field_name: 'embedding',
      index_type: 'FLAT',
      metric_type: 'COSINE',
      params: {},
    });

    await this.client.loadCollection({ collection_name: COLLECTION_NAME });
  }

  /** Build the embedding payload from an agent def. */
  private static embeddingTextFor(def: AgentDefinition): string {
    const tools = (def.tools ?? []).join(', ');
    return [
      `name: ${def.name}`,
      `role: ${def.role}`,
      `description: ${def.description}`,
      tools ? `tools: ${tools}` : '',
    ]
      .filter(Boolean)
      .join('\n');
  }

  /**
   * Insert/upsert a single agent row. Idempotent — re-running with the
   * same id replaces the previous row.
   */
  async upsertAgent(def: AgentDefinition): Promise<void> {
    if (!this._isInitialized) {
      throw new Error('AgentSemanticSearchService not initialized — call init() first');
    }

    const text = AgentSemanticSearchService.embeddingTextFor(def);
    const { embedding } = await this.embedding.generateEmbedding(text);

    const row = {
      id: def.id,
      agent_id: def.agent_id,
      name: def.name,
      description: def.description,
      role: def.role,
      tools: (def.tools ?? []).join(','),
      embedding,
      metadata: def.metadata ?? {},
    };

    // Prefer `upsert` when the client exposes it; fall back to delete+insert.
    if (typeof (this.client as any).upsert === 'function') {
      try {
        await (this.client as any).upsert({
          collection_name: COLLECTION_NAME,
          fields_data: [row],
        });
        return;
      } catch (err: any) {
        this.logger.warn?.(
          { err: err?.message, id: def.id },
          '[AgentSemanticSearch] upsert failed — falling back to delete+insert',
        );
      }
    }

    try {
      await this.client.delete({
        collection_name: COLLECTION_NAME,
        filter: `id == "${escapeMilvusFilterValue(def.id)}"`,
      });
    } catch {
      // pre-existing-row delete is best-effort
    }
    await this.client.insert({
      collection_name: COLLECTION_NAME,
      fields_data: [row],
    });
  }

  /**
   * Cosine-similarity search over the agent catalog.
   * Returns at most `k` definitions ordered by similarity descending.
   * Failures are degraded to [] (the caller is the chat loop and
   * cannot tolerate a thrown error in a tool_result).
   */
  async search(query: string, k = 5): Promise<AgentDefinition[]> {
    if (!this._isInitialized) {
      this.logger.warn?.('[AgentSemanticSearch] search called before init — returning []');
      return [];
    }

    const limit = Math.max(1, Math.min(50, Math.floor(k)));

    try {
      const { embedding } = await this.embedding.generateEmbedding(query);
      const res = await this.client.search({
        collection_name: COLLECTION_NAME,
        data: [embedding],
        anns_field: 'embedding',
        output_fields: ['id', 'agent_id', 'name', 'description', 'role', 'tools', 'metadata'],
        limit,
        metric_type: 'COSINE',
      } as any);

      const rows: any[] = (res as any).results ?? [];
      const out: AgentDefinition[] = rows.map((row: any) => {
        const tools: string[] = typeof row.tools === 'string' && row.tools.length > 0
          ? row.tools.split(',').map((t: string) => t.trim()).filter(Boolean)
          : Array.isArray(row.tools) ? row.tools : [];
        let metadata: Record<string, unknown> = {};
        if (row.metadata) {
          try {
            metadata = typeof row.metadata === 'string' ? JSON.parse(row.metadata) : row.metadata;
          } catch {
            metadata = {};
          }
        }
        return {
          id: String(row.id),
          agent_id: String(row.agent_id ?? row.id),
          name: String(row.name ?? ''),
          description: String(row.description ?? ''),
          role: String(row.role ?? ''),
          tools,
          metadata,
        };
      });

      return out;
    } catch (err: any) {
      this.logger.error?.(
        { err: err?.message, query },
        '[AgentSemanticSearch] search failed — returning []',
      );
      return [];
    }
  }
}

export const AGENT_COLLECTION_NAME = COLLECTION_NAME;

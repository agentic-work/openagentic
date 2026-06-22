/**
 * ConversationMemoryService — Prisma-backed implementation of the
 * conversationMemory NodeExecutionContext hook used by the
 * `conversation_memory` Flows node (gap-analysis 2026-05-14 P0 #2).
 *
 * Operations:
 *   - read(memoryId, limit) → last N messages (excluding `summary` rows)
 *   - write(memoryId, role, content, metadata) → append + return new total
 *   - clear(memoryId) → delete all rows for memoryId + tenantId
 *   - summarize(memoryId, summaryPrompt) → call Smart Router via the API's
 *     internal LLM endpoint, persist the summary as a special `role:summary`
 *     row, return the summary string.
 *
 * Tenant isolation: every Prisma query filters by tenant_id. A request
 * with tenantId='A' cannot read / write / clear rows owned by 'B'.
 * For NULL-tenant rows (legacy or system), pass `tenantId: undefined`.
 *
 * Storage table: ConversationMemory (prisma/schema.prisma). The model is
 * mirrored in openagentic-api's schema so both Prisma clients can resolve
 * it; `prisma db push` reconciles on next boot.
 */

import axios from 'axios';
import { prisma } from '../utils/prisma.js';

export interface MemoryReadResult {
  messages: Array<{ role: string; content: string; timestamp: string | Date }>;
  count: number;
}

export interface MemoryWriteResult {
  written: boolean;
  total: number;
}

export interface MemoryClearResult {
  cleared: boolean;
  removedCount: number;
}

export interface MemorySummarizeResult {
  summary: string;
  messagesSummarized: number;
}

export interface MemorySearchMatch {
  role: string;
  content: string;
  timestamp: string | Date;
  score: number;
}

export interface MemorySearchResult {
  matches: MemorySearchMatch[];
  count: number;
}

export interface ConversationMemoryServiceDeps {
  apiUrl: string;
  internalAuthHeaders: () => Record<string, string>;
  executionId?: string;
}

export class ConversationMemoryService {
  constructor(private readonly deps: ConversationMemoryServiceDeps) {}

  async read(args: {
    tenantId?: string;
    memoryId: string;
    limit?: number;
  }): Promise<MemoryReadResult> {
    const limit = args.limit && args.limit > 0 ? args.limit : 10;
    const rows = await (prisma as any).conversationMemory.findMany({
      where: {
        memory_id: args.memoryId,
        tenant_id: args.tenantId ?? null,
        role: { not: 'summary' },
      },
      orderBy: { timestamp: 'desc' },
      take: limit,
    });
    // Return in chronological order (oldest first) so LLM consumers can
    // prepend without re-sorting.
    const ordered = rows.reverse();
    return {
      messages: ordered.map((r: any) => ({
        role: r.role,
        content: r.content,
        timestamp: r.timestamp,
      })),
      count: ordered.length,
    };
  }

  async write(args: {
    tenantId?: string;
    memoryId: string;
    role: string;
    content: string;
    metadata?: Record<string, unknown>;
  }): Promise<MemoryWriteResult> {
    // V1.1 vector backend: best-effort embed-on-write. If embedding fails
    // (api down, no provider configured), still persist the message — the
    // row just won't show up in subsequent semantic searches.
    let embedding: number[] | undefined;
    try {
      embedding = await this.embedText(args.content);
    } catch (err: any) {
      embedding = undefined;
    }

    const metadata: Record<string, unknown> | undefined =
      args.metadata || embedding
        ? { ...(args.metadata ?? {}), ...(embedding ? { embedding } : {}) }
        : undefined;

    await (prisma as any).conversationMemory.create({
      data: {
        memory_id: args.memoryId,
        tenant_id: args.tenantId ?? null,
        role: args.role,
        content: args.content,
        metadata,
      },
    });
    const total = await (prisma as any).conversationMemory.count({
      where: {
        memory_id: args.memoryId,
        tenant_id: args.tenantId ?? null,
        role: { not: 'summary' },
      },
    });
    return { written: true, total };
  }

  /**
   * V1.1 vector backend: semantic top-K retrieval. Embeds the query via
   * the platform's UniversalEmbeddingService and ranks prior messages by
   * cosine similarity. Rows missing `metadata.embedding` (e.g. legacy
   * pre-V1.1 messages, or writes where embedding failed) are excluded.
   *
   * Failures (embedding API down) return an empty result rather than
   * throwing — search should degrade gracefully.
   */
  async search(args: {
    tenantId?: string;
    memoryId: string;
    query: string;
    limit: number;
  }): Promise<MemorySearchResult> {
    let queryEmbedding: number[];
    try {
      queryEmbedding = await this.embedText(args.query);
    } catch (err: any) {
      return { matches: [], count: 0 };
    }

    const rows = await (prisma as any).conversationMemory.findMany({
      where: {
        memory_id: args.memoryId,
        tenant_id: args.tenantId ?? null,
        role: { not: 'summary' },
      },
      orderBy: { timestamp: 'desc' },
      take: 500,
    });

    const scored: MemorySearchMatch[] = [];
    for (const r of rows) {
      const embed = (r.metadata as { embedding?: number[] } | null | undefined)?.embedding;
      if (!Array.isArray(embed) || embed.length === 0) continue;
      const score = cosineSimilarity(queryEmbedding, embed);
      scored.push({
        role: r.role,
        content: r.content,
        timestamp: r.timestamp,
        score,
      });
    }
    scored.sort((a, b) => b.score - a.score);
    const matches = scored.slice(0, Math.max(1, args.limit));
    return { matches, count: matches.length };
  }

  /**
   * Call the platform's OpenAI-compatible embeddings endpoint via the
   * internal service auth headers. Throws on failure — callers decide
   * whether to swallow.
   */
  private async embedText(text: string): Promise<number[]> {
    const url = `${this.deps.apiUrl}/api/embeddings`;
    const resp = await axios.post(
      url,
      { input: text },
      {
        headers: {
          'Content-Type': 'application/json',
          ...this.deps.internalAuthHeaders(),
        },
        timeout: 15_000,
      },
    );
    const embedding = resp.data?.data?.[0]?.embedding;
    if (!Array.isArray(embedding) || embedding.length === 0) {
      throw new Error('embeddings endpoint returned no embedding');
    }
    return embedding;
  }

  async clear(args: { tenantId?: string; memoryId: string }): Promise<MemoryClearResult> {
    const r = await (prisma as any).conversationMemory.deleteMany({
      where: {
        memory_id: args.memoryId,
        tenant_id: args.tenantId ?? null,
      },
    });
    return { cleared: true, removedCount: r.count ?? 0 };
  }

  async summarize(args: {
    tenantId?: string;
    memoryId: string;
    summarizerModel?: string;
    summaryPrompt?: string;
  }): Promise<MemorySummarizeResult> {
    const { messages, count } = await this.read({
      tenantId: args.tenantId,
      memoryId: args.memoryId,
      limit: 100,
    });
    if (count === 0) {
      return { summary: '', messagesSummarized: 0 };
    }
    const promptHeader =
      args.summaryPrompt && args.summaryPrompt.trim()
        ? args.summaryPrompt.trim()
        : 'Concisely summarize the following conversation. Capture the user intent, key facts established, and any open questions.';
    const conversationText = messages
      .map((m) => `${m.role.toUpperCase()}: ${m.content}`)
      .join('\n');
    const model = args.summarizerModel && args.summarizerModel !== '' ? args.summarizerModel : 'auto';

    // Call the platform's OpenAI-compatible chat endpoint via internal auth.
    // No hardcoded model literals here — `auto` lets Smart Router pick.
    const url = `${this.deps.apiUrl}/v1/chat/completions`;
    const resp = await axios.post(
      url,
      {
        model,
        messages: [
          { role: 'system', content: promptHeader },
          { role: 'user', content: conversationText },
        ],
        max_tokens: 400,
        temperature: 0.2,
      },
      {
        headers: {
          'Content-Type': 'application/json',
          ...this.deps.internalAuthHeaders(),
        },
        timeout: 30_000,
      },
    );
    const summary: string =
      resp.data?.choices?.[0]?.message?.content?.toString().trim() ?? '';

    if (summary) {
      // Replace prior summary row(s) atomically — keep just the latest.
      await (prisma as any).conversationMemory.deleteMany({
        where: {
          memory_id: args.memoryId,
          tenant_id: args.tenantId ?? null,
          role: 'summary',
        },
      });
      await (prisma as any).conversationMemory.create({
        data: {
          memory_id: args.memoryId,
          tenant_id: args.tenantId ?? null,
          role: 'summary',
          content: summary,
          metadata: {
            summarizerModel: model,
            messagesSummarized: count,
            executionId: this.deps.executionId,
          },
        },
      });
    }

    return { summary, messagesSummarized: count };
  }
}

function cosineSimilarity(a: number[], b: number[]): number {
  if (a.length !== b.length || a.length === 0) return 0;
  let dot = 0;
  let na = 0;
  let nb = 0;
  for (let i = 0; i < a.length; i++) {
    dot += a[i] * b[i];
    na += a[i] * a[i];
    nb += b[i] * b[i];
  }
  if (na === 0 || nb === 0) return 0;
  return dot / (Math.sqrt(na) * Math.sqrt(nb));
}

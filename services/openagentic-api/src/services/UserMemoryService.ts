/**
 * UserMemoryService — Unified memory read/write for adaptive user context.
 *
 * Read path (getContext): sync, <100ms target
 *   Redis cache → Milvus semantic search → PG recency → merge + dedupe → trim to token budget
 *
 * Write path (ingest): async fire-and-forget
 *   PG insert → Milvus embed + upsert → Redis invalidate
 *
 * Compaction: background job, clusters entries by topic, LLM-summarizes, prunes to ≤50/user
 */

import { PrismaClient } from '@prisma/client';
import { Logger } from 'pino';
import { RedisClientType } from 'redis';
import * as crypto from 'crypto';
import { getProviderManager } from './llm-providers/ProviderManager.js';

// Singleton
let _instance: UserMemoryService | null = null;

export function getUserMemoryService(): UserMemoryService {
  if (!_instance) throw new Error('UserMemoryService not initialized — call initUserMemoryService() first');
  return _instance;
}

export function initUserMemoryService(
  prisma: PrismaClient,
  redis: RedisClientType | null,
  logger: Logger,
  milvusService?: any,
  embeddingService?: any,
): UserMemoryService {
  _instance = new UserMemoryService(prisma, redis, logger, milvusService, embeddingService);
  return _instance;
}

interface MemoryEntry {
  id: string;
  source: string;
  content: string;
  importance: number;
  created_at: Date;
  topics: string[];
  score?: number; // computed relevance
}

const TOKEN_BUDGETS: Record<string, number> = {
  '200000': 1500,
  '128000': 1000,
  '32000': 500,
  '4000': 200,
};

function getDefaultTokenBudget(contextWindow?: number): number {
  if (!contextWindow) return 1000;
  // Find closest match
  const sizes = Object.keys(TOKEN_BUDGETS).map(Number).sort((a, b) => b - a);
  for (const size of sizes) {
    if (contextWindow >= size) return TOKEN_BUDGETS[String(size)];
  }
  return 200;
}

function estimateTokens(text: string): number {
  return Math.ceil(text.length / 4);
}

function hashQuery(query: string): string {
  return crypto.createHash('md5').update(query).digest('hex').substring(0, 16);
}

export class UserMemoryService {
  constructor(
    private prisma: PrismaClient,
    private redis: RedisClientType | null,
    private logger: Logger,
    private milvusService?: any,
    private embeddingService?: any,
  ) {
    this.logger = logger.child({ service: 'UserMemoryService' });
  }

  /**
   * SYNC READ PATH — must complete before completion stage
   * Returns a formatted markdown block for system prompt injection.
   */
  async getContext(userId: string, query: string, tokenBudget?: number): Promise<string> {
    const budget = tokenBudget || 1000;
    // Reserve up to 40% of budget for always-inject (durable identifier
    // mappings); cap at 400 tokens absolute. Semantic retrieval fills the
    // rest. See sprightly-percolating-brook plan, Project A.3.
    const alwaysBudget = Math.min(400, Math.floor(budget * 0.4));
    const semanticBudget = budget - alwaysBudget;
    const startTime = Date.now();

    try {
      // 1. Check Redis cache
      const cacheKey = `umem:${userId}:ctx:${hashQuery(query)}`;
      if (this.redis) {
        try {
          const cached = await this.redis.get(cacheKey);
          if (cached) {
            this.logger.debug({ userId, cacheHit: true, ms: Date.now() - startTime }, 'Memory context from cache');
            return cached;
          }
        } catch { /* cache miss, continue */ }
      }

      // 2. Fetch ALWAYS-INJECT memories first — these bypass semantic
      // scoring and are rendered verbatim. Durable identifier mappings
      // the LLM must see every turn regardless of topic similarity.
      // Query is cheap (indexed on user_id+injection_mode).
      const alwaysEntries: Array<{ id: string; content: string; importance: number; created_at: Date; source: string }> = [];
      try {
        const rows = await (this.prisma as any).userMemoryEntry.findMany({
          where: { user_id: userId, injection_mode: 'always' },
          orderBy: { importance: 'desc' },
          take: 20, // hard cap — more than this and the user is misusing the mode
          select: {
            id: true,
            content: true,
            importance: true,
            created_at: true,
            source: true,
          },
        });
        for (const r of rows) alwaysEntries.push(r);
      } catch (err: any) {
        this.logger.warn({ error: err.message }, 'Always-inject memory lookup failed');
      }

      // 3. Gather semantic + recency entries from multiple sources (existing flow)
      const entries: MemoryEntry[] = [];

      // 2a. Milvus semantic search (if available)
      if (this.milvusService && this.embeddingService && query.length > 10) {
        try {
          const collectionName = `umem_${userId.replace(/-/g, '_')}`;
          const hasCollection = await this.milvusService.hasCollection({ collection_name: collectionName }).catch(() => false);

          if (hasCollection) {
            const embedding = await this.embeddingService.embed(query);
            if (embedding) {
              const results = await this.milvusService.search({
                collection_name: collectionName,
                vector: embedding,
                limit: 5,
                output_fields: ['entry_id', 'content', 'source', 'importance', 'created_at'],
              });
              if (results?.results) {
                for (const r of results.results) {
                  if (r.score > 0.3) {
                    entries.push({
                      id: r.entry_id || r.id,
                      source: r.source || 'semantic',
                      content: r.content || '',
                      importance: r.importance || 0.5,
                      created_at: new Date(r.created_at || Date.now()),
                      topics: [],
                      score: r.score,
                    });
                  }
                }
              }
            }
          }
        } catch (err: any) {
          this.logger.debug({ error: err.message }, 'Milvus search skipped');
        }
      }

      // 3b. PG recency-based entries — exclude always-inject rows since
      // those were already fetched in step 2 and will render in their own
      // section.
      try {
        const pgEntries = await (this.prisma as any).userMemoryEntry.findMany({
          where: { user_id: userId, injection_mode: 'semantic' },
          orderBy: { created_at: 'desc' },
          take: 10,
          select: {
            id: true,
            source: true,
            content: true,
            importance: true,
            created_at: true,
            topics: true,
          },
        });

        for (const e of pgEntries) {
          // Avoid duplicates from Milvus
          if (!entries.find(x => x.id === e.id)) {
            const ageHours = (Date.now() - new Date(e.created_at).getTime()) / 3600000;
            const recencyScore = ageHours < 1 ? 0.9 : ageHours < 24 ? 0.7 : ageHours < 168 ? 0.4 : 0.2;
            entries.push({
              ...e,
              score: 0.3 * (e.importance || 0.5) + 0.2 * recencyScore,
            });
          }
        }
      } catch (err: any) {
        this.logger.warn({ error: err.message }, 'PG memory lookup failed');
      }

      // 3. Score, sort, dedupe
      entries.sort((a, b) => (b.score || 0) - (a.score || 0));

      // 4. Load user profile
      let profileBlock = '';
      try {
        const profile = await this.getUserProfile(userId);
        if (profile?.style_dna) {
          profileBlock = `## About You\n${profile.style_dna}\n\n`;
        } else if (profile) {
          const prefs: string[] = [];
          if (profile.verbosity !== 'balanced') prefs.push(`Communication: ${profile.verbosity}`);
          if (profile.technical_depth !== 'balanced') prefs.push(`Technical depth: ${profile.technical_depth}`);
          if (profile.preferred_format !== 'mixed') prefs.push(`Preferred format: ${profile.preferred_format}`);
          if (profile.preferred_languages.length > 0) prefs.push(`Languages: ${profile.preferred_languages.join(', ')}`);
          if (profile.domain_expertise.length > 0) prefs.push(`Expertise: ${profile.domain_expertise.join(', ')}`);
          if (prefs.length > 0) {
            profileBlock = `## About You\n${prefs.map(p => `- ${p}`).join('\n')}\n\n`;
          }
        }
      } catch { /* no profile yet */ }

      // 5. Format entries
      if (entries.length === 0 && alwaysEntries.length === 0 && !profileBlock) {
        return '';
      }

      const sections: string[] = [];
      if (profileBlock) sections.push(profileBlock);

      // 5a. Persistent context — always-inject memories render first, in
      // their own section, with their own budget. These are durable
      // identifier mappings the LLM must see regardless of the current
      // query's topic. Capped so a runaway "always" tag can't starve the
      // semantic budget.
      if (alwaysEntries.length > 0) {
        const persistentLines: string[] = ['## Persistent Context'];
        let alwaysTokens = estimateTokens(persistentLines[0]);
        for (const e of alwaysEntries) {
          const line = `- ${e.content}`;
          const lineTokens = estimateTokens(line);
          if (alwaysTokens + lineTokens > alwaysBudget) break;
          persistentLines.push(line);
          alwaysTokens += lineTokens;
        }
        if (persistentLines.length > 1) sections.push(persistentLines.join('\n'));
      }

      // 5b. Your Recent Activity — semantic + recency entries, bounded by
      // the remaining (semantic) budget.
      if (entries.length > 0) {
        sections.push('## Your Recent Activity');
        let tokenCount = estimateTokens(profileBlock);
        for (const entry of entries) {
          const line = `- [${entry.source}] ${entry.content}`;
          const lineTokens = estimateTokens(line);
          if (tokenCount + lineTokens > semanticBudget) break;
          sections.push(line);
          tokenCount += lineTokens;
        }
      }

      const result = sections.join('\n');

      // 6. Cache result
      if (this.redis && result) {
        this.redis.set(cacheKey, result, { EX: 60 }).catch(() => {});
      }

      this.logger.info({
        userId,
        entries: entries.length,
        alwaysInject: alwaysEntries.length,
        hasProfile: !!profileBlock,
        ms: Date.now() - startTime,
      }, 'Memory context assembled');

      return result;

    } catch (err: any) {
      this.logger.error({ error: err.message, userId }, 'getContext failed');
      return '';
    }
  }

  /**
   * ASYNC WRITE PATH — fire-and-forget from callers.
   *
   * `injectionMode` controls retrieval behavior:
   *   'semantic' (default) — retrieved by similarity to current query.
   *   'always'             — prepended verbatim to every <user_memory>
   *                          block regardless of current query. Reserve
   *                          for durable identifier mappings.
   *                          See sprightly-percolating-brook plan, Project A.3.
   */
  async ingest(
    userId: string,
    source: string,
    sourceId: string | undefined,
    content: string,
    importance: number = 0.5,
    injectionMode: 'semantic' | 'always' = 'semantic',
    onPersist?: (payload: {
      key: string;
      summary: string;
      scope: 'user' | 'session' | 'shared';
      entryId?: string;
      tokenCount?: number;
    }) => void,
  ): Promise<void> {
    // Skip rules — don't auto-ingest trivial utterances as semantic memory.
    // Always-inject memories bypass these rules since they're explicit.
    if (injectionMode === 'semantic') {
      if (!content || content.length < 30) return;
      const lower = content.toLowerCase();
      if (lower.includes('health check') || lower.startsWith('list ') || lower === 'hi' || lower === 'hello') return;
    } else {
      if (!content) return;
    }

    try {
      // 1. Extract simple topics
      const topics = this.extractTopics(content);

      // 2. Estimate token count
      const tokenCount = estimateTokens(content);

      // 3. Truncate very long content
      const truncated = content.length > 2000 ? content.substring(0, 2000) + '...' : content;

      // 4. Insert into PG
      const entry = await (this.prisma as any).userMemoryEntry.create({
        data: {
          user_id: userId,
          source,
          source_id: sourceId || null,
          content: truncated,
          importance,
          topics,
          token_count: tokenCount,
          injection_mode: injectionMode,
        },
      });

      // 5. Embed + upsert into Milvus (if available)
      if (this.milvusService && this.embeddingService) {
        try {
          const collectionName = `umem_${userId.replace(/-/g, '_')}`;
          await this.ensureMilvusCollection(collectionName);
          const embedding = await this.embeddingService.embed(truncated);
          if (embedding) {
            await this.milvusService.insert({
              collection_name: collectionName,
              data: [{
                entry_id: entry.id,
                embedding,
                content: truncated.substring(0, 2000),
                source,
                importance,
                created_at: Date.now(),
              }],
            });
          }
        } catch (err: any) {
          this.logger.debug({ error: err.message }, 'Milvus ingest skipped');
        }
      }

      // 6. Invalidate Redis cache
      if (this.redis) {
        try {
          // Delete all cached contexts for this user
          const keys = await this.redis.keys(`umem:${userId}:*`);
          if (keys.length > 0) {
            await this.redis.del(keys);
          }
        } catch { /* non-fatal */ }
      }

      this.logger.debug({ userId, source, entryId: entry.id }, 'Memory ingested');

      // Phase H (task #153) — fire onPersist callback so the chat
      // pipeline can emit `memory_write` on the NDJSON wire. The
      // `summary` is the first topic + truncated preview; `key` mirrors
      // the entry id so the UI can dedupe + link back. `scope` maps
      // from source: session-scoped if a sourceId is present, else user.
      try {
        if (onPersist) {
          const summaryPreview = truncated.length > 120
            ? truncated.substring(0, 117) + '...'
            : truncated;
          const scope: 'user' | 'session' | 'shared' =
            sourceId ? 'session' : (source === 'shared' ? 'shared' : 'user');
          onPersist({
            key: entry.id,
            summary: topics.length > 0
              ? `${topics.slice(0, 3).join(', ')}: ${summaryPreview}`
              : summaryPreview,
            scope,
            entryId: entry.id,
            tokenCount,
          });
        }
      } catch {
        // Never break ingest because the emit callback failed.
      }

    } catch (err: any) {
      this.logger.warn({ error: err.message, userId, source }, 'Memory ingest failed');
    }
  }

  /**
   * Get or create user profile
   */
  async getUserProfile(userId: string): Promise<any> {
    try {
      // Check Redis cache
      if (this.redis) {
        const cached = await this.redis.get(`umem:${userId}:profile`).catch(() => null);
        if (cached) return JSON.parse(cached);
      }

      let profile = await (this.prisma as any).userProfile.findUnique({
        where: { user_id: userId },
      });

      if (!profile) {
        profile = await (this.prisma as any).userProfile.create({
          data: { user_id: userId },
        });
      }

      // Cache for 5 minutes
      if (this.redis && profile) {
        this.redis.set(`umem:${userId}:profile`, JSON.stringify(profile), { EX: 300 }).catch(() => {});
      }

      return profile;
    } catch (err: any) {
      this.logger.debug({ error: err.message, userId }, 'getUserProfile failed');
      return null;
    }
  }

  /**
   * Background compaction — cluster entries by topic, summarize, prune
   */
  async compactUserMemories(userId: string): Promise<void> {
    // Acquire lock
    if (this.redis) {
      const locked = await this.redis.set(`umem:${userId}:compact`, '1', { EX: 21600, NX: true }).catch(() => null);
      if (!locked) {
        this.logger.debug({ userId }, 'Compaction already running');
        return;
      }
    }

    try {
      const entries = await (this.prisma as any).userMemoryEntry.findMany({
        where: { user_id: userId, is_summary: false },
        orderBy: { created_at: 'desc' },
      });

      if (entries.length <= 50) return; // No need to compact

      // Group by source for simple compaction
      const bySource = new Map<string, any[]>();
      for (const entry of entries) {
        const key = entry.source;
        if (!bySource.has(key)) bySource.set(key, []);
        bySource.get(key)!.push(entry);
      }

      // For each source with >10 entries, keep the 5 most important + summarize the rest
      for (const [source, sourceEntries] of Array.from(bySource.entries())) {
        if (sourceEntries.length <= 10) continue;

        // Sort by importance desc
        sourceEntries.sort((a: any, b: any) => (b.importance || 0) - (a.importance || 0));

        const keep = sourceEntries.slice(0, 5);
        const toSummarize = sourceEntries.slice(5);

        // LLM-powered summarization (falls back to basic concat if LLM unavailable)
        let summaryEntry: string;
        try {
          const providerManager = getProviderManager();
          if (!providerManager) throw new Error('No providerManager');
          // Use cheapest available model for summarization (~500 tokens per call)
          const rawContent = toSummarize.map((e: any) => `- ${e.content}`).join('\n').substring(0, 3000);
          const summaryResponse = await providerManager.createCompletion({
            model: 'auto',
            messages: [
              { role: 'system', content: 'You are a memory compactor. Summarize the user\'s activity entries into 2-4 concise bullet points. Preserve specific names, numbers, and technical details. Be factual, not generic.' },
              { role: 'user', content: `Summarize these ${toSummarize.length} ${source} entries:\n${rawContent}` },
            ],
            max_tokens: 300,
            temperature: 0.3,
            stream: false,
          }) as any;
          const llmText = (summaryResponse as any)?.choices?.[0]?.message?.content;
          summaryEntry = llmText || `Summary of ${toSummarize.length} ${source} entries: ${toSummarize.map((e: any) => e.content).join(' | ').substring(0, 1500)}`;
        } catch {
          // Fallback: basic concatenation
          summaryEntry = `Summary of ${toSummarize.length} ${source} entries: ${toSummarize.map((e: any) => e.content).join(' | ').substring(0, 1500)}`;
        }

        // Insert summary
        await (this.prisma as any).userMemoryEntry.create({
          data: {
            user_id: userId,
            source,
            content: summaryEntry,
            importance: 0.6,
            topics: Array.from(new Set(toSummarize.flatMap((e: any) => e.topics || []))).slice(0, 10),
            is_summary: true,
            summary_of: toSummarize.map((e: any) => e.id),
          },
        });

        // Delete summarized entries
        await (this.prisma as any).userMemoryEntry.deleteMany({
          where: { id: { in: toSummarize.map((e: any) => e.id) } },
        });
      }

      this.logger.info({ userId, entriesBefore: entries.length }, 'Memory compaction completed');

    } catch (err: any) {
      this.logger.error({ error: err.message, userId }, 'Compaction failed');
    }
  }

  /**
   * GDPR full purge
   */
  async purgeUser(userId: string): Promise<void> {
    await (this.prisma as any).userMemoryEntry.deleteMany({ where: { user_id: userId } });
    await (this.prisma as any).userProfile.deleteMany({ where: { user_id: userId } });

    // Delete Milvus collection
    if (this.milvusService) {
      const collectionName = `umem_${userId.replace(/-/g, '_')}`;
      await this.milvusService.dropCollection({ collection_name: collectionName }).catch(() => {});
    }

    // Clear Redis
    if (this.redis) {
      const keys = await this.redis.keys(`umem:${userId}:*`).catch(() => [] as string[]);
      if (keys.length > 0) await this.redis.del(keys).catch(() => {});
    }

    this.logger.info({ userId }, 'User memory purged');
  }

  // ── Helpers ──────────────────────────────────────────────────────

  private extractTopics(text: string): string[] {
    const words = text.toLowerCase()
      .replace(/[^\w\s]/g, '')
      .split(/\s+/)
      .filter(w => w.length > 4 && !STOP_WORDS.has(w));
    return Array.from(new Set(words)).slice(0, 10);
  }

  private async ensureMilvusCollection(collectionName: string): Promise<void> {
    try {
      const exists = await this.milvusService.hasCollection({ collection_name: collectionName });
      if (exists) return;

      await this.milvusService.createCollection({
        collection_name: collectionName,
        fields: [
          { name: 'entry_id', data_type: 'VarChar', max_length: 36, is_primary_key: true },
          { name: 'embedding', data_type: 'FloatVector', dim: 768 },
          { name: 'content', data_type: 'VarChar', max_length: 2000 },
          { name: 'source', data_type: 'VarChar', max_length: 20 },
          { name: 'importance', data_type: 'Float' },
          { name: 'created_at', data_type: 'Int64' },
        ],
        index_params: [
          { field_name: 'embedding', index_type: 'IVF_FLAT', metric_type: 'COSINE', params: { nlist: 128 } },
        ],
      });
    } catch (err: any) {
      this.logger.debug({ error: err.message, collectionName }, 'ensureMilvusCollection failed');
    }
  }
}

const STOP_WORDS = new Set([
  'about', 'above', 'after', 'again', 'against', 'being', 'below', 'between',
  'could', 'during', 'every', 'further', 'having', 'itself', 'might', 'other',
  'should', 'their', 'there', 'these', 'those', 'through', 'under', 'until',
  'using', 'where', 'which', 'while', 'would', 'yours',
]);

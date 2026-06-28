/**
 * AgentMemoryService - Persistent memory for agents across sessions.
 *
 * Provides store/recall/forget operations that are registered as internal
 * tools the LLM can invoke during chat.
 *
 * Memory.2 (2026-05-19) — dual-write + semantic recall:
 *   store()  — writes Postgres (canonical SoT) then fires-and-forgets a
 *              Milvus embed+insert via UserMemoriesService. Postgres failure
 *              is fatal (throws). Milvus failure is non-fatal (logged only).
 *   recall() — two recall paths:
 *     • opts.userMessage  → semantic top-K via UserMemoriesService.search()
 *                           (new path — fixes "what's my sub id" misses)
 *     • opts.key          → legacy Postgres substring match (preserved for
 *                           backwards compat with memory_recall tool calls
 *                           that pass an explicit key string)
 *     • no opts           → Postgres findMany (unchanged)
 *
 * User isolation is enforced by:
 *   - Milvus: UserMemoriesService.search() passes userId as a Milvus filter
 *     expression (`user_id == "<userId>"`). The service also post-filters
 *     any hits where user_id !== requested userId.
 *   - Postgres: WHERE user_id = userId (unchanged).
 */

import { prisma } from '../utils/prisma.js';

// Lazy import helper — avoids loading Milvus bindings at module parse time
// (same discipline as 06-rag.ts / LearnedPatternsService.ts).
async function getMilvusService() {
  try {
    const { getUserMemoriesService } = await import('./UserMemoriesService.js');
    return getUserMemoriesService();
  } catch {
    return null;
  }
}

export interface MemoryEntry {
  id: string;
  category: string;
  key: string;
  value: string;
  confidence: number;
  ttl_hours: number | null;
  created_at: Date;
  updated_at: Date;
}

export class AgentMemoryService {
  /**
   * Store or update a memory entry for a user.
   *
   * Postgres is the canonical SoT — always written first. Milvus is
   * fire-and-forget: failures are caught and logged but never thrown.
   */
  async store(userId: string, category: string, key: string, value: string, opts?: { confidence?: number; ttlHours?: number }): Promise<MemoryEntry> {
    const existing = await prisma.agentMemory.findFirst({
      where: { user_id: userId, category, key },
    });

    let entry: MemoryEntry;

    if (existing) {
      entry = await prisma.agentMemory.update({
        where: { id: existing.id },
        data: {
          value,
          confidence: opts?.confidence ?? existing.confidence,
          ttl_hours: opts?.ttlHours ?? existing.ttl_hours,
        },
      }) as any;
    } else {
      entry = await prisma.agentMemory.create({
        data: {
          user_id: userId,
          category,
          key,
          value,
          confidence: opts?.confidence ?? 1.0,
          ttl_hours: opts?.ttlHours ?? null,
        },
      }) as any;
    }

    // Milvus dual-write — awaited but non-fatal. We await so that callers
    // (including tests) see a consistent post-store state, but we swallow
    // any Milvus error so Postgres is the canonical SoT and a Milvus outage
    // never breaks the memorize tool.
    try {
      const milvusSvc = await getMilvusService();
      if (milvusSvc) {
        await milvusSvc.store({
          memory_id: entry.id,
          user_id: userId,
          key,
          value,
          category,
          confidence: typeof entry.confidence === 'number' ? entry.confidence : 1.0,
          created_at: entry.created_at instanceof Date
            ? entry.created_at.getTime()
            : Date.now(),
        });
      }
    } catch (milvusErr: any) {
      // Non-fatal — Postgres is the canonical SoT.
      console.debug('[agent-memory] Milvus dual-write failed (non-fatal):', milvusErr?.message ?? String(milvusErr));
    }

    return entry;
  }

  /**
   * Recall memories for a user.
   *
   * Routing:
   *   opts.userMessage → semantic Milvus top-K (primary path for system prompt injection)
   *   opts.key         → Postgres key substring match (legacy tool call path)
   *   (neither)        → Postgres findMany with optional category filter
   */
  async recall(userId: string, opts?: { category?: string; key?: string; userMessage?: string; limit?: number }): Promise<MemoryEntry[]> {
    // ── Semantic path — userMessage embedding + Milvus top-K ───────────────
    if (opts?.userMessage) {
      try {
        const milvusSvc = await getMilvusService();
        if (milvusSvc) {
          const milvusHits = await milvusSvc.search(
            opts.userMessage,
            userId,
            { limit: opts?.limit ?? 5, category: opts?.category },
          );

          // Enforce user isolation: discard any hits where user_id !== userId.
          // UserMemoriesService already applies a Milvus filter expression, but
          // a second post-filter here guarantees isolation against any future
          // Milvus SDK version that ignores filters.
          const safeHits = milvusHits.filter((h) => h.user_id === userId);

          return safeHits.map((h) => ({
            id: h.memory_id,
            category: h.category,
            key: h.key,
            value: h.value,
            confidence: h.confidence,
            ttl_hours: null,
            created_at: new Date(h.created_at || Date.now()),
            updated_at: new Date(h.created_at || Date.now()),
          }));
        }
      } catch (milvusErr: any) {
        // Milvus unreachable — fall through to Postgres token-match fallback below.
        console.debug('[agent-memory] semantic recall failed, falling back to Postgres:', milvusErr?.message ?? String(milvusErr));
      }

      // Postgres fallback: tokenize userMessage and OR-match tokens against
      // key or value (broader than full-message substring — catches "azure"
      // in "what's my Azure subscription?").
      // This path only fires when Milvus is down.
      try {
        await this.cleanExpired(userId);
        const tokens = (opts.userMessage ?? '')
          .toLowerCase()
          .replace(/[^a-z0-9_\s]/g, ' ')
          .split(/\s+/)
          .filter((t) => t.length >= 3); // skip noise words like "is", "my"

        if (tokens.length === 0) return [];

        // Prisma doesn't support OR across columns in a simple way; use raw
        // or per-token queries. We use a simple per-token findMany and dedupe.
        const seen = new Set<string>();
        const results: MemoryEntry[] = [];
        const limit = opts?.limit ?? 5;

        for (const token of tokens.slice(0, 5)) {
          if (results.length >= limit) break;
          const batch = await prisma.agentMemory.findMany({
            where: {
              user_id: userId,
              OR: [
                { key: { contains: token, mode: 'insensitive' } },
                { value: { contains: token, mode: 'insensitive' } },
              ],
            },
            orderBy: [{ confidence: 'desc' }, { updated_at: 'desc' }],
            take: limit,
          }) as any[];

          for (const entry of batch) {
            if (!seen.has(entry.id)) {
              seen.add(entry.id);
              results.push(entry);
            }
          }
        }
        return results.slice(0, limit);
      } catch {
        return [];
      }
    }

    // ── Legacy Postgres path — key substring or plain category filter ───────
    const where: any = { user_id: userId };
    if (opts?.category) where.category = opts.category;
    if (opts?.key) where.key = { contains: opts.key, mode: 'insensitive' };

    // Clean up expired entries
    await this.cleanExpired(userId);

    return await prisma.agentMemory.findMany({
      where,
      orderBy: [{ confidence: 'desc' }, { updated_at: 'desc' }],
      take: opts?.limit ?? 20,
    }) as any[];
  }

  /**
   * Forget a specific memory or all memories matching a filter.
   */
  async forget(userId: string, opts: { id?: string; category?: string; key?: string }): Promise<number> {
    if (opts.id) {
      const mem = await prisma.agentMemory.findFirst({ where: { id: opts.id, user_id: userId } });
      if (!mem) return 0;
      await prisma.agentMemory.delete({ where: { id: opts.id } });
      return 1;
    }

    const where: any = { user_id: userId };
    if (opts.category) where.category = opts.category;
    if (opts.key) where.key = opts.key;

    const result = await prisma.agentMemory.deleteMany({ where });
    return result.count;
  }

  /**
   * Remove expired entries (where ttl_hours is set and time has passed).
   */
  private async cleanExpired(userId: string): Promise<void> {
    try {
      const expired = await prisma.agentMemory.findMany({
        where: {
          user_id: userId,
          ttl_hours: { not: null },
        },
      });

      const now = Date.now();
      const toDelete = expired.filter(m => {
        if (!m.ttl_hours) return false;
        const expiresAt = m.created_at.getTime() + m.ttl_hours * 3600_000;
        return now > expiresAt;
      });

      if (toDelete.length > 0) {
        await prisma.agentMemory.deleteMany({
          where: { id: { in: toDelete.map(m => m.id) } },
        });
      }
    } catch {
      // Non-critical — don't fail recall if cleanup errors
    }
  }
}

// Singleton
let _instance: AgentMemoryService | null = null;
export function getAgentMemoryService(): AgentMemoryService {
  if (!_instance) _instance = new AgentMemoryService();
  return _instance;
}

/**
 * Check if a tool name is a memory tool.
 */
export function isMemoryTool(toolName: string): boolean {
  return ['memory_store', 'memory_recall', 'memory_forget'].includes(toolName);
}

/**
 * Execute a memory tool call. Returns the result string for the LLM.
 */
export async function executeMemoryToolCall(
  toolName: string,
  args: any,
  userId: string,
): Promise<string> {
  const svc = getAgentMemoryService();

  switch (toolName) {
    case 'memory_store': {
      // #63 hardening: scan stored content for prompt-injection patterns and
      // refuse the store if the user is trying to plant a guardrail-bypass.
      // Memories are user-controlled but they get loaded into the prompt
      // assembly path on every future turn, so we treat them as a privileged
      // surface and gate writes accordingly.
      const value = String(args.value || '');
      const injectionRules: Array<{ name: string; re: RegExp }> = [
        { name: 'ignore-instructions', re: /\b(ignore|disregard|forget)\s+(all\s+)?(previous|prior|above|earlier|your)\s+(instructions?|directives?|rules?|guidelines?|prompt)/i },
        { name: 'roleplay-elevation', re: /\b(you are now|act as|pretend to be|roleplay as)\b[^.]{0,80}(admin|root|developer|system|unrestricted|jailbroken|jailbreak|dan)/i },
        { name: 'mode-elevation', re: /\b(developer|admin|root|god|unrestricted|jailbreak|dan)\s+(mode|access|privilege)/i },
        { name: 'guardrail-bypass', re: /\b(bypass|override|disable|remove)\s+(safety|guardrails?|filters?|restrictions?|policies)/i },
        { name: 'system-header-spoof', re: /^\s*#{1,6}\s*(SYSTEM|ASSISTANT|USER|INSTRUCTIONS?)\s*:/im },
      ];
      const flagged = injectionRules.filter(r => r.re.test(value)).map(r => r.name);
      if (flagged.length > 0) {
        return JSON.stringify({
          stored: false,
          rejected: true,
          reason: 'memory content contains prompt-injection patterns and was rejected',
          flagged_patterns: flagged,
          guidance: 'Memories are user-supplied data, not instructions. Rephrase the content as a fact or preference (e.g. "I prefer X" instead of "You must always do X"). If you believe this is a false positive, contact an admin.',
        });
      }
      const entry = await svc.store(
        userId,
        args.category || 'general',
        args.key,
        args.value,
        { confidence: args.confidence, ttlHours: args.ttl_hours },
      );
      return JSON.stringify({ stored: true, id: entry.id, key: entry.key, category: entry.category });
    }

    case 'memory_recall': {
      const memories = await svc.recall(userId, {
        category: args.category,
        key: args.key,
        limit: args.limit,
      });
      if (memories.length === 0) return JSON.stringify({ memories: [], message: 'No memories found matching the query.' });
      return JSON.stringify({
        memories: memories.map(m => ({
          key: m.key,
          value: m.value,
          category: m.category,
          confidence: m.confidence,
          updated_at: m.updated_at,
        })),
      });
    }

    case 'memory_forget': {
      const count = await svc.forget(userId, {
        id: args.id,
        category: args.category,
        key: args.key,
      });
      return JSON.stringify({ forgotten: count });
    }

    default:
      return JSON.stringify({ error: `Unknown memory tool: ${toolName}` });
  }
}

/**
 * Memory tool definitions for injection into the LLM tool list.
 */
export function getMemoryToolDefinitions(): any[] {
  return [
    {
      type: 'function',
      function: {
        name: 'memory_store',
        description: '[Memory] Store a fact, preference, or piece of information the user wants remembered across sessions. Use when the user says "remember...", "note that...", or provides a preference.',
        parameters: {
          type: 'object',
          properties: {
            key: { type: 'string', description: 'Short identifier for the memory (e.g. "preferred_cloud", "project_name")' },
            value: { type: 'string', description: 'The information to remember' },
            category: { type: 'string', description: 'Category: preference, fact, workflow, cloud, project, or general', default: 'general' },
            confidence: { type: 'number', description: 'Confidence level 0-1', default: 1.0 },
            ttl_hours: { type: 'number', description: 'Optional: hours before this memory expires. Omit for permanent.' },
          },
          required: ['key', 'value'],
        },
      },
      _serverId: 'system-memory',
      _serverName: 'system-memory',
    },
    {
      type: 'function',
      function: {
        name: 'memory_recall',
        description: '[Memory] Recall stored memories for the current user. Use when the user asks "what do you remember about...", "what is my preferred...", or when context from previous sessions would help.',
        parameters: {
          type: 'object',
          properties: {
            category: { type: 'string', description: 'Filter by category (preference, fact, workflow, cloud, project, general)' },
            key: { type: 'string', description: 'Search for memories containing this text in the key' },
            limit: { type: 'number', description: 'Max results to return', default: 10 },
          },
        },
      },
      _serverId: 'system-memory',
      _serverName: 'system-memory',
    },
    {
      type: 'function',
      function: {
        name: 'memory_forget',
        description: '[Memory] Remove a stored memory. Use when the user says "forget...", "delete that memory", or "I no longer prefer...".',
        parameters: {
          type: 'object',
          properties: {
            id: { type: 'string', description: 'Specific memory ID to delete' },
            key: { type: 'string', description: 'Delete memories with this exact key' },
            category: { type: 'string', description: 'Delete all memories in this category' },
          },
        },
      },
      _serverId: 'system-memory',
      _serverName: 'system-memory',
    },
  ];
}

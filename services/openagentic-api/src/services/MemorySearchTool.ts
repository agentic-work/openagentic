/**
 * memory_search — meta-tool that queries the user's persistent memory.
 *
 * Companion to MemorizeTool (which writes). Both target the same underlying
 * `agentMemory` table via AgentMemoryService — write/read symmetric so a key
 * the model `memorize`s on turn N can be retrieved by `memory_search` on
 * turn N+1.
 *
 * Spec: docs/superpowers/specs/2026-05-09-v3-enterprise-chatmode-design.md §10
 * Plan: docs/superpowers/plans/2026-05-09-v3-enterprise-chatmode-implementation.md
 *       Phase 9 (Tasks 9.1-9.10)
 *
 * NOTE: AgentMemoryService.recall does substring matching on `key`, scoped
 * to the calling user. For a richer semantic search the future direction is
 * to delegate to MilvusMemoryService.searchUserMemories (which embeds the
 * query). We start with `recall` because it's the same SoT MemorizeTool
 * writes to — single round-trip, no embedding dependency, no Milvus boot
 * requirement on test paths.
 */

export const MEMORY_SEARCH_TOOL_DEF = {
  type: 'function' as const,
  function: {
    name: 'memory_search',
    description:
      'Search the user\'s persistent memory for facts and preferences they previously asked you ' +
      'to remember (via the memorize tool). Use this when a user asks you to recall something, or ' +
      'when prior context (preferred cloud, default region, project name, cost center, runbook ' +
      'name, etc.) would change your answer. Returns the top matching memory entries with key + ' +
      'value + scope. Empty array means no matches — proceed without memory context.',
    parameters: {
      type: 'object',
      properties: {
        query: {
          type: 'string',
          description:
            'Free-text query. Matched against memory keys (substring, case-insensitive). ' +
            'Examples: "preferred_cloud", "project", "default region".',
        },
        category: {
          type: 'string',
          enum: ['session', 'user', 'tenant'],
          description:
            'Optional scope filter. Defaults to no filter (returns all scopes). ' +
            '"session" = current chat only; "user" = this user; "tenant" = entire tenant.',
          nullable: true,
        },
        limit: {
          type: 'integer',
          minimum: 1,
          maximum: 50,
          default: 10,
          description: 'Maximum number of memory entries to return.',
        },
      },
      required: ['query'],
    },
  },
} as const;

export interface MemorySearchInput {
  query: string;
  category?: 'session' | 'user' | 'tenant';
  limit?: number;
}

export interface MemorySearchHit {
  id: string;
  category: string;
  key: string;
  value: string;
  confidence: number;
}

export interface MemorySearchOutput {
  ok: boolean;
  output?: { memories: MemorySearchHit[] };
  error?: string;
}

export interface MemorySearchDeps {
  /** Read-side adapter — production wiring passes AgentMemoryService.recall. */
  recall: (
    userId: string,
    opts?: { category?: string; key?: string; limit?: number },
  ) => Promise<Array<{ id: string; category: string; key: string; value: string; confidence: number }>>;
}

/**
 * Execute the memory_search meta-tool. Returns an empty `memories` array
 * (NOT an error) when no hits — the model treats "no memory" as a normal
 * branch.
 */
export async function executeMemorySearch(
  ctx: { userId?: string; logger?: { warn: (...a: unknown[]) => void } },
  input: MemorySearchInput,
  deps: MemorySearchDeps,
): Promise<MemorySearchOutput> {
  try {
    const userId = ctx.userId ?? 'anonymous';
    const limit = input.limit ?? 10;
    const hits = await deps.recall(userId, {
      category: input.category,
      key: input.query,
      limit,
    });
    return {
      ok: true,
      output: {
        memories: hits.map((h) => ({
          id: h.id,
          category: h.category,
          key: h.key,
          value: h.value,
          confidence: h.confidence,
        })),
      },
    };
  } catch (err: any) {
    ctx.logger?.warn?.({ err: err?.message ?? String(err) }, '[memory_search] recall failed');
    return {
      ok: false,
      error: err?.message ?? String(err),
    };
  }
}

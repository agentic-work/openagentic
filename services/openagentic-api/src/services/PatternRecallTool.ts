/**
 * PatternRecallTool — model-read meta-tool for the learned_patterns memory.
 *
 * Spec: user direction 2026-05-11. Companion to pattern_save. The model
 * invokes pattern_recall BEFORE tool_search on complex multi-step prompts
 * — past patterns are stronger hints than catalog search.
 *
 * Boundary contract:
 *   - Delegates semantic search + RBAC filter + recall_count++ to
 *     LearnedPatternsService.recall.
 *   - Returns top-K (default 5, max 10) hits as a list of structured
 *     pattern hints. Each hint is JUST a hint — model may deviate.
 *   - Auto-approved (LOW risk — read-only).
 *   - Empty result is NOT an error — model treats no-hit as a normal branch.
 *
 * Mirrors MemorySearchTool — same shape, same level of read-side discipline.
 */

import { getLearnedPatternsService } from './LearnedPatternsService.js';

// ---------------------------------------------------------------------------
// Tool schema
// ---------------------------------------------------------------------------

const DESCRIPTION = [
  'Search your long-term pattern memory for similar past requests and',
  'their tool chains. Use BEFORE invoking tool_search for complex',
  'multi-step prompts — past patterns are stronger hints than catalog',
  'search.',
  '',
  'Returns up to 5 patterns by default, ranked by semantic similarity.',
  'Each pattern is a HINT, not a prescription — you may deviate based on',
  'the current context. Patterns are scoped to this user + admin-flagged',
  'shared patterns.',
  '',
  'Use when:',
  '  - User prompt is ambiguous or multi-step ("audit my k8s clusters",',
  '    "compliance check")',
  '  - You are not sure which tool to start with for a business goal',
  '  - The user references something they have done before ("like last',
  '    time")',
  '',
  'Do NOT use when:',
  '  - The prompt has a single obvious tool (e.g. "show me my subs" — just',
  '    call azure_list_subscriptions)',
  '  - You have already recalled patterns this turn',
  '  - The user explicitly asks for a fresh approach',
].join('\n');

export const PATTERN_RECALL_TOOL = {
  type: 'function' as const,
  function: {
    name: 'pattern_recall',
    description: DESCRIPTION,
    parameters: {
      type: 'object' as const,
      properties: {
        query: {
          type: 'string' as const,
          description:
            'The natural language query (usually the user prompt or your reformulation of it).',
        },
        business_goal_tags: {
          type: 'array' as const,
          items: { type: 'string' as const },
          description:
            'Optional filter by taxonomy tags (cost-optimization, security-audit, capacity-planning, compliance, incident-response, inventory, governance, performance-tuning, migration-planning, data-pipeline).',
        },
        limit: {
          type: 'integer' as const,
          minimum: 1,
          maximum: 10,
          default: 5,
          description: 'How many patterns to retrieve. Default 5.',
        },
      },
      required: ['query'] as string[],
      additionalProperties: false as const,
    },
  },
};

export function isPatternRecallTool(name: string): boolean {
  return name === 'pattern_recall';
}

// ---------------------------------------------------------------------------
// IO
// ---------------------------------------------------------------------------

export interface PatternRecallInput {
  query: string;
  business_goal_tags?: ReadonlyArray<string>;
  limit?: number;
}

export interface PatternRecallHit {
  pattern_id: string;
  summary: string;
  tool_names: ReadonlyArray<string>;
  business_goal_tags: ReadonlyArray<string>;
  outcome: string;
  notes: string;
  similarity: number;
  recency_days: number;
  recall_count: number;
  shared: boolean;
}

export interface PatternRecallResult {
  ok: boolean;
  output?: string;
  error?: string;
  patterns?: ReadonlyArray<PatternRecallHit>;
}

export interface PatternRecallCtx {
  userId?: string;
  sessionId?: string;
  logger?: {
    info: (...a: unknown[]) => void;
    warn: (...a: unknown[]) => void;
    error: (...a: unknown[]) => void;
    debug: (...a: unknown[]) => void;
    child?: (...a: unknown[]) => any;
  };
}

// ---------------------------------------------------------------------------
// Handler
// ---------------------------------------------------------------------------

const DEFAULT_LIMIT = 5;
const MIN_LIMIT = 1;
const MAX_LIMIT = 10;

/**
 * Execute pattern_recall. Clamp limit → delegate → translate envelope.
 */
export async function executePatternRecall(
  ctx: PatternRecallCtx,
  input: PatternRecallInput,
): Promise<PatternRecallResult> {
  const query = typeof input?.query === 'string' ? input.query.trim() : '';
  if (!query) {
    // Empty query → return empty list (not an error). Saves a Milvus round-trip.
    return { ok: true, patterns: [], output: 'pattern_recall: no query provided.' };
  }

  const rawLimit =
    typeof input?.limit === 'number' && Number.isFinite(input.limit)
      ? Math.floor(input.limit)
      : DEFAULT_LIMIT;
  const limit = Math.max(MIN_LIMIT, Math.min(MAX_LIMIT, rawLimit));

  const userId = ctx.userId ?? 'anonymous';

  try {
    const svc = getLearnedPatternsService(ctx.logger);
    const hits = await svc.recall(query, {
      userId,
      limit,
      businessGoalTags: input.business_goal_tags,
    });

    ctx.logger?.info?.(
      { query, hitCount: hits.length, userId, limit },
      '[pattern_recall] returned hits',
    );

    return {
      ok: true,
      patterns: hits,
      output: renderResultText(query, hits),
    };
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    ctx.logger?.warn?.({ err: msg }, '[pattern_recall] recall failed');
    return {
      ok: false,
      error: `pattern_recall failed: ${msg}`,
    };
  }
}

function renderResultText(
  query: string,
  hits: ReadonlyArray<PatternRecallHit>,
): string {
  if (hits.length === 0) {
    return `pattern_recall('${query}'): no past patterns matched. Fall through to tool_search.`;
  }
  const lines = hits.map(
    (h, i) =>
      `${i + 1}. [${h.outcome}, similarity=${h.similarity.toFixed(2)}, ${h.recency_days}d ago] ` +
      `${h.summary} — tools: ${h.tool_names.join(', ')}`,
  );
  return (
    `Recalled ${hits.length} pattern${hits.length === 1 ? '' : 's'} matching '${query}':\n\n`
    + lines.join('\n')
    + `\n\nEach pattern is a HINT — adapt to the current request as needed.`
  );
}

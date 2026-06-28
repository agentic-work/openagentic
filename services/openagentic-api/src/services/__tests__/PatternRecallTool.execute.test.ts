/**
 * PatternRecallTool — TDD for the pattern_recall T1 meta-tool.
 *
 * Spec: user direction 2026-05-11.
 *   - Delegates to LearnedPatternsService.recall (semantic search).
 *   - User-scoped (service applies user_id == ctx OR shared filter).
 *   - Filters by business_goal_tags when supplied.
 *   - Returns up to 5 hits by default, 10 max.
 *   - Auto-approved (LOW risk — read-only).
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';

const recallSpy = vi.fn();
const ensureCollectionSpy = vi.fn();
vi.mock('../LearnedPatternsService.js', () => ({
  getLearnedPatternsService: () => ({
    recall: recallSpy,
    ensureCollection: ensureCollectionSpy,
  }),
}));

import {
  PATTERN_RECALL_TOOL,
  isPatternRecallTool,
  executePatternRecall,
  type PatternRecallInput,
} from '../PatternRecallTool.js';

function makeCtx(overrides: Partial<any> = {}) {
  return {
    emit: vi.fn(),
    logger: {
      info: vi.fn(),
      warn: vi.fn(),
      error: vi.fn(),
      debug: vi.fn(),
      child: vi.fn().mockReturnThis(),
    },
    sessionId: 'sess-test',
    userId: 'user-test',
    ...overrides,
  } as any;
}

beforeEach(() => {
  vi.clearAllMocks();
  ensureCollectionSpy.mockResolvedValue(undefined);
  recallSpy.mockResolvedValue([]);
});

describe('PATTERN_RECALL_TOOL — schema shape', () => {
  it('is a valid OpenAI/Anthropic function-tool definition', () => {
    expect(PATTERN_RECALL_TOOL.type).toBe('function');
    expect(PATTERN_RECALL_TOOL.function.name).toBe('pattern_recall');
  });

  it('description has when-to-use / do-not-use rubric (>=200 chars)', () => {
    const desc = PATTERN_RECALL_TOOL.function.description;
    expect(desc.length).toBeGreaterThanOrEqual(200);
    expect(desc).toMatch(/[Uu]se when|USE when/);
    expect(desc).toMatch(/[Dd]o NOT use|DO NOT/);
  });

  it('input schema requires query; allows business_goal_tags + limit', () => {
    const params = PATTERN_RECALL_TOOL.function.parameters as any;
    expect(params.required).toEqual(['query']);
    expect(params.properties.query.type).toBe('string');
    expect(params.properties.business_goal_tags.type).toBe('array');
    expect(params.properties.limit.type).toBe('integer');
    expect(params.properties.limit.minimum).toBe(1);
    expect(params.properties.limit.maximum).toBe(10);
  });
});

describe('isPatternRecallTool — name match', () => {
  it('matches "pattern_recall" exactly', () => {
    expect(isPatternRecallTool('pattern_recall')).toBe(true);
    expect(isPatternRecallTool('PatternRecall')).toBe(false);
    expect(isPatternRecallTool('pattern_save')).toBe(false);
    expect(isPatternRecallTool('memory_search')).toBe(false);
    expect(isPatternRecallTool('')).toBe(false);
  });
});

describe('executePatternRecall — happy path', () => {
  it('returns ok:true with patterns array on hits', async () => {
    recallSpy.mockResolvedValueOnce([
      {
        pattern_id: 'pat-1',
        summary: 'list k8s clusters, get cost, sankey',
        tool_names: ['k8s_list_clusters', 'k8s_get_cost', 'compose_visual'],
        business_goal_tags: ['cost-optimization'],
        outcome: 'success',
        notes: 'worked best namespace-filtered',
        similarity: 0.91,
        recency_days: 3,
        recall_count: 2,
        shared: false,
      },
    ]);
    const ctx = makeCtx();
    const result = await executePatternRecall(ctx, {
      query: 'audit my k8s for cost',
    });
    expect(result.ok).toBe(true);
    expect(result.patterns).toBeDefined();
    expect(result.patterns).toHaveLength(1);
    const p = result.patterns![0];
    expect(p.pattern_id).toBe('pat-1');
    expect(p.tool_names).toContain('compose_visual');
    expect(p.similarity).toBe(0.91);
  });

  it('calls service.recall(query, { userId: ctx.userId, limit, businessGoalTags })', async () => {
    const ctx = makeCtx({ userId: 'user-abc' });
    await executePatternRecall(ctx, {
      query: 'audit my k8s',
      business_goal_tags: ['cost-optimization', 'inventory'],
      limit: 7,
    });
    expect(recallSpy).toHaveBeenCalledTimes(1);
    const [q, opts] = recallSpy.mock.calls[0];
    expect(q).toBe('audit my k8s');
    expect(opts.userId).toBe('user-abc');
    expect(opts.limit).toBe(7);
    expect(opts.businessGoalTags).toEqual(['cost-optimization', 'inventory']);
  });

  it('defaults limit to 5 when not supplied', async () => {
    const ctx = makeCtx();
    await executePatternRecall(ctx, { query: 'x' });
    const [, opts] = recallSpy.mock.calls[0];
    expect(opts.limit).toBe(5);
  });

  it('caps limit at 10', async () => {
    const ctx = makeCtx();
    await executePatternRecall(ctx, { query: 'x', limit: 99 } as any);
    const [, opts] = recallSpy.mock.calls[0];
    expect(opts.limit).toBe(10);
  });

  it('floors limit at 1', async () => {
    const ctx = makeCtx();
    await executePatternRecall(ctx, { query: 'x', limit: 0 } as any);
    const [, opts] = recallSpy.mock.calls[0];
    expect(opts.limit).toBe(1);
  });

  it('returns ok:true with empty patterns when no hits (not an error)', async () => {
    recallSpy.mockResolvedValueOnce([]);
    const ctx = makeCtx();
    const result = await executePatternRecall(ctx, { query: 'no matches' });
    expect(result.ok).toBe(true);
    expect(result.patterns).toEqual([]);
    expect(result.error).toBeUndefined();
  });

  it('does NOT call service when query is empty (returns []) — saves a Milvus round-trip', async () => {
    const ctx = makeCtx();
    const result = await executePatternRecall(ctx, { query: '   ' });
    expect(result.ok).toBe(true);
    expect(result.patterns).toEqual([]);
    expect(recallSpy).not.toHaveBeenCalled();
  });
});

describe('executePatternRecall — error path', () => {
  it('returns ok:false with error when service.recall throws', async () => {
    recallSpy.mockRejectedValueOnce(new Error('milvus search exploded'));
    const ctx = makeCtx();
    const result = await executePatternRecall(ctx, { query: 'x' });
    expect(result.ok).toBe(false);
    expect(result.error).toMatch(/milvus|exploded|recall/i);
  });
});

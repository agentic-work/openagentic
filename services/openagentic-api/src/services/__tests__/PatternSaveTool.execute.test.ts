/**
 * PatternSaveTool — TDD for the pattern_save T1 meta-tool.
 *
 * Spec: user direction 2026-05-11.
 *   - DLP-redacts user_prompt + notes BEFORE the service sees them.
 *   - Calls LearnedPatternsService.save(input, userId).
 *   - Returns `{ ok, output, pattern_id?, indexed_at? }` chat-loop envelope shape.
 *   - Auto-approved (LOW risk) — the dispatch arm asserts this contract.
 *
 * Mirrors MemorizeTool.test.ts patterns:
 *   1. Mock the service singleton getter
 *   2. Mock the DLP scanner factory
 *   3. Assert ordered: validate → DLP → save → return shape
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';

// Mock the LearnedPatternsService singleton so executePatternSave binds to spies.
const saveSpy = vi.fn();
const ensureCollectionSpy = vi.fn();
vi.mock('../LearnedPatternsService.js', () => ({
  getLearnedPatternsService: () => ({
    save: saveSpy,
    ensureCollection: ensureCollectionSpy,
  }),
}));

// Mock the DLP scanner — the tool MUST scan the prompt + notes BEFORE save.
const dlpScanAndActSpy = vi.fn();
vi.mock('../DLPScannerService.js', () => ({
  getDLPScanner: () => ({
    scanAndAct: dlpScanAndActSpy,
  }),
}));

import {
  PATTERN_SAVE_TOOL,
  isPatternSaveTool,
  executePatternSave,
  type PatternSaveInput,
} from '../PatternSaveTool.js';

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

const VALID_INPUT: PatternSaveInput = {
  user_prompt: 'audit my k8s clusters for cost',
  tool_sequence_summary:
    'List clusters, get cost per cluster, render a sankey diagram.',
  tool_sequence_names: ['k8s_list_clusters', 'k8s_get_cost', 'compose_visual'],
  business_goal_tags: ['cost-optimization', 'capacity-planning'],
  outcome: 'success',
  notes: 'gpt-oss:20b retry helped',
};

beforeEach(() => {
  vi.clearAllMocks();
  saveSpy.mockResolvedValue({
    pattern_id: 'pat-uuid-1',
    indexed_at: 1700000000000,
  });
  ensureCollectionSpy.mockResolvedValue(undefined);
  // Default: DLP allows the content unchanged.
  dlpScanAndActSpy.mockImplementation((text: string) => ({
    text,
    blocked: false,
    result: { findings: [], severity: 'low', action: 'allow' },
  }));
});

describe('PATTERN_SAVE_TOOL — schema shape', () => {
  it('is a valid OpenAI/Anthropic function-tool definition', () => {
    expect(PATTERN_SAVE_TOOL.type).toBe('function');
    expect(PATTERN_SAVE_TOOL.function.name).toBe('pattern_save');
  });

  it('description has when-to-use / do-not-use rubric (>=200 chars)', () => {
    const desc = PATTERN_SAVE_TOOL.function.description;
    expect(desc.length).toBeGreaterThanOrEqual(200);
    expect(desc).toMatch(/[Uu]se when/);
    expect(desc).toMatch(/[Dd]o NOT use|[Dd]o not use|DO NOT/);
  });

  it('input schema requires the five core fields', () => {
    const params = PATTERN_SAVE_TOOL.function.parameters as any;
    expect(params.required).toEqual(
      expect.arrayContaining([
        'user_prompt',
        'tool_sequence_summary',
        'tool_sequence_names',
        'business_goal_tags',
        'outcome',
      ]),
    );
    expect(params.properties.outcome.enum).toEqual([
      'success',
      'partial',
      'abandoned',
    ]);
    expect(params.properties.tool_sequence_names.type).toBe('array');
    expect(params.properties.business_goal_tags.type).toBe('array');
  });
});

describe('isPatternSaveTool — name match', () => {
  it('matches "pattern_save" exactly', () => {
    expect(isPatternSaveTool('pattern_save')).toBe(true);
    expect(isPatternSaveTool('PatternSave')).toBe(false);
    expect(isPatternSaveTool('pattern_recall')).toBe(false);
    expect(isPatternSaveTool('')).toBe(false);
  });
});

describe('executePatternSave — happy path', () => {
  it('returns ok:true with pattern_id + indexed_at on success', async () => {
    const ctx = makeCtx();
    const result = await executePatternSave(ctx, VALID_INPUT);
    expect(result.ok).toBe(true);
    expect(result.pattern_id).toBe('pat-uuid-1');
    expect(result.indexed_at).toBe(1700000000000);
    expect(result.output).toMatch(/saved|stored|remembered/i);
  });

  it('calls LearnedPatternsService.save(input, ctx.userId)', async () => {
    const ctx = makeCtx({ userId: 'user-abc' });
    await executePatternSave(ctx, VALID_INPUT);
    expect(saveSpy).toHaveBeenCalledTimes(1);
    const [savedInput, savedUid] = saveSpy.mock.calls[0];
    expect(savedUid).toBe('user-abc');
    expect(savedInput.user_prompt).toBe(VALID_INPUT.user_prompt);
    expect(savedInput.tool_sequence_names).toEqual(VALID_INPUT.tool_sequence_names);
    expect(savedInput.business_goal_tags).toEqual(VALID_INPUT.business_goal_tags);
    expect(savedInput.outcome).toBe('success');
  });

  it('DLP-scans user_prompt AND notes BEFORE saving (correct scanPoint)', async () => {
    const ctx = makeCtx();
    await executePatternSave(ctx, VALID_INPUT);
    // At least 2 scan calls — one for the prompt, one for the notes.
    expect(dlpScanAndActSpy.mock.calls.length).toBeGreaterThanOrEqual(2);
    // Every call must carry a non-empty context with a scanPoint.
    for (const call of dlpScanAndActSpy.mock.calls) {
      const [, scanCtx] = call;
      expect(scanCtx).toBeDefined();
      expect(typeof scanCtx.scanPoint).toBe('string');
    }
  });

  it('uses the DLP-redacted text (not the raw text) when calling save', async () => {
    // DLP returns redacted text — service must see the redacted version.
    dlpScanAndActSpy.mockImplementation((text: string) => ({
      text: text.replace(/k8s/g, '[REDACTED:infrastructure]'),
      blocked: false,
      result: { findings: [], severity: 'medium', action: 'redact' },
    }));
    const ctx = makeCtx();
    await executePatternSave(ctx, VALID_INPUT);
    const [savedInput] = saveSpy.mock.calls[0];
    expect(savedInput.user_prompt).not.toMatch(/k8s/);
    expect(savedInput.user_prompt).toMatch(/REDACTED/);
  });

  it('returns ok:false when DLP blocks the content', async () => {
    dlpScanAndActSpy.mockImplementation((text: string) => ({
      text,
      blocked: true,
      result: { findings: [], severity: 'critical', action: 'block' },
    }));
    const ctx = makeCtx();
    const result = await executePatternSave(ctx, VALID_INPUT);
    expect(result.ok).toBe(false);
    expect(result.error).toMatch(/dlp|blocked|sensitive/i);
    expect(saveSpy).not.toHaveBeenCalled();
  });

  it('defaults shared to false when not supplied', async () => {
    const ctx = makeCtx();
    const noShared = { ...VALID_INPUT };
    delete (noShared as any).shared;
    await executePatternSave(ctx, noShared);
    const [savedInput] = saveSpy.mock.calls[0];
    expect(savedInput.shared).toBe(false);
  });

  it('passes shared:true through when explicitly requested', async () => {
    const ctx = makeCtx();
    await executePatternSave(ctx, { ...VALID_INPUT, shared: true });
    const [savedInput] = saveSpy.mock.calls[0];
    expect(savedInput.shared).toBe(true);
  });
});

describe('executePatternSave — validation', () => {
  it('rejects empty user_prompt', async () => {
    const ctx = makeCtx();
    const result = await executePatternSave(ctx, {
      ...VALID_INPUT,
      user_prompt: '',
    });
    expect(result.ok).toBe(false);
    expect(saveSpy).not.toHaveBeenCalled();
  });

  it('rejects empty tool_sequence_names', async () => {
    const ctx = makeCtx();
    const result = await executePatternSave(ctx, {
      ...VALID_INPUT,
      tool_sequence_names: [],
    });
    expect(result.ok).toBe(false);
    expect(saveSpy).not.toHaveBeenCalled();
  });

  it('rejects invalid outcome', async () => {
    const ctx = makeCtx();
    const result = await executePatternSave(ctx, {
      ...VALID_INPUT,
      outcome: 'bogus' as any,
    });
    expect(result.ok).toBe(false);
    expect(saveSpy).not.toHaveBeenCalled();
  });
});

describe('executePatternSave — error paths', () => {
  it('returns ok:false with error string when save() throws', async () => {
    saveSpy.mockRejectedValueOnce(new Error('milvus connection lost'));
    const ctx = makeCtx();
    const result = await executePatternSave(ctx, VALID_INPUT);
    expect(result.ok).toBe(false);
    expect(result.error).toBeDefined();
    expect(result.error).toMatch(/milvus|connection|save/i);
  });
});

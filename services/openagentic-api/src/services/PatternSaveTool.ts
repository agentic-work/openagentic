/**
 * PatternSaveTool — model-write meta-tool for the learned_patterns memory.
 *
 * Spec: user direction 2026-05-11. Model self-curates a memory of useful
 * multi-step tool chains. Invoked after the model completes a non-trivial
 * workflow that worked well, OR when the user explicitly asks to remember
 * the approach.
 *
 * Boundary contract:
 *   - DLP-scans user_prompt + notes BEFORE the service sees them. Blocks
 *     on `action: 'block'`, redacts on `'redact'`, passes on `'allow'`.
 *   - Validates inputs (non-empty prompt, non-empty tool_sequence_names,
 *     valid outcome enum) before any DLP / save call.
 *   - Delegates persistence to LearnedPatternsService.save (Milvus). NO
 *     embedding logic here — that's the service's job.
 *   - Auto-approved (LOW risk per the upcoming permission tiering). The
 *     dispatcher routes it directly without HITL.
 *   - Returns `{ ok, output, error?, pattern_id?, indexed_at? }` — chat-loop
 *     envelope shape (NOT the Anthropic tool_result shape; the dispatch
 *     boundary translates if needed).
 *
 * Side effects:
 *   - Emits `pattern_saved` NDJSON frame when ctx.emit is wired (UI can
 *     surface a "pattern remembered" pill, mirroring memorize's
 *     "memory_written" pill).
 *
 * Mirrors MemorizeTool / MemorySearchTool patterns — same shape, same
 * level of DLP discipline, same tests structure.
 */

import { getLearnedPatternsService } from './LearnedPatternsService.js';
import { getDLPScanner } from './DLPScannerService.js';
import type { LearnedPatternSaveInput } from './LearnedPatternsService.js';

// ---------------------------------------------------------------------------
// Tool schema
// ---------------------------------------------------------------------------

const OUTCOMES = ['success', 'partial', 'abandoned'] as const;
type Outcome = (typeof OUTCOMES)[number];

const BUSINESS_GOAL_TAXONOMY = [
  'cost-optimization',
  'security-audit',
  'capacity-planning',
  'compliance',
  'incident-response',
  'inventory',
  'governance',
  'performance-tuning',
  'migration-planning',
  'data-pipeline',
];

const DESCRIPTION = [
  'Save a useful tool chain to your long-term pattern memory so future',
  'similar requests can reference it. Invoke after completing a non-trivial',
  'multi-step workflow that worked well, OR when the user explicitly asks',
  'you to remember the approach. Skip trivial 1-step lookups. Patterns are',
  'user-scoped by default (only YOU recall them on future turns for this',
  'user) unless the user requests sharing.',
  '',
  'Use when:',
  '  - You just completed a 3+ step business workflow that succeeded',
  '  - The user said "remember this", "save this workflow", "next time use',
  '    this approach"',
  '  - You orchestrated parallel sub-agents and the synthesis was useful',
  '',
  'Do NOT use when:',
  '  - The chain was a 1-tool lookup (no value in remembering)',
  '  - The chain partially failed (use outcome="partial" if saving anyway)',
  '  - The user asked for one-off help they will not repeat',
  '',
  'Returns: pattern_id and indexed_at on success.',
].join('\n');

export const PATTERN_SAVE_TOOL = {
  type: 'function' as const,
  function: {
    name: 'pattern_save',
    description: DESCRIPTION,
    parameters: {
      type: 'object' as const,
      properties: {
        user_prompt: {
          type: 'string' as const,
          description: 'The original user request, verbatim or near-verbatim.',
        },
        tool_sequence_summary: {
          type: 'string' as const,
          description:
            'One-paragraph summary of WHAT this chain accomplishes — written so a future model can read it and understand whether to recall.',
        },
        tool_sequence_names: {
          type: 'array' as const,
          items: { type: 'string' as const },
          description: 'Ordered list of tool names that were called (no args).',
        },
        business_goal_tags: {
          type: 'array' as const,
          items: { type: 'string' as const },
          description: `Tags from the taxonomy: ${BUSINESS_GOAL_TAXONOMY.join(', ')}.`,
        },
        outcome: {
          type: 'string' as const,
          enum: [...OUTCOMES] as unknown as string[],
          description: 'Honest assessment of how the chain ended.',
        },
        notes: {
          type: 'string' as const,
          description:
            'Caveats, gotchas, what worked well or could be improved next time.',
        },
        shared: {
          type: 'boolean' as const,
          description:
            'Default false (user-only). Set true ONLY if user explicitly requests sharing with team.',
        },
      },
      required: [
        'user_prompt',
        'tool_sequence_summary',
        'tool_sequence_names',
        'business_goal_tags',
        'outcome',
      ] as string[],
      additionalProperties: false as const,
    },
  },
};

export function isPatternSaveTool(name: string): boolean {
  return name === 'pattern_save';
}

// ---------------------------------------------------------------------------
// IO
// ---------------------------------------------------------------------------

export interface PatternSaveInput {
  user_prompt: string;
  tool_sequence_summary: string;
  tool_sequence_names: ReadonlyArray<string>;
  business_goal_tags: ReadonlyArray<string>;
  outcome: Outcome;
  notes?: string;
  shared?: boolean;
  cost_usd?: number;
  duration_ms?: number;
}

export interface PatternSaveResult {
  ok: boolean;
  output?: string;
  error?: string;
  pattern_id?: string;
  indexed_at?: number;
}

export interface PatternSaveCtx {
  userId?: string;
  sessionId?: string;
  emit?: (frameType: string, payload: unknown) => void;
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

/**
 * Execute pattern_save. Validate → DLP-scan → persist → emit frame.
 */
export async function executePatternSave(
  ctx: PatternSaveCtx,
  input: PatternSaveInput,
): Promise<PatternSaveResult> {
  // ──────────────────────────────────────────────────────────────────────
  // Validation
  // ──────────────────────────────────────────────────────────────────────
  if (typeof input?.user_prompt !== 'string' || input.user_prompt.trim().length === 0) {
    return { ok: false, error: 'pattern_save: user_prompt is required and must be non-empty.' };
  }
  if (
    typeof input?.tool_sequence_summary !== 'string'
    || input.tool_sequence_summary.trim().length === 0
  ) {
    return {
      ok: false,
      error: 'pattern_save: tool_sequence_summary is required and must be non-empty.',
    };
  }
  if (
    !Array.isArray(input?.tool_sequence_names)
    || input.tool_sequence_names.length === 0
  ) {
    return {
      ok: false,
      error:
        'pattern_save: tool_sequence_names must be a non-empty array of tool names.',
    };
  }
  if (
    !Array.isArray(input?.business_goal_tags)
    || input.business_goal_tags.length === 0
  ) {
    return {
      ok: false,
      error:
        'pattern_save: business_goal_tags must be a non-empty array of taxonomy tags.',
    };
  }
  if (!OUTCOMES.includes(input.outcome as Outcome)) {
    return {
      ok: false,
      error: `pattern_save: outcome must be one of ${OUTCOMES.join(', ')}.`,
    };
  }

  const userId = ctx.userId ?? 'anonymous';
  const logger = ctx.logger;

  // ──────────────────────────────────────────────────────────────────────
  // DLP — redact prompt + notes BEFORE the service sees them.
  // ──────────────────────────────────────────────────────────────────────
  let dlp: ReturnType<typeof getDLPScanner>;
  try {
    dlp = getDLPScanner(logger as any);
  } catch (err) {
    logger?.warn?.(
      { err: (err as Error)?.message ?? String(err) },
      '[pattern_save] DLPScanner unavailable — continuing without redaction',
    );
    dlp = null as any;
  }

  let safePrompt = input.user_prompt;
  let safeNotes = input.notes ?? '';
  if (dlp && typeof dlp.scanAndAct === 'function') {
    const promptScan = dlp.scanAndAct(input.user_prompt, {
      userId,
      sessionId: ctx.sessionId,
      scanPoint: 'tool_input',
      toolName: 'pattern_save',
    });
    if (promptScan.blocked) {
      logger?.warn?.(
        { findings: promptScan.result?.findings?.length },
        '[pattern_save] DLP blocked user_prompt — refusing save',
      );
      return {
        ok: false,
        error:
          'pattern_save refused: the user_prompt contains sensitive content (DLP block).',
      };
    }
    safePrompt = promptScan.text ?? input.user_prompt;

    if (input.notes && input.notes.length > 0) {
      const notesScan = dlp.scanAndAct(input.notes, {
        userId,
        sessionId: ctx.sessionId,
        scanPoint: 'tool_input',
        toolName: 'pattern_save',
      });
      if (notesScan.blocked) {
        logger?.warn?.(
          { findings: notesScan.result?.findings?.length },
          '[pattern_save] DLP blocked notes — refusing save',
        );
        return {
          ok: false,
          error:
            'pattern_save refused: the notes contain sensitive content (DLP block).',
        };
      }
      safeNotes = notesScan.text ?? input.notes;
    }
  }

  // ──────────────────────────────────────────────────────────────────────
  // Persist via the service
  // ──────────────────────────────────────────────────────────────────────
  try {
    const svc = getLearnedPatternsService(logger);
    const saveInput: LearnedPatternSaveInput = {
      user_prompt: safePrompt,
      tool_sequence_summary: input.tool_sequence_summary,
      tool_sequence_names: input.tool_sequence_names,
      business_goal_tags: input.business_goal_tags,
      outcome: input.outcome,
      notes: safeNotes,
      shared: input.shared === true,
      cost_usd: input.cost_usd,
      duration_ms: input.duration_ms,
    };
    const { pattern_id, indexed_at } = await svc.save(saveInput, userId);

    if (typeof ctx.emit === 'function') {
      try {
        ctx.emit('pattern_saved', {
          pattern_id,
          outcome: input.outcome,
          tool_count: input.tool_sequence_names.length,
          tags: input.business_goal_tags,
          shared: input.shared === true,
          timestamp: new Date(indexed_at).toISOString(),
          session_id: ctx.sessionId ?? null,
        });
      } catch {
        /* emit failures never sink the result */
      }
    }

    logger?.info?.(
      {
        pattern_id,
        outcome: input.outcome,
        toolCount: input.tool_sequence_names.length,
        tags: input.business_goal_tags,
      },
      '[pattern_save] stored',
    );

    return {
      ok: true,
      output: `Saved pattern ${pattern_id} (${input.outcome}, ${input.tool_sequence_names.length} tools).`,
      pattern_id,
      indexed_at,
    };
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    logger?.error?.({ err: msg }, '[pattern_save] persistence failed');
    return {
      ok: false,
      error: `pattern_save failed to persist: ${msg}`,
    };
  }
}

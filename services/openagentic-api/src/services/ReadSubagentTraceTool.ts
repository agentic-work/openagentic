/**
 * ReadSubagentTraceTool — read-side of A2 sub-agent transcript handoff.
 *
 * The Task tool (TaskTool.ts) writes sub-agent transcripts to a TraceStore
 * when configured, surfacing an opaque handle on the TaskResult.
 * ReadSubagentTraceTool is the parent agent's way to fetch that transcript
 * back later — when:
 *   - the sub-agent's summary looks suspicious or contradicts a sibling's
 *   - the parent needs to merge structured findings across N sub-agents
 *   - debugging why one sub-agent diverged from the others
 *
 * Cognition's principle: "share full traces, not just summary messages."
 * The handle indirection keeps token cost off the parent's happy path —
 * the parent only pays the transcript cost when it actually needs to read.
 *
 * Source: https://cognition.ai/blog/dont-build-multi-agents
 */

/**
 * Read-only counterpart to TraceStore. Reads a payload by handle. A
 * production wiring backs this with the same store TaskTool writes to;
 * tests can use an in-memory Map-backed implementation.
 */
export interface TraceReader {
  read(handle: string): Promise<TraceRecord | null>;
}

/**
 * Shape of a stored sub-agent trace payload — mirrors the write contract
 * in TaskTool's TraceStore.store input.
 */
export interface TraceRecord {
  sessionId?: string;
  userId?: string;
  role: string;
  prompt: string;
  output?: string;
  stats: {
    turns: number;
    tokens: number;
    durationMs: number;
    toolsUsed: string[];
  };
  error?: string;
}

export interface ReadSubagentTraceInput {
  /** Opaque handle returned from a prior Task dispatch's TaskResult.trace_handle. */
  trace_handle: string;
  /**
   * Truncate the output to this many characters. The Task transcript can
   * be large; the parent rarely needs the full text on first inspection.
   * 0 or undefined = no truncation.
   */
  max_output_chars?: number;
}

export interface ReadSubagentTraceResult {
  ok: boolean;
  /** The full or truncated transcript. */
  trace?: TraceRecord;
  /** When max_output_chars truncated the output, the original length. */
  output_truncated_from?: number;
  error?: string;
}

export interface ReadSubagentTraceDeps {
  reader: TraceReader;
}

interface ToolContext {
  logger: {
    info: (...args: unknown[]) => void;
    warn: (...args: unknown[]) => void;
    error: (...args: unknown[]) => void;
    debug: (...args: unknown[]) => void;
  };
  sessionId?: string;
  userId?: string;
}

/**
 * Static T1 tool schema for the chat-loop model-facing tool array.
 * Model invokes:
 *   { name: 'read_subagent_trace', input: { trace_handle: '...', max_output_chars?: 8000 } }
 */
export const READ_SUBAGENT_TRACE_TOOL = {
  type: 'function',
  function: {
    name: 'read_subagent_trace',
    description:
      'Fetch the full transcript of a previously-dispatched sub-agent. ' +
      'Use ONLY when the sub-agent summary you received looks inconsistent ' +
      'with a sibling sub-agent, or when you need to debug a failure ' +
      'or merge structured findings. By default Task returns a summary; ' +
      "this tool exists so you DON'T have to pay the full-trace token " +
      'cost on the happy path. Pass the `trace_handle` exactly as it was ' +
      'returned from the prior Task call.',
    parameters: {
      type: 'object',
      required: ['trace_handle'],
      properties: {
        trace_handle: {
          type: 'string',
          description:
            'Opaque handle returned by a prior Task dispatch as ' +
            'TaskResult.trace_handle. Looks like `trace_<random>` or a ' +
            'storage-service resource id.',
        },
        max_output_chars: {
          type: 'number',
          description:
            "Optional truncation cap on the sub-agent's final output " +
            'text. Use 8000 for a first-pass read; omit (or 0) for the ' +
            'full transcript when you need every detail.',
        },
      },
      additionalProperties: false,
    },
  },
} as const;

const ALIAS_NAMES = new Set<string>([
  'read_subagent_trace',
  'readSubagentTrace',
  'ReadSubagentTrace',
]);

export function isReadSubagentTraceTool(name: string): boolean {
  return ALIAS_NAMES.has(name);
}

/**
 * Dispatch — fetch a trace record by handle, optionally truncate output.
 * Returns a structured result; never throws (errors come back on `error`).
 */
export async function executeReadSubagentTrace(
  ctx: ToolContext,
  input: ReadSubagentTraceInput,
  deps: ReadSubagentTraceDeps,
): Promise<ReadSubagentTraceResult> {
  if (typeof input?.trace_handle !== 'string' || input.trace_handle.trim().length === 0) {
    return {
      ok: false,
      error: 'trace_handle is required (non-empty string)',
    };
  }

  let record: TraceRecord | null;
  try {
    record = await deps.reader.read(input.trace_handle);
  } catch (err) {
    const msg = (err as Error).message ?? String(err);
    ctx.logger.warn(
      { trace_handle: input.trace_handle, err: msg },
      '[read_subagent_trace] reader.read threw',
    );
    return { ok: false, error: `reader.read failed: ${msg}` };
  }

  if (!record) {
    return {
      ok: false,
      error: `no trace found for handle '${input.trace_handle}' (expired or never written)`,
    };
  }

  const cap = input.max_output_chars ?? 0;
  if (cap > 0 && record.output && record.output.length > cap) {
    return {
      ok: true,
      trace: {
        ...record,
        output: record.output.slice(0, cap) + '… [truncated]',
      },
      output_truncated_from: record.output.length,
    };
  }

  return { ok: true, trace: record };
}

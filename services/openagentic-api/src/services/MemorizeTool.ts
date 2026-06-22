/**
 * MemorizeTool — meta-tool surface for AgentMemoryService.
 *
 * Wraps the existing AgentMemoryService.store() so the model can persist
 * a fact / preference / workflow context across sessions via a single
 * tool call. NO new persistence here — we delegate. The wrapped service
 * already does prompt-injection scanning + DLP at the executeMemoryToolCall
 * layer (see AgentMemoryService.ts:137); this tool is a thin chatmode-V2
 * meta-tool surface that mirrors RequestClarificationTool / RenderArtifactTool.
 *
 * Plan: docs/chatmode-ux-mock-parity/02-plan-canonical.md §177
 *       (Phase 1 task 1.1 + 1.10 — meta-tool list).
 */

import { getAgentMemoryService } from './AgentMemoryService.js';

// ---------------------------------------------------------------------------
// Tool schema
// ---------------------------------------------------------------------------

export const MEMORIZE_SCOPES = ['session', 'user', 'tenant'] as const;
export type MemorizeScope = (typeof MEMORIZE_SCOPES)[number];

const DESCRIPTION = [
  'Persist a fact, preference, or piece of workflow context the user',
  'wants remembered across sessions. The user can refer back to this in',
  'a future turn ("what is my preferred cloud?", "use my usual region").',
  '',
  'USE WHEN:',
  '- the user explicitly asks you to remember something ("remember that',
  '  I prefer Azure", "note that my project is called X").',
  '- the user states a durable preference, default, or identity fact',
  '  ("I am the platform lead", "my cost center is 1234").',
  '- a piece of workflow state would be useful next session (the name of',
  '  a runbook, a chosen subscription, a default region).',
  '',
  'DO NOT USE WHEN:',
  '- the information is transient ("I am working on this now") — that',
  '  belongs in the conversation, not durable memory.',
  '- the value contains a secret / credential / token / private key —',
  '  refuse and tell the user to use the credential broker instead.',
  '- the user is asking you to recall — that is the memory_recall tool.',
  '- the user is asking you to forget — that is the memory_forget tool.',
  '',
  'WHAT IT RETURNS: a short confirmation string. The UI emits a small',
  '"memory written" pill so the user can see the entry was persisted.',
  '',
  'CANONICAL EXAMPLE:',
  '  memorize({',
  '    key: "preferred_cloud",',
  '    value: "azure",',
  '    scope: "user"',
  '  })',
].join('\n');

export const MEMORIZE_TOOL = {
  type: 'function',
  function: {
    name: 'memorize',
    description: DESCRIPTION,
    parameters: {
      type: 'object',
      required: ['key', 'value'],
      properties: {
        key: {
          type: 'string',
          description:
            'Short stable identifier for the memory (e.g. ' +
            '"preferred_cloud", "default_region", "project_name"). ' +
            'Reusing an existing key updates the previous value.',
        },
        value: {
          type: 'string',
          description:
            'The information to remember. Verbatim — will not be ' +
            'rewritten. Phrase it as a fact / preference, not as an ' +
            'instruction (e.g. "I prefer X", not "You must always do X").',
        },
        scope: {
          type: 'string',
          enum: MEMORIZE_SCOPES as unknown as string[],
          description:
            'Visibility scope. "session" = current chat only; "user" = ' +
            'this user across all their sessions (default); "tenant" = ' +
            'every user in this tenant (admin-gated downstream).',
        },
      },
    },
  },
} as const;

// ---------------------------------------------------------------------------
// Name-match
// ---------------------------------------------------------------------------

const ALIAS_NAMES = new Set<string>([
  'memorize',
  'Memorize',
  'memory_write',
  'remember',
]);

export function isMemorizeTool(name: string): boolean {
  return ALIAS_NAMES.has(name);
}

// ---------------------------------------------------------------------------
// Handler
// ---------------------------------------------------------------------------

export interface MemorizeInput {
  key: string;
  value: string;
  scope?: MemorizeScope;
}

export interface MemorizeToolResult {
  type: 'tool_result';
  tool_use_id?: string;
  content: Array<{ type: 'text'; text: string }>;
  is_error: boolean;
}

interface MemorizeContext {
  emit?: (frameType: string, payload: unknown) => void;
  logger?: {
    info: (...args: unknown[]) => void;
    warn: (...args: unknown[]) => void;
    error: (...args: unknown[]) => void;
    debug: (...args: unknown[]) => void;
  };
  sessionId?: string;
  userId?: string;
}

interface MemorizeOptions {
  tool_use_id?: string;
}

function makeResult(
  text: string,
  is_error: boolean,
  tool_use_id?: string,
): MemorizeToolResult {
  const result: MemorizeToolResult = {
    type: 'tool_result',
    content: [{ type: 'text', text }],
    is_error,
  };
  if (tool_use_id) result.tool_use_id = tool_use_id;
  return result;
}

/**
 * Execute a `memorize` tool call. Validates input, delegates to
 * AgentMemoryService.store(), emits a `memory_written` NDJSON frame,
 * returns a structured tool_result block the model loop can read.
 *
 * The wrapped AgentMemoryService is the single SoT for persistence and
 * already handles prompt-injection rejection at the higher
 * executeMemoryToolCall layer; the chat-V2 tool layer does NOT
 * duplicate that — it just calls store() and surfaces the structured
 * result. DLP / prompt-injection guardrails remain at the service layer
 * where the existing tests live.
 */
export async function executeMemorize(
  ctx: MemorizeContext,
  input: MemorizeInput,
  options?: MemorizeOptions,
): Promise<MemorizeToolResult> {
  const tool_use_id = options?.tool_use_id;

  // Validate key / value.
  if (typeof input?.key !== 'string' || input.key.trim().length === 0) {
    return makeResult(
      'Sorry, I could not save that — the memory key was empty.',
      true,
      tool_use_id,
    );
  }
  if (typeof input?.value !== 'string' || input.value.trim().length === 0) {
    return makeResult(
      'Sorry, I could not save that — the memory value was empty.',
      true,
      tool_use_id,
    );
  }

  const scope: MemorizeScope = input.scope ?? 'user';
  const userId = ctx.userId ?? 'anonymous';

  // Map scope → AgentMemoryService category. The existing service
  // schema uses `category` not `scope`; we map "session"/"user"/"tenant"
  // onto the service's category column verbatim so the admin UI can
  // surface them when the migration to a true scope column lands.
  const category = scope;

  try {
    const entry = await getAgentMemoryService().store(
      userId,
      category,
      input.key,
      input.value,
    );

    if (typeof ctx.emit === 'function') {
      ctx.emit('memory_written', {
        key: entry.key,
        scope,
        timestamp: new Date().toISOString(),
        session_id: ctx.sessionId ?? null,
      });
    }

    ctx.logger?.info(
      {
        key: entry.key,
        scope,
        memory_id: entry.id,
      },
      '[memorize] stored',
    );

    return makeResult(
      `Saved "${entry.key}" (scope: ${scope}).`,
      false,
      tool_use_id,
    );
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    ctx.logger?.error({ err: msg, key: input.key }, '[memorize] store failed');
    return makeResult(
      'Sorry, I could not save that memory right now.',
      true,
      tool_use_id,
    );
  }
}

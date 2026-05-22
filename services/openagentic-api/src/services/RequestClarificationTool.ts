/**
 * RequestClarificationTool — explicit ambiguity-escape for chatmode.
 *
 * Anthropic's tool-writing rubric (and LangChain's agent docs) both
 * recommend a dedicated "ask the user" tool. Without one, models
 * confronted with ambiguous prompts fall back to guessing — the live
 * failure pattern where artifact_creation sub-agent ran 23,927 tokens
 * to confabulate "I don't have azure tools" instead of asking which
 * subscription / which timeframe / which kind of chart.
 *
 * The tool emits a single `request_clarification` NDJSON frame; the UI
 * renders it as an inline question card. The user's response is
 * delivered as the next user message, the model resumes.
 *
 * Plan: docs/chatmode-ux-mock-parity/02-plan-canonical.md
 */

import crypto from 'crypto';

// ---------------------------------------------------------------------------
// Tool schema
// ---------------------------------------------------------------------------

const DESCRIPTION = [
  '**USE THIS BEFORE EMITTING ANY ARTIFACT (compose_app, compose_visual,',
  'render_artifact) when the user\'s intent about output format is ambiguous',
  'or unclear.** Token cost is real — each visual artifact is 1-10K output',
  'tokens. When in doubt about whether the user wants a chart, a dashboard,',
  'or just prose, ASK FIRST. A 30-token clarification question is cheaper',
  'than a 5-10K-token unrequested compose_app the user did not want.',
  '',
  'Sev-0 #928 (2026-05-17): the artifact emission gate in the system prompt',
  'requires this tool BEFORE any compose_app / compose_visual /',
  'render_artifact emission on ambiguous prompts. Ambiguous = "analyze X",',
  '"look at Y", "our bill is up", "review my Azure", "audit my k8s" — any',
  'prompt that does not explicitly name the desired output format (chart /',
  'diagram / matrix / app / dashboard / sankey / graph / plot / render).',
  '',
  'For DESTRUCTIVE operations: use this when proceeding without an answer',
  'would produce a wrong-or-destructive outcome that the user could not',
  'recover from in a follow-up turn (e.g. dropping the wrong database).',
  '',
  'For DATA-SCOPE questions (timeframe, region, subscription, project): if',
  'a sensible default exists, render with defaults and surface the',
  'assumption in prose — do NOT ask. The user can narrow in their next',
  'message. This tool is for OUTPUT-FORMAT and DESTRUCTIVE-SCOPE ambiguity,',
  'NOT for filter-scope defaulting.',
  '',
  'STRONG BIAS — DO NOT USE WHEN:',
  '- a parameter has a sensible default (timeframe → last 6 months;',
  '  scope → all subscriptions / accounts / projects the user has',
  '  access to; grouping → by service; region → all regions).',
  '- the user asked for a SPECIFIC visualization by name (chart, sankey,',
  '  arch_diagram, savings_grid) — that IS the explicit request; emit it.',
  '- you can call a tool to discover the answer (e.g., list',
  '  subscriptions / accounts / projects yourself before asking).',
  '- the question is just "should I proceed?" — proceed.',
  '',
  'HARD-FORBIDDEN — NEVER ASK ABOUT:',
  '- authentication, login, sign-in, SSO, OAuth, OBO, "are you logged in"',
  '- permission, permissions, access, "do you have access to X" — every tool',
  '  already carries the user identity automatically via the platform OBO flow.',
  '- "should I proceed?" / "do you want me to do X?" — JUST DO IT.',
  '- announcing or previewing what you are about to do — execute the tool,',
  '  not the preview of what you will do.',
  '',
  'If a tool returns an auth-error or permission-error, surface that error',
  'verbatim in your prose. NEVER preempt by asking the user.',
  '',
  'USE ONLY WHEN:',
  "- the wrong choice would DELETE / OVERWRITE / IRREVERSIBLY change",
  '  user data (e.g., "drop the prod database" without knowing which db).',
  '- a long sub-agent run would be entirely thrown away if the scope is',
  '  wrong AND no reasonable default exists (rare).',
  '',
  'WHAT IT RETURNS: a `clarification_id`. The UI renders the question;',
  "the user's answer arrives as the next user message and you resume.",
  '',
  'EXAMPLE (good):',
  '  request_clarification({',
  '    question: "You have 3 production databases — which one should I drop?",',
  '    options: [',
  '      { value: "users-db", label: "users-db" },',
  '      { value: "orders-db", label: "orders-db" }',
  '    ]',
  '  })',
  '',
  'EXAMPLE (BAD — should have rendered with defaults instead):',
  '  ❌ "Which cloud provider do you want — Azure, AWS, or GCP?"',
  '     (Just list resources from all configured providers and let the',
  '      user narrow if they want to.)',
].join('\n');

export const REQUEST_CLARIFICATION_TOOL = {
  type: 'function',
  function: {
    name: 'request_clarification',
    description: DESCRIPTION,
    parameters: {
      type: 'object',
      required: ['question'],
      properties: {
        question: {
          type: 'string',
          description:
            'The clarifying question to ask the user. Be specific and ' +
            'short — one sentence. Frame it so the user can answer with ' +
            'one of the options if provided.',
        },
        options: {
          type: 'array',
          description:
            'Optional multiple-choice options. When supplied, the UI ' +
            'renders pickable chips. Omit for a free-text answer.',
          items: {
            type: 'object',
            required: ['value', 'label'],
            properties: {
              value: { type: 'string', description: 'Stable id sent back as the answer.' },
              label: { type: 'string', description: 'Human-visible chip label.' },
            },
          },
        },
      },
    },
  },
} as const;

// ---------------------------------------------------------------------------
// Name-match
// ---------------------------------------------------------------------------

const ALIAS_NAMES = new Set<string>([
  'request_clarification',
  'requestClarification',
  'RequestClarification',
  'ask_user',
  'ask_question',
]);

export function isRequestClarificationTool(name: string): boolean {
  return ALIAS_NAMES.has(name);
}

// ---------------------------------------------------------------------------
// Handler
// ---------------------------------------------------------------------------

export interface RequestClarificationOption {
  value: string;
  label: string;
}

export interface RequestClarificationInput {
  question: string;
  options?: RequestClarificationOption[];
}

export interface RequestClarificationResult {
  ok: boolean;
  clarification_id?: string;
  error?: string;
}

interface ClarificationContext {
  emit: (frameType: string, payload: unknown) => void;
  logger: {
    info: (...args: unknown[]) => void;
    warn: (...args: unknown[]) => void;
    error: (...args: unknown[]) => void;
    debug: (...args: unknown[]) => void;
  };
  sessionId?: string;
  userId?: string;
}

export async function executeRequestClarification(
  ctx: ClarificationContext,
  input: RequestClarificationInput,
): Promise<RequestClarificationResult> {
  if (typeof input?.question !== 'string' || input.question.trim().length === 0) {
    return {
      ok: false,
      error: 'question is required and must be a non-empty string.',
    };
  }

  const clarification_id = crypto.randomBytes(8).toString('hex');

  // Emit `ttft` BEFORE the clarification frame so the UI's
  // LiveTurnStatus first-token gate clears (otherwise the gate hangs at
  // "waiting for first token" indefinitely and the clarification card
  // never renders, since it requires firstTokenAt != null). Diagnosed
  // 2026-05-08 in reports/capstone-mock-parity-gap-2026-05-08.md §4.
  ctx.emit('ttft', { ttftMs: 0 });

  ctx.emit('request_clarification', {
    clarification_id,
    question: input.question,
    options: input.options ?? null,
    session_id: ctx.sessionId ?? null,
  });

  ctx.logger.info({
    clarification_id,
    hasOptions: Array.isArray(input.options) && input.options.length > 0,
  }, '[request_clarification] emitted');

  return { ok: true, clarification_id };
}

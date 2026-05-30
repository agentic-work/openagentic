/**
 * prompt_template node executor — reusable prompt builder.
 *
 * Substitutes `{{var}}` placeholders in a template body with values from
 * `data.variables`. Two output modes:
 *
 *   - outputAs: 'prompt' (default) → returns { prompt, variables, outputAs }
 *     where `prompt` is the fully-rendered string. Feed directly into an
 *     llm_completion node via `{{steps.<id>.prompt}}` or into the prompt
 *     setting of a downstream LLM node.
 *
 *   - outputAs: 'messages' → returns { messages, variables, outputAs }.
 *     The template body is split on `{{system}}` / `{{user}}` / `{{assistant}}`
 *     role markers; each section becomes a `{role, content}` entry. The
 *     downstream llm_completion (or agent_*) node consumes the array as a
 *     pre-built chat conversation.
 *
 * Reference: Flowise PromptTemplate / Langflow
 *   src/lfx/src/lfx/components/models_and_agents/prompt.py
 *
 * Variable values are themselves run through ctx.interpolateTemplate so
 * upstream references (e.g. `{{input.user}}`, `{{steps.fetch.body.x}}`)
 * resolve before they land in the template body. Unmapped `{{var}}`
 * placeholders raise a clear node_error — silent empty substitution is
 * a footgun.
 */

import type { WorkflowNode } from '../types.js';
import type { NodeExecutionContext } from '../types.js';

const ROLE_MARKERS = new Set(['system', 'user', 'assistant']);

type OutputAs = 'prompt' | 'messages';

interface PromptOutput {
  prompt: string;
  variables: Record<string, string>;
  outputAs: 'prompt';
}

interface MessagesOutput {
  messages: Array<{ role: 'system' | 'user' | 'assistant'; content: string }>;
  variables: Record<string, string>;
  outputAs: 'messages';
}

export async function execute(
  node: WorkflowNode,
  input: unknown,
  ctx: NodeExecutionContext,
): Promise<PromptOutput | MessagesOutput> {
  if (ctx.signal.aborted) throw new Error('aborted');

  const data = node.data as Record<string, unknown>;
  const template = typeof data.template === 'string' ? data.template : '';
  if (!template.trim()) {
    throw new Error("prompt_template: 'template' is required and cannot be empty");
  }

  const outputAs: OutputAs = data.outputAs === 'messages' ? 'messages' : 'prompt';
  const rawVariables = (data.variables && typeof data.variables === 'object'
    ? (data.variables as Record<string, unknown>)
    : {}) as Record<string, unknown>;

  // 1. Resolve each variable value through ctx.interpolateTemplate so nested
  //    `{{input.X}}` / `{{steps.Y.z}}` references land as concrete strings
  //    BEFORE we substitute into the template body.
  const resolvedVariables: Record<string, string> = {};
  for (const [k, v] of Object.entries(rawVariables)) {
    if (typeof v === 'string') {
      resolvedVariables[k] = ctx.interpolateTemplate(v, input);
    } else if (v === null || v === undefined) {
      resolvedVariables[k] = '';
    } else {
      // Non-string values get JSON-stringified — matches the engine's
      // interpolation contract for objects/arrays.
      resolvedVariables[k] = typeof v === 'object' ? JSON.stringify(v) : String(v);
    }
  }

  if (outputAs === 'messages') {
    const messages = renderMessages(template, resolvedVariables, ROLE_MARKERS);
    ctx.logger.info(
      { nodeId: node.id, messages: messages.length, vars: Object.keys(resolvedVariables).length },
      '[prompt_template] Built messages conversation',
    );
    return {
      messages,
      variables: resolvedVariables,
      outputAs: 'messages',
    };
  }

  // outputAs === 'prompt' — single string render.
  const prompt = renderPrompt(template, resolvedVariables, ROLE_MARKERS);
  ctx.logger.info(
    { nodeId: node.id, length: prompt.length, vars: Object.keys(resolvedVariables).length },
    '[prompt_template] Rendered prompt',
  );
  return {
    prompt,
    variables: resolvedVariables,
    outputAs: 'prompt',
  };
}

/**
 * Substitute {{var}} placeholders, ignoring role markers (system/user/assistant).
 * Throws on the first unmapped variable. Returns the rendered string.
 */
function renderPrompt(
  template: string,
  variables: Record<string, string>,
  roleMarkers: Set<string>,
): string {
  const missing: string[] = [];
  const rendered = template.replace(/\{\{\s*([\w.]+)\s*\}\}/g, (match, name) => {
    const key = String(name);
    if (roleMarkers.has(key)) {
      // Author left a role marker in prompt mode — strip it silently rather
      // than treating it as a variable. Users can switch outputAs to
      // 'messages' to actually segment.
      return '';
    }
    if (Object.prototype.hasOwnProperty.call(variables, key)) {
      return variables[key];
    }
    missing.push(key);
    return match;
  });
  if (missing.length > 0) {
    const list = Array.from(new Set(missing)).join(', ');
    throw new Error(`prompt_template: unmapped variables in template: ${list}`);
  }
  return rendered;
}

/**
 * Split the template body on role markers and produce an array of
 * `{role, content}` messages. Trailing whitespace + leading newline after
 * the marker are trimmed so authors don't have to keep markers glued to
 * their content.
 */
function renderMessages(
  template: string,
  variables: Record<string, string>,
  roleMarkers: Set<string>,
): Array<{ role: 'system' | 'user' | 'assistant'; content: string }> {
  // Find every {{system|user|assistant}} marker with its index, in order.
  const markerRegex = /\{\{\s*(system|user|assistant)\s*\}\}/g;
  const positions: Array<{ role: 'system' | 'user' | 'assistant'; index: number; end: number }> = [];
  let m: RegExpExecArray | null;
  while ((m = markerRegex.exec(template)) !== null) {
    positions.push({
      role: m[1] as 'system' | 'user' | 'assistant',
      index: m.index,
      end: m.index + m[0].length,
    });
  }
  if (positions.length === 0) {
    // No role markers — treat whole body as a single user message after
    // variable substitution.
    const content = renderPrompt(template, variables, roleMarkers).trim();
    return content ? [{ role: 'user', content }] : [];
  }

  const out: Array<{ role: 'system' | 'user' | 'assistant'; content: string }> = [];
  for (let i = 0; i < positions.length; i++) {
    const cur = positions[i];
    const nextStart = i + 1 < positions.length ? positions[i + 1].index : template.length;
    const raw = template.slice(cur.end, nextStart);
    const substituted = renderPrompt(raw, variables, roleMarkers);
    const content = substituted.replace(/^\n/, '').replace(/\s+$/, '');
    if (content.length > 0) {
      out.push({ role: cur.role, content });
    }
  }
  return out;
}

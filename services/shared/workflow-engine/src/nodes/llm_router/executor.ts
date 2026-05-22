/**
 * llm_router node executor — LLM-as-condition.
 *
 * Asks the LLM to pick exactly one route from a configured `routes[]`
 * array (name + description). Goes through the same /v1/chat/completions
 * endpoint that llm_completion / structured_output use. The DB-backed
 * provider/model registry is the SoT for routable models; `model:'auto'`
 * triggers the platform's Smart Router.
 *
 * Does NOT bypass into chatmode's V3 pipeline. Workflow engine talks
 * directly to the platform shim.
 *
 * Routing semantics mirror `condition`: the chosen route name becomes
 * the `sourceHandle` the engine follows on outgoing edges; non-matching
 * targets are notified-skipped via ctx.routeBranches.
 */

import type { WorkflowNode } from '../types.js';
import type { NodeExecutionContext } from '../types.js';
import { streamLLMCompletion } from '../../llm/streamLLMCompletion.js';
import { withGenAISpan } from '../../observability/GenAITracer.js';

interface RouteSpec {
  name: string;
  description: string;
}

interface RouterResult {
  route: string;
  reasoning?: string;
}

/**
 * Permissive JSON extractor — same shape used by structured_output.
 * Tolerates `\`\`\`json` fences and prose prefix/suffix from weak models.
 */
function tryParseJsonRobust(raw: string): unknown {
  const stripped = raw.replace(/```json\n?|\n?```/g, '').trim();
  try {
    return JSON.parse(stripped);
  } catch {
    // fall through to balanced-block extraction
  }
  const objIdx = stripped.indexOf('{');
  const arrIdx = stripped.indexOf('[');
  const candidates: Array<{ open: string; close: string; start: number }> = [];
  if (objIdx >= 0) candidates.push({ open: '{', close: '}', start: objIdx });
  if (arrIdx >= 0) candidates.push({ open: '[', close: ']', start: arrIdx });
  candidates.sort((a, b) => a.start - b.start);
  for (const { open, close, start } of candidates) {
    let depth = 0;
    let inString = false;
    let escape = false;
    for (let i = start; i < stripped.length; i++) {
      const ch = stripped[i];
      if (escape) {
        escape = false;
        continue;
      }
      if (ch === '\\' && inString) {
        escape = true;
        continue;
      }
      if (ch === '"') {
        inString = !inString;
        continue;
      }
      if (inString) continue;
      if (ch === open) depth++;
      else if (ch === close) {
        depth--;
        if (depth === 0) {
          try {
            return JSON.parse(stripped.slice(start, i + 1));
          } catch {
            break;
          }
        }
      }
    }
  }
  throw new Error('No parseable JSON block found in router output');
}

const DEFAULT_SYSTEM_PROMPT =
  'You are a routing classifier. Pick EXACTLY ONE route from the available list ' +
  'based on the user input.\n\n' +
  'STRICT OUTPUT RULES:\n' +
  '- Output ONLY a JSON object with shape { "route": "<name>", "reasoning": "<one sentence>" }.\n' +
  '- The first character of your response MUST be `{`.\n' +
  '- The last character of your response MUST be `}`.\n' +
  '- NO prose, NO reasoning blocks, NO Markdown, NO code fences.\n' +
  '- The route value MUST be one of the names provided — do not invent new route names.';

export async function execute(
  node: WorkflowNode,
  input: unknown,
  ctx: NodeExecutionContext,
): Promise<unknown> {
  const data = (node.data || {}) as Record<string, any>;
  const promptRaw = data.prompt;
  const routes = data.routes;
  const fallbackRoute = data.fallbackRoute as string | undefined;
  const model = (data.model as string | undefined) || 'auto';
  const temperature = typeof data.temperature === 'number' ? data.temperature : 0.1;
  const customSystemPrompt = data.systemPrompt as string | undefined;

  if (!promptRaw) {
    throw new Error('llm_router requires a `prompt`.');
  }
  if (!Array.isArray(routes) || routes.length < 2) {
    throw new Error('llm_router requires a `routes` array with at least 2 entries.');
  }
  const routeSpecs = routes as RouteSpec[];
  for (const r of routeSpecs) {
    if (!r?.name || !r?.description) {
      throw new Error(
        'llm_router routes must each have { name, description }. Got: ' + JSON.stringify(r),
      );
    }
  }
  const validNames = routeSpecs.map((r) => r.name);
  const validNamesLower = new Set(validNames.map((n) => n.toLowerCase()));

  const renderedPrompt = ctx.interpolateTemplate(String(promptRaw), input);
  const routeDescriptions = routeSpecs
    .map((r, i) => `${i + 1}. "${r.name}" — ${r.description}`)
    .join('\n');

  const userContent = `${renderedPrompt}\n\nAVAILABLE ROUTES:\n${routeDescriptions}\n\nReturn ONLY a JSON object with: { "route": "<one of: ${validNames.join(', ')}>", "reasoning": "<one sentence why>" }`;

  const messages = [
    {
      role: 'system' as const,
      content: customSystemPrompt
        ? ctx.interpolateTemplate(customSystemPrompt, input)
        : DEFAULT_SYSTEM_PROMPT,
    },
    { role: 'user' as const, content: userContent },
  ];

  ctx.logger.info(
    {
      nodeId: node.id,
      model,
      routeCount: routeSpecs.length,
      promptChars: renderedPrompt.length,
    },
    '[llm_router] Calling LLM for route selection',
  );

  const result = await withGenAISpan(
    {
      operation: 'chat',
      system: 'openagentic.platform',
      requestModel: model,
      maxTokens: 256,
      temperature,
    },
    async () => {
      const r = await streamLLMCompletion({
        apiUrl: ctx.apiUrl,
        model,
        messages,
        temperature,
        maxTokens: 256,
        headers: {
          ...ctx.getInternalAuthHeaders(),
          'X-Workflow-Execution': ctx.executionId,
        },
        signal: ctx.signal,
        messageId: `wf_${ctx.executionId}_${node.id}`,
        onCanonical: (event) => {
          ctx.emitCanonical?.(event as unknown as { type: string } & Record<string, unknown>);
        },
        extraBody: { response_format: { type: 'json_object' } },
      });
      return {
        result: r,
        meta: {
          responseModel: r.model,
          finishReasons: r.stopReason ? [r.stopReason] : undefined,
          inputTokens: r.usage?.input_tokens,
          outputTokens: r.usage?.output_tokens,
        },
      };
    },
  );

  const rawResponse = result.fullText;
  let parsed: RouterResult;
  try {
    parsed = tryParseJsonRobust(rawResponse) as RouterResult;
  } catch (err) {
    throw new Error(
      `llm_router: model returned unparseable output (no JSON block found). raw="${rawResponse.slice(0, 200)}"`,
    );
  }

  const rawRoute = String(parsed?.route ?? '').trim();
  const reasoning = parsed?.reasoning ? String(parsed.reasoning) : undefined;

  let selectedRoute: string;
  let fallbackUsed = false;
  if (validNamesLower.has(rawRoute.toLowerCase())) {
    // Normalize to the configured-case name so sourceHandle matching is exact.
    selectedRoute = validNames.find((n) => n.toLowerCase() === rawRoute.toLowerCase())!;
  } else if (fallbackRoute && validNamesLower.has(fallbackRoute.toLowerCase())) {
    selectedRoute = validNames.find(
      (n) => n.toLowerCase() === fallbackRoute.toLowerCase(),
    )!;
    fallbackUsed = true;
    ctx.logger.warn(
      { nodeId: node.id, modelPick: rawRoute, fallbackRoute: selectedRoute, validNames },
      '[llm_router] Model picked invalid route; using fallback',
    );
  } else {
    throw new Error(
      `llm_router: model picked invalid route '${rawRoute}', not in [${validNames.join(', ')}] and no fallbackRoute configured.`,
    );
  }

  ctx.logger.info(
    {
      nodeId: node.id,
      selectedRoute,
      fallbackUsed,
      modelPick: rawRoute,
      reasoning,
      tokensIn: result.usage?.input_tokens,
      tokensOut: result.usage?.output_tokens,
    },
    '[llm_router] Route decided',
  );

  // Engine-level routing: follow only the edge whose sourceHandle matches
  // the chosen route. All other downstream targets get notifySkippedBranch
  // so their merge gates don't hang waiting on this branch.
  const outgoing = ctx.getOutgoingEdges ? ctx.getOutgoingEdges(node.id) : [];
  const follow: string[] = [];
  const skip: string[] = [];
  for (const edge of outgoing) {
    const handle = (edge.sourceHandle ?? '').toLowerCase().trim();
    if (handle && handle === selectedRoute.toLowerCase()) {
      follow.push(edge.target);
    } else {
      skip.push(edge.target);
    }
  }
  if (ctx.routeBranches && (follow.length > 0 || skip.length > 0)) {
    await ctx.routeBranches(
      node.id,
      { follow, skip },
      { route: selectedRoute, reasoning, fallbackUsed },
    );
  }

  return {
    route: selectedRoute,
    reasoning,
    model: result.model || model,
    usage: result.usage,
    fallbackUsed,
    rawResponse: rawResponse.slice(0, 1000),
  };
}

/**
 * synth node executor — schema-driven plugin shape (Task #46).
 *
 * Migrated from WorkflowExecutionEngine.executeSynthNode. POSTs to the
 * openagentic-api `/api/synth/synthesize` endpoint via abortableAxiosPost
 * so the AbortController.signal cancels in-flight requests on workflow
 * abort.
 *
 * The legacy executor resolved userEmail via a Prisma user lookup; the
 * schema-driven executor delegates that to the new ctx.getUserEmail hook
 * (engine wires it to the prisma lookup) so the shared package never
 * imports prisma directly.
 *
 * Synth has TWO success-shape branches:
 *   - normal completion → returns `{ toolName, tool, result, metrics }`
 *   - high-risk synth pending approval → returns
 *     `{ status: 'awaiting_approval', riskLevel, message, tool, metrics }`
 *
 * The engine's executeNodeWithRecovery special-cases
 * `status === 'awaiting_approval'` to pause the branch — preserve that
 * exact return shape verbatim.
 *
 * The same plugin is registered under three additional aliases via the
 * registry's registerAlias helper:
 *   - synth_synthesize  (legacy field name)
 *   - oat               (backwards-compat with the renamed framework)
 *   - oat_synthesize    (backwards-compat)
 */

import type { WorkflowNode } from '../types.js';
import type { NodeExecutionContext } from '../types.js';
import { abortableAxiosPost } from '../../abortableAxios.js';
import { withGenAISpan } from '../../observability/GenAITracer.js';

export interface SynthResult {
  toolName?: string;
  tool?: {
    explanation?: string;
    riskLevel?: string;
    capabilitiesUsed?: string[];
    riskReasoning?: string;
  };
  result?: unknown;
  metrics?: {
    synthesisTimeMs?: number;
    executionTimeMs?: number;
    totalTimeMs?: number;
    costUsd?: number;
  };
  existingToolsSuggested?: unknown[];
}

export interface SynthAwaitingApproval {
  status: 'awaiting_approval';
  intent: string;
  riskLevel?: string;
  message: string;
  tool?: SynthResult['tool'];
  metrics?: SynthResult['metrics'];
}

export async function execute(
  node: WorkflowNode,
  input: unknown,
  ctx: NodeExecutionContext,
): Promise<SynthResult | SynthAwaitingApproval> {
  const data = (node.data || {}) as Record<string, any>;
  const { intent, capabilities, dryRun, credentials } = data;

  // Resolve intent: explicit setting (templated) > string input > nothing.
  const resolvedIntent =
    typeof intent === 'string' && intent.length > 0
      ? ctx.interpolateTemplate(intent, input)
      : typeof input === 'string'
        ? input
        : intent;

  if (!resolvedIntent || typeof resolvedIntent !== 'string') {
    throw new Error(
      'Synth node requires an intent (either in node data or as input)',
    );
  }

  // Resolve userEmail via the engine-supplied hook. Falls back to ''.
  let userEmail = '';
  if (ctx.getUserEmail) {
    try {
      userEmail = (await ctx.getUserEmail()) || '';
    } catch {
      userEmail = '';
    }
  }

  ctx.logger.info(
    {
      nodeId: node.id,
      intent: (resolvedIntent as string).substring(0, 100),
      capabilities,
      dryRun,
      userId: ctx.userId,
    },
    '[synth] Executing Synth node — dynamic tool synthesis',
  );

  // Build auth headers — internal-service preferred; fall back to user auth.
  const headers: Record<string, string> = {
    'Content-Type': 'application/json',
    ...ctx.getInternalAuthHeaders(),
  };
  if (ctx.authToken) {
    headers['Authorization'] = ctx.authToken.startsWith('Bearer ')
      ? ctx.authToken
      : `Bearer ${ctx.authToken}`;
  }

  // OTel GenAI v1.37 — synth wraps an LLM call (the synthesizer agent that
  // generates the tool code). Surface it as a `chat` op with system
  // 'openagentic.platform' since the underlying provider is opaque to the
  // node. Usage tokens come back on the synth metrics shape when available.
  const response = await withGenAISpan(
    {
      operation: 'chat',
      system: 'openagentic.platform',
      requestModel: 'auto',
    },
    async () => {
      const r = await abortableAxiosPost(
        { signal: ctx.signal },
        `${ctx.apiUrl}/api/synth/synthesize`,
        {
          intent: resolvedIntent,
          userId: ctx.userId,
          userEmail,
          capabilities: capabilities || [],
          dryRun: dryRun || false,
          sessionId: ctx.executionId,
          credentials: credentials || undefined,
        },
        {
          headers,
          timeout: 60000,
          validateStatus: () => true,
        },
      );
      const rd = (r.data || {}) as any;
      return {
        result: r,
        meta: {
          responseModel: rd.model ?? rd.metrics?.model,
          inputTokens: rd.metrics?.promptTokens ?? rd.usage?.input_tokens,
          outputTokens: rd.metrics?.completionTokens ?? rd.usage?.output_tokens,
        },
      };
    },
  );

  if (response.status >= 400) {
    const apiErr =
      (response.data && (response.data as any).error) ||
      `Synthesis request failed with status ${response.status}`;
    throw new Error(apiErr);
  }

  const r = (response.data || {}) as any;

  // Awaiting-approval branch: surfaced verbatim so executeNodeWithRecovery
  // can pause the branch (engine special-cases status='awaiting_approval').
  if (r.approval?.required && !r.approval?.approved) {
    ctx.logger.info(
      {
        nodeId: node.id,
        riskLevel: r.tool?.riskLevel,
        approvalRequired: true,
      },
      '[synth] Synth node requires approval',
    );
    return {
      status: 'awaiting_approval',
      intent: resolvedIntent as string,
      riskLevel: r.tool?.riskLevel,
      message: r.error || 'Synthesis requires human approval',
      tool: r.tool
        ? {
            explanation: r.tool.explanation,
            riskLevel: r.tool.riskLevel,
            riskReasoning: r.tool.riskReasoning,
            capabilitiesUsed: r.tool.capabilitiesUsed,
          }
        : undefined,
      metrics: r.metrics,
    };
  }

  if (r.success === false) {
    throw new Error(r.error || 'Tool synthesis failed');
  }

  // Normal completion. The api response carries the tool fields at the top
  // level (see SynthService.synthesize), so we mirror that shape.
  const tool = r.tool ?? {
    explanation: r.explanation || r.description || resolvedIntent,
    riskLevel: r.riskLevel || 'low',
    capabilitiesUsed: r.capabilitiesUsed || capabilities || [],
  };

  const toolName: string =
    r.toolName ||
    r.tool?.name ||
    (typeof tool?.explanation === 'string'
      ? tool.explanation.substring(0, 80)
      : 'synthesized_tool');

  const synthesisTimeMs = r.synthesisTimeMs ?? r.metrics?.synthesisTimeMs ?? 0;
  const executionTimeMs = r.executionTimeMs ?? r.metrics?.executionTimeMs ?? 0;
  const totalTimeMs = r.metrics?.totalTimeMs ?? synthesisTimeMs + executionTimeMs;
  const costUsd = r.costUsd ?? r.metrics?.costUsd ?? 0;

  ctx.logger.info(
    {
      nodeId: node.id,
      success: true,
      riskLevel: tool?.riskLevel,
      executionTimeMs,
      totalTimeMs,
    },
    '[synth] Synth node completed',
  );

  return {
    toolName,
    tool: {
      explanation: tool?.explanation,
      riskLevel: tool?.riskLevel,
      capabilitiesUsed: tool?.capabilitiesUsed,
    },
    result: r.result ?? r.output ?? r,
    metrics: { synthesisTimeMs, executionTimeMs, totalTimeMs, costUsd },
    existingToolsSuggested: r.existingToolsSuggested || [],
  };
}

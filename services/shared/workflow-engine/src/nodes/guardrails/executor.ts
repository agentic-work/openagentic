/**
 * guardrails node executor.
 *
 * Migrated from WorkflowExecutionEngine.executeGuardrailsNode. Calls the
 * platform's /api/v1/guardrails/check endpoint; on 4xx/5xx falls back to a
 * minimal local regex scan (PII SSN/email-bulk, prompt injection) so the
 * workflow still gets a verdict even if the DLP service is down.
 */

import type { WorkflowNode } from '../types.js';
import type { NodeExecutionContext } from '../types.js';
import { abortableAxiosPost } from '../../abortableAxios.js';
import { withGenAISpan } from '../../observability/GenAITracer.js';

export async function execute(
  node: WorkflowNode,
  input: unknown,
  ctx: NodeExecutionContext,
): Promise<unknown> {
  const data = (node.data || {}) as Record<string, any>;
  const checks: string[] = data.checks || ['pii', 'toxicity', 'injection'];
  const action: string = data.action || 'block';

  const content =
    typeof input === 'string'
      ? input
      : (input as any)?.content ||
        (input as any)?.text ||
        (input as any)?.output ||
        JSON.stringify(input);

  ctx.logger.info(
    { nodeId: node.id, checks, contentLength: content.length },
    '[guardrails] Running',
  );

  return withGenAISpan(
    {
      operation: 'chat',
      system: 'openagentic.platform',
      requestModel: 'auto',
    },
    async () => {
      const response = await abortableAxiosPost(
        { signal: ctx.signal },
        `${ctx.apiUrl}/api/v1/guardrails/check`,
        { content, checks, action },
        {
          headers: ctx.getInternalAuthHeaders(),
          timeout: 15000,
          validateStatus: () => true,
        },
      );

      if (response.status >= 400) {
        // Fallback: basic regex checks locally.
        const findings: string[] = [];
        if (checks.includes('pii')) {
          if (/\b\d{3}-\d{2}-\d{4}\b/.test(content)) findings.push('SSN detected');
          if (
            /\b[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}\b/i.test(content) &&
            (content.match(/@/g) || []).length > 3
          ) {
            findings.push('Bulk email addresses');
          }
        }
        if (checks.includes('injection')) {
          if (/ignore.*previous.*instructions|system.*prompt/i.test(content)) {
            findings.push('Prompt injection attempt');
          }
        }

        const passed = findings.length === 0;
        const out = {
          passed,
          findings,
          action: passed ? 'allow' : action,
          content: passed ? content : action === 'redact' ? '[REDACTED]' : content,
          checksRun: checks,
          fallback: true,
        };
        return { result: out, meta: { inputTokens: 0, outputTokens: 0 } };
      }

      const d: any = response.data;
      return {
        result: d,
        meta: {
          responseModel: (d?.model as string | undefined) ?? undefined,
          inputTokens: (d?.usage?.input_tokens as number | undefined) ?? 0,
          outputTokens: (d?.usage?.output_tokens as number | undefined) ?? 0,
        },
      };
    },
  );
}

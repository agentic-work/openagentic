/**
 * openagentic node executor — schema-driven plugin shape (Task #46).
 *
 * Migrated from WorkflowExecutionEngine.executeOpenagenticNode. Spawns an
 * isolated session in the openagentic-manager service via abortableAxiosPost
 * so the AbortController.signal cancels in-flight requests on workflow
 * abort.
 *
 * The engine threads `openagenticManagerUrl` onto the ctx (defaulting to
 * `process.env.OPENAGENTIC_MANAGER_URL || http://openagentic-code-manager:8080`).
 *
 * Output assertions on the schema catch:
 *   - openagentic_session_completed — sessionStatus must be completed/success
 *   - openagentic_substantive_output — refusal regex on transcript/summary
 */

import type { WorkflowNode } from '../types.js';
import type { NodeExecutionContext } from '../types.js';
import { abortableAxiosPost } from '../../abortableAxios.js';

export interface OpenagenticResult {
  stdout: string;
  stderr: string;
  exitCode: number;
  language: string;
  sessionStatus?: string;
  transcript?: string;
  summary?: string;
}

export async function execute(
  node: WorkflowNode,
  input: unknown,
  ctx: NodeExecutionContext,
): Promise<OpenagenticResult> {
  const data = (node.data || {}) as Record<string, any>;
  const { language, code, timeout: execTimeout } = data;

  if (!code || typeof code !== 'string') {
    throw new Error('Openagentic node requires a non-empty `code` setting');
  }

  if (!ctx.openagenticManagerUrl) {
    throw new Error(
      '[openagentic] openagenticManagerUrl is not configured on the engine context — set OPENAGENTIC_MANAGER_URL.',
    );
  }

  const resolvedCode = ctx.interpolateTemplate(code, input);
  const resolvedLanguage = language || 'python';
  const resolvedTimeout = typeof execTimeout === 'number' && execTimeout > 0 ? execTimeout : 30000;

  ctx.logger.info(
    {
      nodeId: node.id,
      language: resolvedLanguage,
      codeLength: resolvedCode.length,
      timeoutMs: resolvedTimeout,
    },
    '[openagentic] Executing openagentic node — spawning isolated session',
  );

  try {
    const response = await abortableAxiosPost(
      { signal: ctx.signal },
      `${ctx.openagenticManagerUrl}/api/execute`,
      {
        language: resolvedLanguage,
        code: resolvedCode,
        timeout: resolvedTimeout,
        workflowExecutionId: ctx.executionId,
      },
      {
        headers: {
          'Content-Type': 'application/json',
          ...ctx.getInternalAuthHeaders(),
          ...(ctx.authToken
            ? {
                Authorization: ctx.authToken.startsWith('Bearer ')
                  ? ctx.authToken
                  : `Bearer ${ctx.authToken}`,
              }
            : {}),
        },
        timeout: resolvedTimeout + 10000,
      },
    );

    const r = (response.data || {}) as Record<string, any>;
    return {
      stdout: r.stdout || '',
      stderr: r.stderr || '',
      exitCode: typeof r.exitCode === 'number' ? r.exitCode : 0,
      language: resolvedLanguage,
      sessionStatus: r.sessionStatus,
      transcript: r.transcript,
      summary: r.summary,
    };
  } catch (error: any) {
    if (error?.code === 'ECONNREFUSED' || error?.code === 'ENOTFOUND') {
      throw new Error(
        `Openagentic manager is not reachable at ${ctx.openagenticManagerUrl}`,
      );
    }
    throw new Error(
      `Openagentic execution failed: ${error?.response?.data?.error || error?.message || String(error)}`,
    );
  }
}

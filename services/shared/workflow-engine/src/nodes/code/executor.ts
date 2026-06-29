/**
 * code node executor — schema-driven plugin shape (Task #46).
 *
 * Migrated from WorkflowExecutionEngine.executeCodeNode + executeJavaScript.
 * Runs user-supplied JavaScript inside the shared isolated-vm sandbox via
 * the new ctx.runIsolatedCode hook (engine wires this to runSandboxed).
 *
 * Inputs:
 *   - code: string (required)            — the snippet to run
 *   - language: 'javascript' (default)   — only JS is supported in-process
 *   - timeoutMs: number (default 5000)   — max wall time
 *
 * The legacy executor never templated the `code` setting (the snippet itself
 * reads `input` directly inside the sandbox), so neither does this one.
 *
 * Output assertion `code_did_not_error` catches `{ error: ... }` returns
 * (the sandbox surfaces runtime errors via that field rather than throwing).
 */

import type { WorkflowNode } from '../types.js';
import type { NodeExecutionContext } from '../types.js';

export async function execute(
  node: WorkflowNode,
  input: unknown,
  ctx: NodeExecutionContext,
): Promise<unknown> {
  const data = (node.data || {}) as Record<string, any>;
  const code: string = data.code;
  const language: string = data.language || 'javascript';
  const timeoutMs: number =
    typeof data.timeoutMs === 'number' && data.timeoutMs > 0 ? data.timeoutMs : 5000;

  if (!code || typeof code !== 'string') {
    throw new Error('Code node requires a non-empty `code` setting');
  }

  if (ctx.signal.aborted) {
    throw new Error('Code node aborted before execution started');
  }

  if (language !== 'javascript') {
    throw new Error(
      `Code node language "${language}" is not supported in-process. Use the openagentic node for python.`,
    );
  }

  if (!ctx.runIsolatedCode) {
    throw new Error(
      '[code] ctx.runIsolatedCode hook is required — engine is not wired correctly (sandbox unavailable)',
    );
  }

  ctx.logger.info(
    { nodeId: node.id, language, codeLength: code.length, timeoutMs },
    '[code] Executing code node in isolated sandbox',
  );

  return ctx.runIsolatedCode(code, language, input, timeoutMs);
}

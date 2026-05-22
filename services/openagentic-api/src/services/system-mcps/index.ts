/**
 * SYSTEM MCPs
 *
 * System MCPs are internal MCPs that provide specialized capabilities to the LLM
 * without being exposed as user-visible tools. They inject system prompts and
 * tool definitions to enable specific functionality.
 *
 * The artifact system is the primary way to generate visualizations, diagrams,
 * and interactive content. This module provides context-aware guidance to encourage
 * LLMs to use artifacts appropriately.
 *
 * NOTE (openagentic-your-deployment#327): the canonical user-intent gate now lives in
 * `services/prompt/ArtifactIntentGate.ts` and was consumed by the legacy
 * dynamic prompt composer (ripped Phase E.3).
 * `isDiagramRequest` here is retained only as a defence-in-depth check for
 * the legacy non-composable prompt path (see prompt.stage.ts fallback when
 * USE_COMPOSABLE_PROMPTS=false). It delegates to the same gate so the two
 * code paths cannot disagree.
 */

import {
  BROWSER_EXEC_SYSTEM_PROMPT,
  BROWSER_EXEC_TOOL_DEFINITION,
  suggestsBrowserExec,
} from './browser-exec.js';

// All registered system MCPs
export const SYSTEM_MCPS = {} as const;

/**
 * V2: returns false unconditionally. Visual artifacts emit via the
 * structured `render_artifact` tool — the model picks. No keyword gate.
 * Plan: docs/chatmode-ux-mock-parity/02-plan-canonical.md
 */
export function isDiagramRequest(_message: string): boolean {
  return false;
}

// Visualization / artifact guidance USED to live here as a hardcoded
// `ARTIFACT_GUIDANCE_PROMPT` constant. It briefly lived in the composable
// prompt-module system (RIPPED Phase E.3-E.6, 2026-05-10). It is now
// folded into the RBAC `chat-system-{admin,member}.md` static prompts.
// The legacy hardcoded path also pushed cost-specific verbiage
// ("when users ask about costs, build a Sankey diagram") that hijacked
// plain Azure resource asks into unwanted cost+artifact workflows.
// Also pre-mermaid-rip: the old prompt told the model to "prefer Mermaid for
// simple diagrams" + emit Plotly via `https://cdn.plot.ly/...` (banned by
// CdnAllowList). Both wrong. Removed entirely — the constant is gone, not
// merely unreferenced, so it can never accidentally re-enter the prompt
// surface via grep-and-paste.
export function getSystemMcpPrompts(userMessage: string): string[] {
  const prompts: string[] = [];

  // Task #158 — offer the browser_exec analysis tool when the user's
  // prompt hints at computation (prime sieve, CSV parse, quick plot).
  if (suggestsBrowserExec(userMessage)) {
    prompts.push(BROWSER_EXEC_SYSTEM_PROMPT);
  }

  return prompts;
}

// Get tool definitions for active MCPs
export function getSystemMcpTools(userMessage: string): any[] {
  const tools: any[] = [];
  // Task #158 — expose `browser_exec` in the model's tool manifest so
  // it can request Python/JS sandbox execution. The pipeline intercepts
  // the tool-call JSON and emits a `browser_exec_request` NDJSON frame
  // instead of routing it through the MCP bridge.
  if (suggestsBrowserExec(userMessage)) {
    tools.push(BROWSER_EXEC_TOOL_DEFINITION);
  }
  return tools;
}

// Check if a tool call is for a system MCP
export function isSystemMcpTool(toolName: string): boolean {
  return toolName === 'browser_exec';
}

// Process a system MCP tool call
export async function processSystemMcpToolCall(
  toolName: string,
  _toolInput: unknown
): Promise<{ success: boolean; result?: unknown; error?: string }> {
  return {
    success: false,
    error: `System MCP tool '${toolName}' is not available. Use artifacts instead.`,
  };
}

// Legacy exports for backwards compatibility. `DIAGRAM_SYSTEM_PROMPT` used
// to point at the deleted `ARTIFACT_GUIDANCE_PROMPT` constant (Plotly + Mermaid
// guidance — both removed); zero external callers verified before deletion.
// The fully-realized deprecated diagram MCP lives in ./diagram-mcp.ts.
export const DIAGRAM_MCP_NAME = 'artifact-system';
export const DIAGRAM_TOOL_DEFINITION = null;
export function validateDiagram(_diagram: unknown): { valid: boolean; errors: string[] } {
  return { valid: true, errors: [] };
}

export default SYSTEM_MCPS;

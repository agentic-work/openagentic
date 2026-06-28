/** Shared parsing of the chat pipeline's `approval_required` stream frame.
 *
 * The server pauses a mutating tool call and emits an `approval_required` frame
 * whose `requestId` equals the audit row id (`auditId`). A decision is sent back
 * with `OaClient.approveChatToolCall(requestId, approved)`, which releases the
 * server-side approval gate (`auditAndGate` → `ApprovalRegistry.waitFor`).
 *
 * Both the scripting path (`cmdDo` in commands.ts) and the interactive TUI
 * (tui/screens/Chat.tsx) consume the same frame, so the parser lives here as the
 * single source of truth. */
export interface ApprovalRequest {
  /** requestId === auditId on the wire — the id passed to approveChatToolCall. */
  requestId: string;
  toolName: string;
  serverName?: string;
  args?: unknown;
  preview?: string;
  classification?: string;
}

/** Narrow an arbitrary stream event to an ApprovalRequest, or undefined if it is
 * not a well-formed `approval_required` frame. */
export function asApprovalRequest(event: unknown): ApprovalRequest | undefined {
  if (!event || typeof event !== "object") return undefined;
  const e = event as Record<string, unknown>;
  if (e.type !== "approval_required") return undefined;
  // requestId === auditId on the wire; tolerate either being the carrier.
  const id = e.requestId ?? e.auditId;
  if (typeof id !== "string" || !id) return undefined;
  return {
    requestId: id,
    toolName: typeof e.toolName === "string" ? e.toolName : "(unknown tool)",
    serverName: typeof e.serverName === "string" ? e.serverName : undefined,
    args: e.args,
    preview: typeof e.preview === "string" ? e.preview : undefined,
    classification: typeof e.classification === "string" ? e.classification : undefined,
  };
}

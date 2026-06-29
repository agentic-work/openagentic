/**
 * Helpers for writing MCP tool-call audit rows without tripping the
 * UserQueryAudit.message_id → chat_messages.id FK.
 *
 * Context: the chat pipeline works with two message identifiers —
 *   1. A synthetic pipeline ID like `msg_1776811834086_pnwgox21a` (never
 *      persisted as a chat_messages row).
 *   2. The confirmed DB row id returned by ChatStorage.saveMessage(),
 *      e.g. `AzLvFUfVnEQV6itKP0Q4Q`.
 *
 * UserQueryAudit.message_id is nullable and has a real FK. If we pass the
 * pipeline ID (which looks like an ID but is not persisted), Prisma throws
 * P2003. Always prefer the confirmed DB id, else null.
 */

/**
 * A confirmed DB row id looks like a nanoid / uuid — no underscores and no
 * `msg_` prefix. This is deliberately narrow; we favor false-negatives
 * (audit rows without message_id) over false-positives (FK violation).
 */
export function looksLikeDbRowId(id: string | null | undefined): boolean {
  if (!id || typeof id !== 'string') return false;
  if (id.startsWith('msg_')) return false;
  if (id.startsWith('continuation_')) return false;
  if (id.startsWith('cot_')) return false;
  if (id.includes('_') && /^[a-z]+_\d{10,}/.test(id)) return false; // pipeline-ish
  // Accept uuid (8-4-4-4-12 hex) or nanoid-ish (21+ chars, alnum)
  const uuidRe = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
  if (uuidRe.test(id)) return true;
  if (id.length >= 8 && /^[A-Za-z0-9_-]+$/.test(id)) return true;
  return false;
}

/**
 * Pick the message_id value to store on UserQueryAudit.
 * - Prefer confirmedDbId when it looks like a row id.
 * - Never return the raw pipelineId (would violate FK).
 * - Return null when no safe id available.
 */
export function pickAuditMessageId(opts: {
  confirmedDbId?: string | null;
  pipelineId?: string | null;
}): string | null {
  const { confirmedDbId } = opts;
  if (looksLikeDbRowId(confirmedDbId)) return confirmedDbId as string;
  return null;
}

/**
 * Pick the modelProvider label for the audit row.
 * Prior behavior stamped the global `DEFAULT_LLM_PROVIDER` env even when the
 * actual executing provider was known (e.g. routing to bedrock-main
 * labelled as `ollama`). If a resolvedProvider is given, it wins.
 */
export function pickAuditModelProvider(opts: {
  resolvedProvider?: string | null;
  resolvedProviderType?: string | null;
  fallback?: string | null;
}): string | null {
  const { resolvedProvider, resolvedProviderType, fallback } = opts;
  if (typeof resolvedProvider === 'string' && resolvedProvider.trim() !== '') return resolvedProvider.trim();
  if (typeof resolvedProviderType === 'string' && resolvedProviderType.trim() !== '') return resolvedProviderType.trim();
  if (typeof fallback === 'string' && fallback.trim() !== '') return fallback.trim();
  return null;
}

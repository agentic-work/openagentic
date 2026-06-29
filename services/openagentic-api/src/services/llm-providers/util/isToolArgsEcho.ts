/**
 * isToolArgsEcho — pure helper for OllamaProvider's text-suppression
 * check (#846, 2026-05-14).
 *
 * Live failure mode: gpt-oss:20b emitted a chunk where
 * `message.content = '{"k":5,"query":"azure list_resource_groups"}'`
 * AND `message.tool_calls = [{ function: { name: "tool_search",
 * arguments: { k: 5, query: "azure list_resource_groups" } } }]`.
 *
 * The model leaked the tool-call arguments into the visible text
 * content. Without suppression OllamaProvider yields a text
 * content_block_delta carrying the JSON, AND yields the tool_use
 * content blocks — the chat UI then renders BOTH (JSON as prose +
 * the tool card). Live screenshot 2026-05-14 confirmed.
 *
 * Rule: when a chunk has any pending tool_calls AND its content
 * trims to a parseable JSON object literal, the content is an echo
 * of the tool-call args and must be suppressed. Real prose responses
 * almost never start with `{` and parse as objects.
 *
 * NO regex matching on tool names / arg keys — we don't try to
 * structurally compare content to the tool_calls' arguments. A
 * cheap JSON.parse check is enough: real assistant text doesn't
 * round-trip as a JSON object.
 */

export function isToolArgsEcho(
  contentText: string | null | undefined,
  toolCalls: unknown[] | null | undefined,
): boolean {
  if (!contentText || typeof contentText !== 'string') return false;
  if (!Array.isArray(toolCalls) || toolCalls.length === 0) return false;

  const trimmed = contentText.trim();
  if (trimmed.length < 2) return false;
  if (!trimmed.startsWith('{') || !trimmed.endsWith('}')) return false;

  try {
    const parsed = JSON.parse(trimmed);
    return (
      parsed !== null &&
      typeof parsed === 'object' &&
      !Array.isArray(parsed)
    );
  } catch {
    return false;
  }
}

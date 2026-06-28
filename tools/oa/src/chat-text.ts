/** Pull the visible reply text out of a stream event across known shapes.
 *
 * Single source of truth for both the CLI line-sinks (commands.ts) and the
 * interactive TUI (tui/screens/Chat.tsx). The platform emits canonical
 * Anthropic frames (content_block_delta with a delta.text_delta for the answer,
 * delta.thinking_delta for internal reasoning which we omit); we also tolerate
 * simpler text/delta/OpenAI-choice shapes. */
export function eventText(event: unknown): string {
  if (!event || typeof event !== "object") return "";
  const e = event as Record<string, unknown>;
  const delta = e.delta;
  if (delta && typeof delta === "object") {
    const d = delta as { text?: unknown; type?: unknown };
    if (typeof d.text === "string") return d.text; // text_delta = the reply (thinking_delta omitted)
    return "";
  }
  if (typeof e.delta === "string") return e.delta;
  if (typeof e.text === "string") return e.text;
  if (typeof e.content === "string") return e.content;
  const choices = e.choices as Array<{ delta?: { content?: string } }> | undefined;
  if (choices?.[0]?.delta?.content) return choices[0].delta.content as string;
  return "";
}

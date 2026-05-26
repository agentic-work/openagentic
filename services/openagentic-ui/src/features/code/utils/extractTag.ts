/**
 * Extract the inner content of an XML-style tag from a string.
 *
 * Direct port of openagentic/src/utils/messages.ts::extractTag — the upstream
 * Claude Code TUI uses this same helper to render `<local-command-stdout>…`
 * and `<local-command-stderr>…` blocks. By porting it byte-equivalent here
 * we keep the codemode chat UI's render pipeline structurally identical to
 * the TUI's, so any future tag added upstream just needs the matching UI
 * component, not a new wire-protocol negotiation.
 *
 *   - empty input or empty tag name → null (defensive against accidental
 *     calls during streaming when the buffer hasn't accumulated yet).
 *   - case-insensitive on the tag name (matches upstream `gi` flag).
 *   - tolerates attributes on the opening tag.
 *   - returns the FIRST occurrence on multi-match.
 *   - returns null when the tag is absent (caller decides how to render
 *     the un-tagged text — usually plain markdown).
 *
 * Wire context: openagentic/src/cli/headlessSlashDispatch.ts emits the body
 * of every dispatched slash command wrapped in this tag, so a UI text
 * block whose `text` starts with `<local-command-stdout` should be routed
 * to LocalCommandOutputRow instead of the generic markdown renderer.
 */
export function extractTag(html: string, tagName: string): string | null {
  if (!html.trim() || !tagName.trim()) return null;
  const escaped = tagName.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const pattern = new RegExp(
    `<${escaped}(?:\\s+[^>]*)?>([\\s\\S]*?)<\\/${escaped}>`,
    'i',
  );
  const m = pattern.exec(html);
  return m ? m[1] : null;
}

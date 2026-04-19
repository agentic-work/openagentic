/**
 * Phase F.1 — streaming tool-argument formatting.
 *
 * `input_json_delta` arrives on every LLM chunk while the tool call's
 * arguments stream in. We want to show the user what's coming, but the
 * bytes are mid-JSON most of the time and only occasionally parse. This
 * helper picks between pretty-printed and raw, and truncates long payloads
 * so a massive argument blob can't blow out the tool card.
 */

export const TOOL_INPUT_PREVIEW_MAX_CHARS = 480;

export function formatToolInputDelta(partial: string): {
  display: string;
  truncated: boolean;
  parsed: boolean;
} {
  const trimmed = partial.trim();
  if (!trimmed) return { display: '', truncated: false, parsed: false };

  let display = trimmed;
  let parsed = false;
  try {
    const obj = JSON.parse(trimmed);
    display = JSON.stringify(obj, null, 2);
    parsed = true;
  } catch {
    // Still streaming — render as-is.
  }

  if (display.length > TOOL_INPUT_PREVIEW_MAX_CHARS) {
    return {
      display: display.slice(0, TOOL_INPUT_PREVIEW_MAX_CHARS) + '\u2026',
      truncated: true,
      parsed,
    };
  }
  return { display, truncated: false, parsed };
}

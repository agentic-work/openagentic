/**
 * Sev-0 follow-up to #798 — bare-object recovery parser.
 *
 * gpt-oss:20b (and other Ollama-hosted models) sometimes emit
 * compose_visual / compose_app / render_artifact tool calls as a
 * BARE JSON object inside the assistant text — not native tool_calls,
 * not <|channel|> harmony frames, not a JSON array. Live capture
 * (Q-loop 2026-05-21):
 *
 *   JSON
 *   {
 *     "name": "compose_visual",
 *     "arguments": { "template": "sankey", "data": {...} }
 *   }
 *
 * The two existing fallbacks (parseGptOssToolCalls,
 * parseInlineJsonArrayToolCalls) BOTH fail this shape:
 *   - gpt-oss channel parser expects <|start|>...<|channel|>... frames
 *   - array parser expects `[ {...} ]` and rejects bare objects
 *
 * Without this third-layer recovery, the JSON envelope leaks to the
 * user as raw prose and the artifact never renders.
 *
 * Hard allowlist on `name` — ONLY artifact-rendering tools may be
 * synthesized from bare-object text. Arbitrary `name` values are
 * rejected so conversational JSON like `{"name":"WebSearch", ...}` or
 * theme configs don't accidentally become tool calls.
 *
 * Pure function — no side effects, no Ollama dependency, fully
 * unit-testable.
 */

/**
 * Hard-coded allowlist. Only the artifact-rendering meta tools are
 * permitted as bare-object tool calls. If the user wants a different
 * tool fired, the model must use native tool_calls / channel frames.
 *
 * Keep this list small + audited — any expansion is a new feature
 * and needs its own test.
 */
const ARTIFACT_TOOL_ALLOWLIST = new Set<string>([
  'compose_visual',
  'compose_app',
  'render_artifact',
]);

export interface ParsedInlineObjectToolCall {
  toolCalls: Array<{
    name: string;
    arguments: Record<string, unknown>;
  }>;
}

/**
 * Strip the leading `JSON\n` marker (gpt-oss tendency) and any
 * ```json ... ``` fence wrapping. Returns the inner content.
 */
function stripJsonMarkers(input: string): string {
  let s = input.trim();

  // Strip leading bare "JSON" or "json" marker line
  // Match "JSON" then optional whitespace then a newline boundary
  s = s.replace(/^json\s*\n/i, '');

  // Strip ```json ... ``` fences (also ``` ... ``` plain fences)
  const fenceMatch = s.match(/^```(?:json)?\s*\n?([\s\S]*?)\n?```$/i);
  if (fenceMatch) {
    s = fenceMatch[1].trim();
  }

  return s;
}

/**
 * Walk forward from `start` tracking brace depth to find the matching
 * closing `}`, ignoring braces inside string literals. Returns the
 * index of the matching brace, or -1 if unbalanced.
 */
function findBalancedObjectEnd(s: string, start: number): number {
  let depth = 0;
  let inStr = false;
  let esc = false;
  for (let i = start; i < s.length; i++) {
    const ch = s[i];
    if (inStr) {
      if (esc) {
        esc = false;
        continue;
      }
      if (ch === '\\') {
        esc = true;
        continue;
      }
      if (ch === '"') {
        inStr = false;
      }
      continue;
    }
    if (ch === '"') {
      inStr = true;
      continue;
    }
    if (ch === '{') depth++;
    else if (ch === '}') {
      depth--;
      if (depth === 0) return i;
    }
  }
  return -1;
}

/**
 * Find the first balanced `{...}` block in `content`, returning the
 * slice + the index just past the closing brace, or null if none.
 *
 * We explicitly REJECT inputs whose first non-whitespace character is
 * `[` — those are array shapes, owned by parseInlineJsonArrayToolCalls.
 */
function extractFirstBalancedObject(
  content: string,
): { slice: string } | null {
  const trimmed = content.trim();
  if (!trimmed) return null;

  // If the WHOLE content starts with `[`, defer to the array parser.
  // We only handle bare objects.
  if (trimmed[0] === '[') return null;

  const start = trimmed.indexOf('{');
  if (start < 0) return null;

  const end = findBalancedObjectEnd(trimmed, start);
  if (end < 0) return null;

  return { slice: trimmed.slice(start, end + 1) };
}

/**
 * Parse a bare-object tool call from accumulated Ollama assistant
 * content. Returns one synthesized toolCall (with `name` + parsed
 * `arguments` object) if the input matches the allowlist, otherwise
 * returns null and the chat loop continues with the normal
 * "no tool call, end_turn" path.
 */
export function parseInlineJsonObjectToolCall(
  content: string,
): ParsedInlineObjectToolCall | null {
  if (!content || typeof content !== 'string') return null;

  const stripped = stripJsonMarkers(content);
  if (!stripped) return null;

  const extracted = extractFirstBalancedObject(stripped);
  if (!extracted) return null;

  let parsed: unknown;
  try {
    parsed = JSON.parse(extracted.slice);
  } catch {
    return null;
  }

  if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
    return null;
  }

  const obj = parsed as Record<string, unknown>;

  // Must have `name` field
  const name = obj.name;
  if (typeof name !== 'string' || !name) return null;

  // Hard allowlist — only artifact-rendering meta tools
  if (!ARTIFACT_TOOL_ALLOWLIST.has(name)) return null;

  // Normalize arguments. Models emit it as object OR pre-serialized
  // string OR (rarely) missing — default to empty object.
  let argsObj: Record<string, unknown> = {};
  const rawArgs = obj.arguments;
  if (rawArgs && typeof rawArgs === 'object' && !Array.isArray(rawArgs)) {
    argsObj = rawArgs as Record<string, unknown>;
  } else if (typeof rawArgs === 'string') {
    try {
      const reparsed = JSON.parse(rawArgs);
      if (reparsed && typeof reparsed === 'object' && !Array.isArray(reparsed)) {
        argsObj = reparsed as Record<string, unknown>;
      }
    } catch {
      // Leave argsObj empty — better than failing the whole rescue
    }
  }

  return {
    toolCalls: [
      {
        name,
        arguments: argsObj,
      },
    ],
  };
}

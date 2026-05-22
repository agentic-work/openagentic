/**
 * #807 part 2 — server-side rescue for inline compose_app/compose_visual XML.
 *
 * Models like o4-mini (dev 2026-05-13T20:16 k8s audit session) emit
 * compose_app frames as inline TEXT inside the assistant message body:
 *
 *   <compose_app template="k8s-cluster-topology" params={"groups":[...]}>
 *
 * instead of as `tool_use` function calls. The iframe never mounts and the
 * user sees raw XML strings. This parser detects those text-level patterns
 * so chatLoop can re-emit them as synthetic tool_use frames.
 *
 * The parser is intentionally tolerant of the messy real-world shapes:
 *  - Multi-line `params={...}` JS object literal (nested objects/arrays)
 *  - Mixed quotes and brackets inside string values
 *  - Tags inside fenced code blocks (```)
 *  - Both `<compose_app ...>` and `<compose_visual ...>`
 *
 * It is intentionally STRICT about validity:
 *  - The body inside `params={...}` must parse as JSON. Patterns with
 *    obviously broken JSON are skipped (the user still sees the raw XML
 *    so the failure is visible, not silent).
 *  - Patterns without a closing `>` are skipped.
 *
 * The canonical fix is for the model to invoke compose_app via a real tool
 * call (see prompts/chat-system-{admin,member}.md HARD RULE section).
 * This rescue is defense-in-depth.
 */

export interface ParsedCompose {
  toolName: 'compose_app' | 'compose_visual';
  /** For compose_app: from `template="..."`. For compose_visual: from `chart_type="..."` (mirrored into params.chart_type). */
  template: string;
  /** Parsed JSON object from `params={...}` (compose_app) or attribute-aggregated (compose_visual). */
  params: Record<string, unknown>;
  /** Start offset in input string — for caller to strip. */
  start: number;
  /** End offset (exclusive). */
  end: number;
}

const TAG_NAMES = ['compose_app', 'compose_visual'] as const;
type TagName = (typeof TAG_NAMES)[number];

/**
 * Scan a balanced `{...}` starting at `start` (must point AT the `{`).
 * Tracks string literals so braces inside strings don't unbalance the count.
 * Returns the offset AFTER the matching `}`, or -1 if unbalanced.
 */
function scanBalancedObject(text: string, start: number): number {
  if (text[start] !== '{') return -1;
  let depth = 0;
  let inString: '"' | "'" | null = null;
  let escape = false;
  for (let i = start; i < text.length; i++) {
    const ch = text[i];
    if (escape) {
      escape = false;
      continue;
    }
    if (inString) {
      if (ch === '\\') {
        escape = true;
      } else if (ch === inString) {
        inString = null;
      }
      continue;
    }
    if (ch === '"' || ch === "'") {
      inString = ch as '"' | "'";
      continue;
    }
    if (ch === '{') {
      depth++;
    } else if (ch === '}') {
      depth--;
      if (depth === 0) return i + 1;
    }
  }
  return -1;
}

/**
 * If `value` is a JSX double-brace literal (`{{ ... }}`), return the inner
 * `{ ... }` slice. Otherwise return null.
 *
 * Patterns like `data={{ "x":[1,2] }}` come from models mimicking React JSX —
 * the outer braces are JSX interpolation, the inner braces are the actual
 * object literal. After stripping, the inner is parseable JSON.
 */
function stripDoubleBrace(value: string): string | null {
  const trimmed = value.trim();
  if (!trimmed.startsWith('{{') || !trimmed.endsWith('}}')) return null;
  // Strip exactly one outer brace pair.
  const inner = trimmed.substring(1, trimmed.length - 1).trim();
  if (!inner.startsWith('{') || !inner.endsWith('}')) return null;
  return inner;
}

/**
 * Parse `key="value"` or `key={...}` or `key='value'` attribute starting at
 * `start` (must point AT first char of key). Returns the key, raw value
 * substring, and end offset. Returns null if no attribute matches.
 */
function parseAttribute(
  text: string,
  start: number,
): { key: string; value: string; valueIsObject: boolean; end: number } | null {
  // Skip whitespace
  let i = start;
  while (i < text.length && /\s/.test(text[i])) i++;
  if (i >= text.length || text[i] === '>' || text[i] === '/') return null;

  // Match key
  const keyMatch = /^[a-zA-Z_][\w-]*/.exec(text.substring(i));
  if (!keyMatch) return null;
  const key = keyMatch[0];
  i += key.length;

  // Expect =
  while (i < text.length && /\s/.test(text[i])) i++;
  if (text[i] !== '=') return null;
  i++;
  while (i < text.length && /\s/.test(text[i])) i++;

  // Value: "..." | '...' | {...}
  const vChar = text[i];
  if (vChar === '"' || vChar === "'") {
    const close = text.indexOf(vChar, i + 1);
    if (close === -1) return null;
    return {
      key,
      value: text.substring(i + 1, close),
      valueIsObject: false,
      end: close + 1,
    };
  }
  if (vChar === '{') {
    const close = scanBalancedObject(text, i);
    if (close === -1) return null;
    return {
      key,
      value: text.substring(i, close), // includes braces
      valueIsObject: true,
      end: close,
    };
  }
  return null;
}

/**
 * Parse one compose_* tag starting at the literal `<` at `start`. Returns the
 * parsed entry + end offset, or null if the pattern is malformed/incomplete.
 */
function parseOneTag(
  text: string,
  start: number,
  tagName: TagName,
): ParsedCompose | null {
  const tagStart = `<${tagName}`;
  if (!text.startsWith(tagStart, start)) return null;
  // Next char after tag-name must be whitespace or `>` or `/`
  const after = text[start + tagStart.length];
  if (after !== undefined && !/[\s>/]/.test(after)) return null;

  let i = start + tagStart.length;
  const attrs: Record<string, unknown> = {};
  let template: string | undefined;

  while (i < text.length) {
    // Skip whitespace
    while (i < text.length && /\s/.test(text[i])) i++;
    if (i >= text.length) return null;

    // End of tag?
    if (text[i] === '>') {
      const end = i + 1;
      // compose_app: template required, params merged. compose_visual: take
      // all attrs as params (chart_type, data, etc).
      if (tagName === 'compose_app') {
        if (!template) return null;
        if (!attrs.params || typeof attrs.params !== 'object') return null;
        return {
          toolName: 'compose_app',
          template,
          params: attrs.params as Record<string, unknown>,
          start,
          end,
        };
      }
      // compose_visual — collapse attributes into params. Real Sonnet 4.6
      // emission uses `template="bar_chart"` (compose_app-style), so the
      // string-attr `template` MUST land in params too. Slug priority:
      // template > chart_type > type > 'unknown'.
      const params = { ...attrs } as Record<string, unknown>;
      if (template) params.template = template;
      const t =
        typeof params.template === 'string'
          ? params.template
          : typeof params.chart_type === 'string'
            ? params.chart_type
            : typeof params.type === 'string'
              ? params.type
              : 'unknown';
      return {
        toolName: 'compose_visual',
        template: t,
        params,
        start,
        end,
      };
    }
    if (text[i] === '/' && text[i + 1] === '>') {
      // self-closing — same handling as `>`
      const end = i + 2;
      if (tagName === 'compose_app') {
        if (!template || !attrs.params) return null;
        return {
          toolName: 'compose_app',
          template,
          params: attrs.params as Record<string, unknown>,
          start,
          end,
        };
      }
      const params = { ...attrs } as Record<string, unknown>;
      if (template) params.template = template;
      return {
        toolName: 'compose_visual',
        template:
          typeof params.template === 'string'
            ? params.template
            : (params.chart_type as string) || 'unknown',
        params,
        start,
        end,
      };
    }

    const attr = parseAttribute(text, i);
    if (!attr) return null;

    if (attr.valueIsObject) {
      // Object-literal value — must parse as JSON.
      //
      // Real-world Sonnet-4.6 emission uses JSX double-brace syntax:
      //   data={{ "x":[...], "y":[...] }}
      // The outer `{}` is JSX interpolation; the inner is the object literal.
      // scanBalancedObject already captured the full outer-to-outer slice;
      // strip one layer and retry when raw JSON.parse fails on `{{...}}`.
      let parsed: unknown = undefined;
      try {
        parsed = JSON.parse(attr.value);
      } catch {
        const stripped = stripDoubleBrace(attr.value);
        if (stripped !== null) {
          try {
            parsed = JSON.parse(stripped);
          } catch {
            return null;
          }
        } else {
          return null;
        }
      }
      attrs[attr.key] = parsed as Record<string, unknown>;
    } else {
      // String-literal value
      if (attr.key === 'template') {
        template = attr.value;
      } else {
        attrs[attr.key] = attr.value;
      }
    }
    i = attr.end;
  }
  return null;
}

/**
 * Scan `text` for all `<compose_app ...>` and `<compose_visual ...>` patterns
 * and return parsed entries in source order.
 *
 * Tolerates patterns inside ```fenced``` code blocks — fences are transparent
 * to the scanner (they're just text).
 */
export function parseInlineComposePatterns(text: string): ParsedCompose[] {
  const results: ParsedCompose[] = [];
  let i = 0;
  while (i < text.length) {
    if (text[i] !== '<') {
      i++;
      continue;
    }
    let parsed: ParsedCompose | null = null;
    for (const tag of TAG_NAMES) {
      parsed = parseOneTag(text, i, tag);
      if (parsed) break;
    }
    if (parsed) {
      results.push(parsed);
      i = parsed.end;
    } else {
      i++;
    }
  }
  return results;
}

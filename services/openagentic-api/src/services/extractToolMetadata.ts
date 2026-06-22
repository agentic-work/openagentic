/**
 * extractToolMetadata — pure helper that pulls a per-tool metadata
 * block out of an MCP proxy tool definition into a canonical, validated
 * shape. Drives:
 *   - persistence into MCPTool.metadata (jsonb column on mcp_tools)
 *   - golden-prompt expansion into the search-embedding text so a
 *     user prompt phrased like "list my azure subs" rank-boosts the
 *     `azure_list_subscriptions` tool through Stage 4 of the cascade
 *   - HITL gating + cost ranking downstream of the indexer
 *
 * Intentionally permissive on missing fields and strict on type:
 *   - missing field        → undefined
 *   - wrong-type field     → undefined (filtered, not coerced)
 *   - invalid-enum field   → undefined
 *
 * The indexer must keep importing valid tools even when one tool's
 * metadata block is malformed; we never throw.
 */

const VALID_DESTRUCTIVENESS = new Set(['read-only', 'mutating', 'destructive']);
const VALID_HITL_RISK = new Set(['low', 'medium', 'high']);
const VALID_COST = new Set(['free', 'metered', 'expensive']);

export interface ToolMetadata {
  category: string | undefined;
  destructiveness: 'read-only' | 'mutating' | 'destructive' | undefined;
  hitlRisk: 'low' | 'medium' | 'high' | undefined;
  requiresConsent: boolean | undefined;
  cost: 'free' | 'metered' | 'expensive' | undefined;
  idempotent: boolean | undefined;
  averageLatencyMs: number | undefined;
  goldenPrompts: string[];
}

export type InferCategoryFn = (toolName: string, description: string) => string | undefined;

interface MaybeTool {
  function?: {
    name?: string;
    description?: string;
    metadata?: unknown;
    annotations?: unknown;
    _meta?: unknown;
  };
  metadata?: unknown;
  annotations?: unknown;
  _meta?: unknown;
}

/**
 * Pick the metadata source for a tool. Search order (highest priority first):
 *
 *   1. tool._meta             (MCP spec canonical — FastMCP @mcp.tool(meta=...)
 *                              serializes here. Spec says: "_meta is server-defined
 *                              metadata, not behavior hints; safe for cascade trust.")
 *   2. tool.metadata          (chat-side native shape — older MCPs)
 *   3. tool.function.metadata (some spec-shape servers nest under .function)
 *   4. tool.annotations       (FastMCP @mcp.tool(annotations=...) — spec says
 *                              "annotations are HINTS clients should not make
 *                              decisions on", so we read here only as fallback;
 *                              ToolAnnotations.additionalProperties=true means
 *                              custom keys are tolerated but not authoritative)
 *   5. tool.function.annotations
 *
 * Migration note: previous versions of openagentic-* MCPs declared cascade-relevant
 * fields (category, hitlRisk, goldenPrompts) under `annotations`. They flow
 * through the proxy unchanged, so the cascade still picks them up via the
 * fallback path. New MCPs SHOULD use `meta=` (FastMCP) → `_meta` (wire) for
 * authoritative fields.
 */
function pickMetadata(tool: MaybeTool): Record<string, unknown> {
  const candidates: ReadonlyArray<unknown> = [
    tool?._meta,
    tool?.function?._meta,
    tool?.metadata,
    tool?.function?.metadata,
    tool?.annotations,
    tool?.function?.annotations,
  ];
  for (const c of candidates) {
    if (c && typeof c === 'object' && !Array.isArray(c)) {
      return c as Record<string, unknown>;
    }
  }
  return {};
}

function pickEnum<T extends string>(
  raw: unknown,
  allowed: ReadonlySet<string>,
): T | undefined {
  return typeof raw === 'string' && allowed.has(raw) ? (raw as T) : undefined;
}

function pickStrictBoolean(raw: unknown): boolean | undefined {
  return typeof raw === 'boolean' ? raw : undefined;
}

function pickPositiveInt(raw: unknown): number | undefined {
  if (typeof raw !== 'number' || !Number.isFinite(raw) || raw < 0) return undefined;
  return Math.round(raw);
}

function pickGoldenPrompts(raw: unknown): string[] {
  if (!Array.isArray(raw)) return [];
  return raw.filter((p): p is string => typeof p === 'string' && p.trim().length > 0);
}

export function extractToolMetadata(
  tool: MaybeTool,
  inferCategory: InferCategoryFn,
): ToolMetadata {
  const md = pickMetadata(tool);
  const toolName = tool?.function?.name ?? '';
  const description = tool?.function?.description ?? '';

  const declaredCategory =
    typeof md.category === 'string' && md.category.trim().length > 0
      ? md.category
      : undefined;
  const category = declaredCategory ?? inferCategory(toolName, description);

  return {
    category,
    destructiveness: pickEnum(md.destructiveness, VALID_DESTRUCTIVENESS),
    hitlRisk: pickEnum(md.hitlRisk, VALID_HITL_RISK),
    requiresConsent: pickStrictBoolean(md.requiresConsent),
    cost: pickEnum(md.cost, VALID_COST),
    idempotent: pickStrictBoolean(md.idempotent),
    averageLatencyMs: pickPositiveInt(md.averageLatencyMs),
    goldenPrompts: pickGoldenPrompts(md.goldenPrompts),
  };
}

/**
 * Build the input string for the tool's search embedding. Concatenates
 * the canonical fields plus golden prompts so a user query that sounds
 * like a goldenPrompt scores high in pgvector cosine search even when
 * the tool name + description don't share keywords with the query.
 *
 * 2026-05-11 deepening — also accepts the curated overlay fields
 * (when_to_use, aliases, usage_examples). Including these dramatically
 * improves cosine recall for queries phrased in alias terms:
 *   "show me my azure subs" → embeds `subs` + `azure subs` →
 *   hits azure_list_subscriptions in top-3.
 *
 * Order matters for cosine search: tool_name → description → category →
 *   when_to_use → aliases (each alias token as its own bag-of-words entry)
 *   → usage_examples (prompt field only — rationale stays metadata)
 *   → goldenPrompts.
 */
export function toSearchEmbeddingText(args: {
  toolName: string;
  description: string;
  category: string | undefined;
  goldenPrompts: ReadonlyArray<string>;
  when_to_use?: string;
  aliases?: string;
  usage_examples?: ReadonlyArray<{ prompt?: string; picked_because?: string }>;
}): string {
  const parts: string[] = [];
  if (args.toolName) parts.push(args.toolName);
  if (args.description) parts.push(args.description);
  if (args.category) parts.push(args.category);
  if (args.when_to_use && args.when_to_use.trim().length > 0) {
    parts.push(args.when_to_use.trim());
  }
  if (args.aliases && args.aliases.trim().length > 0) {
    // Split aliases so each contributes its own token to the embed.
    // Pure string ops — no regex.
    for (const alias of args.aliases.split(',')) {
      const trimmed = alias.trim();
      if (trimmed.length > 0) parts.push(trimmed);
    }
  }
  if (Array.isArray(args.usage_examples)) {
    for (const ex of args.usage_examples) {
      if (ex && typeof ex.prompt === 'string' && ex.prompt.trim().length > 0) {
        parts.push(ex.prompt.trim());
      }
    }
  }
  for (const prompt of args.goldenPrompts) {
    if (typeof prompt === 'string' && prompt.trim().length > 0) {
      parts.push(prompt);
    }
  }
  return parts.join(' ').trim();
}

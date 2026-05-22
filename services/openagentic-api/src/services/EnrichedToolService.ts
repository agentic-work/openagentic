/**
 * EnrichedToolService — Postgres-backed SoT for per-T1-tool metadata.
 *
 * Spec: docs/superpowers/specs/2026-05-09-v3-enterprise-chatmode-design.md §5
 * Plan: docs/superpowers/plans/2026-05-09-v3-enterprise-chatmode-implementation.md (Phase 5)
 *
 * Read by Phase 4's envelope splitter via `getBySlug` + `toMetadata` to populate
 * `ToolResult._meta.outputTemplate` and the per-tool `truncate_summary` fn.
 *
 * Database fields are snake_case (matches monorepo convention — every other
 * Prisma model in this schema uses snake_case fields with @@map for table
 * naming). Service methods that produce dispatcher-shaped metadata translate
 * to camelCase so the splitter contract (`outputTemplate`, `truncate_summary`)
 * stays stable.
 */

import type { EnrichedTool, PrismaClient } from '@prisma/client';
import type { StructuredContent } from '../types/ToolResult.js';

/**
 * Shape consumed by Phase 4's `splitEnvelope`. Matches the
 * `EnrichedToolEntry` interface in `dispatchTool.ts`. Generated from a
 * stored `EnrichedTool` row by `toMetadata()`.
 */
export interface EnrichedToolMetadata {
  slug: string;
  outputTemplate?: string;
  truncate_summary?: (raw: unknown) => StructuredContent;
}

export interface EnrichedToolUpsertInput {
  slug: string;
  display_name: string;
  description: string;
  output_template?: string | null;
  truncate_summary?: string | null;
  input_schema: any;
  output_schema?: any | null;
  mcp_server?: string | null;
  category: string;
  tier?: number;
  enabled?: boolean;
  created_by?: string | null;
  updated_by?: string | null;
}

export class EnrichedToolService {
  constructor(private prisma: Pick<PrismaClient, 'enrichedTool'>) {}

  /** Fetch a single enriched-tool row by slug. */
  async getBySlug(slug: string): Promise<EnrichedTool | null> {
    return this.prisma.enrichedTool.findUnique({ where: { slug } });
  }

  /**
   * List enabled rows with optional filtering. Used at pipeline construction
   * time by `runChat` to bulk-load every enabled tool into a Map cache.
   */
  async listEnabled(opts?: { category?: string; mcpServer?: string }): Promise<EnrichedTool[]> {
    return this.prisma.enrichedTool.findMany({
      where: {
        enabled: true,
        ...(opts?.category ? { category: opts.category } : {}),
        ...(opts?.mcpServer ? { mcp_server: opts.mcpServer } : {}),
      },
      orderBy: [{ category: 'asc' }, { display_name: 'asc' }],
    });
  }

  /** List ALL rows (enabled + disabled) — used by admin UI and seeder. */
  async listAll(): Promise<EnrichedTool[]> {
    return this.prisma.enrichedTool.findMany({
      orderBy: [{ category: 'asc' }, { display_name: 'asc' }],
    });
  }

  /**
   * Upsert by slug. New rows take all fields from input; existing rows
   * get every input field overwritten EXCEPT `created_at` / `created_by`.
   */
  async upsert(input: EnrichedToolUpsertInput): Promise<EnrichedTool> {
    const { slug, ...rest } = input;
    return this.prisma.enrichedTool.upsert({
      where: { slug },
      create: { slug, ...rest } as any,
      update: rest as any,
    });
  }

  /** Toggle the `enabled` flag in-place; sets `updated_by` if provided. */
  async toggle(slug: string, enabled: boolean, updatedBy?: string): Promise<EnrichedTool> {
    return this.prisma.enrichedTool.update({
      where: { slug },
      data: { enabled, ...(updatedBy ? { updated_by: updatedBy } : {}) } as any,
    });
  }

  /** Hard delete. Caller is responsible for writing an audit log entry. */
  async delete(slug: string): Promise<void> {
    await this.prisma.enrichedTool.delete({ where: { slug } });
  }

  /**
   * Convert a stored row to the metadata shape Phase 4's `splitEnvelope`
   * expects. The `truncate_summary` fn is compiled from the stored template
   * string via `compileTruncateSummary`.
   */
  toMetadata(row: EnrichedTool): EnrichedToolMetadata {
    return {
      slug: row.slug,
      outputTemplate: row.output_template ?? undefined,
      truncate_summary: row.truncate_summary
        ? compileTruncateSummary(row.truncate_summary)
        : undefined,
    };
  }
}

/**
 * Compile a stored truncate_summary template string into an executable
 * fn(raw) → StructuredContent. Template syntax:
 *
 *   "{{count}} items. First: {{items.[0].name}}"
 *
 * Path resolution supports dot-notation (`a.b.c`) and bracket-array
 * indices (`items.[0].name`). Unknown paths render as "?".
 *
 * 2026-05-11 — auto-token upgrade. For real MCP tool results that don't
 * carry a literal `count` property (most cloud-list calls return arrays
 * directly, or a root object wrapping a single array), `{{count}}` and
 * `{{sample_names}}` now auto-resolve from the raw shape:
 *
 *   - `{{count}}`         → length of the first top-level array (or raw
 *                           itself if it's an array)
 *   - `{{sample_names}}`  → first 5 items' `name` field, comma-joined
 *
 * Raw-side dot-path lookup STILL WINS over auto-tokens — if raw has a
 * literal `count` property, `{{count}}` resolves to that. Back-compat
 * preserved for existing tests + admin-edited templates.
 *
 * Exported for reuse by tests / admin-UI live-preview rendering.
 */
export function compileTruncateSummary(template: string): (raw: unknown) => StructuredContent {
  return (raw: unknown) => {
    const summary = template.replace(/\{\{\s*([^}]+?)\s*\}\}/g, (_match, path) => {
      const key = String(path).trim();
      try {
        // 1. Raw-side dot-path always wins (back-compat).
        const v = getPath(raw, key);
        if (v != null) {
          if (typeof v === 'object') {
            try {
              return JSON.stringify(v);
            } catch {
              return '?';
            }
          }
          return String(v);
        }
        // 2. Auto-tokens — computed from the raw shape when the raw-side
        // lookup didn't resolve. Only fires for the well-known token names.
        const auto = resolveAutoToken(raw, key);
        if (auto != null) return auto;
        return '?';
      } catch {
        return '?';
      }
    });
    return { summary, truncated: true };
  };
}

/**
 * Compute a value for an auto-token (count / sample_names / sample_count)
 * given the raw payload's shape. Returns undefined when the token name
 * isn't recognized or the shape can't satisfy it.
 *
 * Resolution rules:
 *   - count: length of the first top-level array property in raw, or raw
 *     itself when raw is an array.
 *   - sample_names: first 5 items' `name` field comma-joined; falls back
 *     to JSON.stringify of the row when there's no `name`.
 *
 * Kept private — admin-UI templates can rely on the contract via the
 * stable {{...}} placeholders without coupling to this helper directly.
 */
function resolveAutoToken(raw: unknown, key: string): string | undefined {
  if (raw == null) return undefined;

  const sourceArr = findPrimaryArray(raw);

  if (key === 'count') {
    return sourceArr ? String(sourceArr.length) : undefined;
  }

  if (key === 'sample_names') {
    if (!sourceArr) return undefined;
    const slice = sourceArr.slice(0, 5);
    const names = slice.map((row) => {
      if (row == null) return '';
      if (typeof row === 'object' && 'name' in (row as Record<string, unknown>)) {
        return String((row as Record<string, unknown>).name ?? '');
      }
      return typeof row === 'string' ? row : JSON.stringify(row);
    });
    return names.filter(Boolean).join(', ');
  }

  return undefined;
}

/**
 * Find the "primary" array in a raw tool result. Returns the array
 * itself when raw is an array; otherwise scans the top-level object for
 * the first array-valued property. Used by `resolveAutoToken` so
 * `{{count}}` / `{{sample_names}}` work without per-tool config.
 */
function findPrimaryArray(raw: unknown): unknown[] | undefined {
  if (Array.isArray(raw)) return raw;
  if (raw && typeof raw === 'object') {
    for (const v of Object.values(raw as Record<string, unknown>)) {
      if (Array.isArray(v)) return v;
    }
  }
  return undefined;
}

/**
 * Lodash.get-style path resolver supporting:
 *   - dot syntax:        a.b.c
 *   - bracket index:     items.[0].name  /  items[0].name
 *
 * Returns undefined for any miss; caller substitutes "?".
 */
function getPath(obj: unknown, path: string): unknown {
  if (obj == null) return undefined;
  // Tokenize: split on '.', then strip leading '[' and trailing ']' from each part.
  const parts = path
    .split('.')
    .flatMap(part => {
      // Handle "items[0]" → ["items", "0"] AND "[0]" → ["0"]
      const tokens: string[] = [];
      let buf = '';
      for (let i = 0; i < part.length; i++) {
        const ch = part[i];
        if (ch === '[') {
          if (buf) { tokens.push(buf); buf = ''; }
        } else if (ch === ']') {
          if (buf) { tokens.push(buf); buf = ''; }
        } else {
          buf += ch;
        }
      }
      if (buf) tokens.push(buf);
      return tokens;
    })
    .filter(Boolean);

  return parts.reduce<unknown>((acc, key) => {
    if (acc == null) return undefined;
    if (Array.isArray(acc)) {
      const idx = Number(key);
      return Number.isFinite(idx) ? acc[idx] : undefined;
    }
    if (typeof acc === 'object') return (acc as Record<string, unknown>)[key];
    return undefined;
  }, obj);
}

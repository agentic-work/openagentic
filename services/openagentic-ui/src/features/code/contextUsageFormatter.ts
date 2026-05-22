export interface ContextUsagePayload {
  totalTokens?: number;
  rawMaxTokens?: number;
  percentage?: string | number;
  model?: string;
  categories?: Array<{ name: string; tokens: number }>;
  mcpTools?: Array<{ name: string; serverName: string; tokens: number }>;
  agents?: Array<{ agentType: string; source: string; tokens: number }>;
  skills?: { tokens: number; skillFrontmatter?: Array<{ name: string; source: string; tokens: number }> };
  memoryFiles?: Array<{ type: string; path: string; tokens: number }>;
}

function fmtTokens(n: number | undefined): string {
  if (typeof n !== 'number' || !Number.isFinite(n)) return '?';
  if (n >= 1000) return `${(n / 1000).toFixed(1)}k`;
  return String(n);
}

/**
 * Render the payload as a one-screen markdown summary suitable for a
 * codemode chat transcript row. Falls back gracefully on missing fields.
 */
export function formatContextUsage(payload: ContextUsagePayload): string {
  const total = payload.totalTokens;
  const max = payload.rawMaxTokens;
  const pct = payload.percentage;

  let out = '## Context Usage\n\n';
  if (payload.model) {
    out += `**Model:** ${payload.model}  \n`;
  }
  out += `**Tokens:** ${fmtTokens(total)} / ${fmtTokens(max)}`;
  if (pct !== undefined && pct !== null && String(pct).length > 0) {
    out += ` (${pct}%)`;
  }
  out += '\n';

  // Categories table — show non-empty rows only. The daemon emits
  // synthetic categories ("Free space", "Autocompact buffer") that
  // would just clutter the codemode transcript.
  const visibleCategories = (payload.categories ?? []).filter(
    (c) => c.tokens > 0 && c.name !== 'Free space' && c.name !== 'Autocompact buffer',
  );
  if (visibleCategories.length > 0) {
    out += '\n### Estimated usage by category\n\n';
    out += '| Category | Tokens |\n|----------|--------|\n';
    for (const c of visibleCategories) {
      out += `| ${c.name} | ${fmtTokens(c.tokens)} |\n`;
    }
  }

  return out.trimEnd();
}

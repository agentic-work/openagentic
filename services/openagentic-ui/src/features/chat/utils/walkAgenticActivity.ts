/**
 * DOM walker for AgenticActivityStream — pure function (Phase 0.2).
 *
 * the design notes
 *
 * Walks an `[data-aas-mounted]` (or `[data-testid="agentic-activity-stream"]`)
 * subtree and emits a structured trace of the chronologically-ordered visible
 * children. The same trace shape is produced for:
 *   - mid-stream snapshot
 *   - post-stream snapshot
 *   - post-reload snapshot
 *
 * All three must match for persistence + interleave to hold. The trace is
 * also consumable by the contract diff (Phase 0.3) — same ordered-subsequence
 * matcher works on DomTrace as on Timeline.
 *
 * Selector taxonomy (per the existing AgenticActivityStream + mocks):
 *   - `.inline-thinking-natural`      → kind='thinking'
 *   - `.interleaved-text-block`       → kind='text'
 *   - `[data-testid="tool-card"]` OR `.tool` → kind='tool'
 *   - `[data-testid="parallel-tool-group"]` → kind='tool-group' (wraps tool kinds)
 *   - `.cm-subagent-card`, `.subagent`, `[data-testid="subagent-card"]` → kind='subagent'
 *   - `.cm-streaming-table`, `[data-testid="streaming-table"]` → kind='streaming-table'
 *   - `.viz`, `[data-testid="viz"]` OR `[data-app-renderer="true"]` → kind='viz'
 *   - `.followups`, `[data-testid="followups"]` → kind='followups'
 *
 * Anything unrecognized inside the AAS subtree is emitted as kind='other'
 * with its tag name + a class snippet so we can refine the taxonomy without
 * losing data.
 */

export type DomTraceKind =
  | 'thinking'
  | 'text'
  | 'tool'
  | 'tool-group'
  | 'subagent'
  | 'streaming-table'
  | 'viz'
  | 'followups'
  | 'other';

export interface DomTraceEntry {
  kind: DomTraceKind;
  /** Tool name for `tool` kind, agent name for `subagent`, template slug for `viz`. */
  name?: string;
  /** ok / err / running for tool + subagent kinds. */
  status?: string;
  /** Visible text preview (first ~60 chars). */
  preview?: string;
  /** Duration label if rendered ("2.1s"). */
  durationLabel?: string;
  /** For tool-group, the count of children. */
  childCount?: number;
  /** Optional original CSS classes / tag for the `other` kind. */
  rawTag?: string;
  rawClass?: string;
}

export interface DomTrace {
  /** The full structured walk. */
  entries: DomTraceEntry[];
  /** True if the AAS root was found in the DOM. */
  mounted: boolean;
  /** Snapshot label — `mid-stream`, `post-stream`, `post-reload`, or custom. */
  label?: string;
}

const PREVIEW_MAX = 60;

function preview(node: Element | null | undefined): string | undefined {
  if (!node) return undefined;
  const txt = (node.textContent ?? '').replace(/\s+/g, ' ').trim();
  if (!txt) return undefined;
  return txt.length > PREVIEW_MAX ? txt.slice(0, PREVIEW_MAX) + '…' : txt;
}

function attr(node: Element, name: string): string | undefined {
  const v = node.getAttribute(name);
  return v === null ? undefined : v;
}

const AAS_SELECTORS = [
  '[data-aas-mounted="true"]',
  '[data-testid="agentic-activity-stream"]',
  '.cm-aas',
  '.agentic-activity-stream',
];

function findAasRoot(scope: ParentNode): Element | null {
  for (const sel of AAS_SELECTORS) {
    const el = scope.querySelector(sel);
    if (el) return el;
  }
  return null;
}

/**
 * Classify a single element into one of the known kinds. Children of
 * tool-group are walked separately so we surface both the group and its
 * tools (the contract may match either level).
 */
function classify(el: Element): DomTraceEntry | null {
  if (el.matches('.inline-thinking-natural, [data-testid="inline-thinking-block"]')) {
    return {
      kind: 'thinking',
      preview: preview(el),
      durationLabel: attr(el, 'data-duration') ?? undefined,
    };
  }

  if (
    el.matches('.interleaved-text-block, [data-testid="interleaved-text-block"]')
  ) {
    return { kind: 'text', preview: preview(el) };
  }

  if (
    el.matches('[data-testid="parallel-tool-group"], .cm-tool-parallel')
  ) {
    const children = el.querySelectorAll(
      '[data-testid="tool-card"], .tool, [data-testid="parallel-tool-subcard"]',
    );
    return {
      kind: 'tool-group',
      childCount: children.length,
    };
  }

  if (
    el.matches(
      '[data-testid="tool-card"], .tool, [data-testid="parallel-tool-subcard"]',
    )
  ) {
    const name =
      attr(el, 'data-tool-name') ??
      el.querySelector('[data-testid="tool-name"], .t-name')?.textContent?.trim() ??
      undefined;
    const status =
      attr(el, 'data-tool-status') ??
      el.querySelector('[data-testid="tool-status"], .t-status')?.textContent?.trim() ??
      undefined;
    const durationLabel =
      el.querySelector('[data-testid="tool-timer"], .t-timer')?.textContent?.trim() ??
      undefined;
    return { kind: 'tool', name, status, durationLabel };
  }

  if (el.matches('.cm-subagent-card, .subagent, [data-testid="subagent-card"]')) {
    const name =
      attr(el, 'data-agent-name') ??
      el.querySelector('.sa-name, [data-testid="subagent-name"]')?.textContent?.trim() ??
      undefined;
    const status =
      el.querySelector('.sa-status, [data-testid="subagent-status"]')?.textContent?.trim() ??
      undefined;
    return { kind: 'subagent', name, status };
  }

  if (
    el.matches('.cm-streaming-table, [data-testid="streaming-table"]')
  ) {
    return { kind: 'streaming-table' };
  }

  if (
    el.matches('.viz, [data-testid="viz"], [data-app-renderer="true"]')
  ) {
    const template =
      attr(el, 'data-template') ??
      el.querySelector('.viz-head .badge, [data-testid="viz-template"]')
        ?.textContent?.trim() ??
      undefined;
    return { kind: 'viz', name: template };
  }

  if (el.matches('.followups, [data-testid="followups"]')) {
    const chips = el.querySelectorAll(
      '.chip, [data-testid="followup-chip"], [role="button"]',
    );
    return { kind: 'followups', childCount: chips.length };
  }

  return null;
}

/**
 * Walk the AAS root's direct chronological children. Tool-groups expand into
 * one parent entry + one entry per child tool (so contract matchers that
 * expect individual tool_use frames work the same way regardless of grouping).
 */
export function walkAgenticActivity(
  scope: ParentNode,
  label?: string,
): DomTrace {
  const root = findAasRoot(scope);
  if (!root) {
    return { entries: [], mounted: false, label };
  }

  const entries: DomTraceEntry[] = [];

  function walk(node: Element): void {
    const classified = classify(node);
    if (classified) {
      entries.push(classified);
      if (classified.kind === 'tool-group') {
        // Expand children of the group so contract tool_use frames match each tool.
        const tools = node.querySelectorAll(
          '[data-testid="tool-card"], .tool, [data-testid="parallel-tool-subcard"]',
        );
        for (const child of Array.from(tools)) {
          const childEntry = classify(child);
          if (childEntry) entries.push(childEntry);
        }
      }
      return;
    }
    // Unrecognized container — descend.
    for (const child of Array.from(node.children)) walk(child);
  }

  for (const child of Array.from(root.children)) walk(child);

  // If we walked everything and found nothing recognizable, emit one `other`
  // entry per direct child so the contract diff can report what was actually
  // there (vs. silently returning an empty trace).
  if (entries.length === 0) {
    for (const child of Array.from(root.children)) {
      entries.push({
        kind: 'other',
        rawTag: child.tagName.toLowerCase(),
        rawClass: child.getAttribute('class') ?? undefined,
        preview: preview(child),
      });
    }
  }

  return { entries, mounted: true, label };
}

/**
 * Compare two DOM traces (e.g. post-stream vs post-reload) — returns true
 * iff the sequence of (kind, name) pairs matches exactly. Strict shape match
 * for the persistence-across-reload assertion.
 */
export function tracesEqual(a: DomTrace, b: DomTrace): boolean {
  if (a.entries.length !== b.entries.length) return false;
  for (let i = 0; i < a.entries.length; i += 1) {
    const ea = a.entries[i];
    const eb = b.entries[i];
    if (ea.kind !== eb.kind) return false;
    // Tool/viz/subagent — name should match if either side has one.
    if (ea.name !== eb.name) return false;
  }
  return true;
}

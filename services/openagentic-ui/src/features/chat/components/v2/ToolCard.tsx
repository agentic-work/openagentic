import React, { useEffect, useMemo, useState } from 'react';
import { JsonView } from './JsonView.js';
import { FrameRendererRegistry } from './FrameRendererRegistry.js';
import { VizPanel } from './VizPanel.js';

/**
 * Mock-07 lines 77-79, 190, 201, 212 — cost tools render an inline
 * RESULT preview strip:
 *
 *   <div class="result-preview"><div class="summary">
 *     <span>30d <b>$42,118</b></span>
 *     <span>prior <b>$28,943</b></span>
 *     <span>Δ <b>+$13,175</b></span>
 *     <span>+45.5%</span>
 *   </div></div>
 *
 * Heuristic: result object exposes `{last30, prior30}` OR
 * `{window_total, prior_window_total}` (real-API shapes). Numbers fixed
 * to USD-no-decimals. Returns null when the shape doesn't match — the
 * caller falls through to the existing JsonView render.
 */
function pickNumber(obj: Record<string, unknown>, ...keys: string[]): number | null {
  for (const k of keys) {
    const v = obj[k];
    if (typeof v === 'number' && Number.isFinite(v)) return v;
  }
  return null;
}

export function extractCostDelta(
  result: unknown,
): { last30: number; prior30: number } | null {
  if (!result || typeof result !== 'object' || Array.isArray(result)) return null;
  const obj = result as Record<string, unknown>;
  const last30 = pickNumber(obj, 'last30', 'window_total', 'last_30_days', 'last30Days');
  const prior30 = pickNumber(obj, 'prior30', 'prior_window_total', 'prior_30_days', 'prior30Days');
  if (last30 == null || prior30 == null) return null;
  return { last30, prior30 };
}

function fmtUsd0(n: number): string {
  const sign = n < 0 ? '-' : '';
  const abs = Math.abs(Math.round(n));
  return `${sign}$${abs.toLocaleString('en-US')}`;
}

function fmtUsdDelta(n: number): string {
  const sign = n >= 0 ? '+' : '-';
  const abs = Math.abs(Math.round(n));
  return `${sign}$${abs.toLocaleString('en-US')}`;
}

export function formatCostDeltaPreview(result: unknown): React.ReactNode | null {
  const parsed = extractCostDelta(result);
  if (!parsed) return null;
  const { last30, prior30 } = parsed;
  const delta = last30 - prior30;
  const pct = prior30 === 0 ? null : (delta / prior30) * 100;
  const pctLabel = pct == null
    ? '—'
    : `${pct >= 0 ? '+' : ''}${pct.toFixed(1)}%`;
  return (
    <div className="cm-result-preview" data-testid="cost-delta-preview">
      <div className="cm-summary">
        <span>30d <b>{fmtUsd0(last30)}</b></span>
        <span>prior <b>{fmtUsd0(prior30)}</b></span>
        <span>Δ <b>{fmtUsdDelta(delta)}</b></span>
        <span>{pctLabel}</span>
      </div>
    </div>
  );
}

/**
 * Mock-07 lines 58-59 — per-category coloured left-border on .tool.
 *   azure_*           → --cm-cloud
 *   k8s_* / kubectl_* → --cm-k8s
 *   aws_*             → --cm-fs
 *   gcp_* / vertex_*  → --cm-k8s (GCP shares the violet)
 *   default           → --cm-accent
 *
 * Returns the attribute value used by .cm-tool[data-tool-cat='…'] in
 * chatmode-v2.css so the colours stay in CSS (token-resolved, theme-aware).
 */
export function classifyToolCategory(name: string): 'azure' | 'k8s' | 'aws' | 'gcp' | 'default' {
  const n = (name || '').toLowerCase();
  if (n.startsWith('azure_')) return 'azure';
  if (n.startsWith('aws_')) return 'aws';
  if (n.startsWith('k8s_') || n.startsWith('kubectl_')) return 'k8s';
  if (n.startsWith('gcp_') || n.startsWith('vertex_')) return 'gcp';
  return 'default';
}

const COST_TOOL_RE = /cost|billing|spend/i;
export function isCostTool(name: string): boolean {
  return COST_TOOL_RE.test(name || '');
}

/**
 * Sev-0 #4 (Q1 live drive 2026-05-15) — running-state input preview.
 * While the tool is in flight, surface a one-line preview of the args so
 * the user knows WHICH params got passed without expanding the card body.
 * Rendered on a SEPARATE DOM hook (data-testid="tool-running-preview")
 * from the result-summary span so the two contracts don't conflict.
 *
 * Heuristic:
 *   - input null/undefined/not-object → null (no preview)
 *   - input is empty object           → null
 *   - first key with a short scalar   → "key: value" (value truncated to 80)
 *   - no scalar keys, only objects    → "N args" fallback
 */
export function summarizeToolInput(input: unknown): string | null {
  if (input == null) return null;
  // #868 Q2 regression fix (2026-05-23): during the `running` state,
  // `inputDeltaContent` is a STRING (partial or complete JSON) from
  // `tool_use_input_delta` frames — see ToolCallCard.tsx:62-65 and
  // chatLoop/AnthropicProvider input_json_delta accumulator. The
  // earlier `typeof input !== 'object'` guard returned null for the
  // entire user-visible "Running…" window, so parallel fan-out cards
  // (e.g. 6× aws_list_iam_attached_user_policies UserName=<each>) all
  // rendered identically and looked like retry-spam. Real-model live
  // evidence: Q2 on 0.7.1-49dada91 with gpt-oss:20b.
  if (typeof input === 'string') {
    const s = input.trim();
    if (!s) return null;
    // Try strict JSON parse first (complete arg blob).
    try {
      return summarizeToolInput(JSON.parse(s));
    } catch {
      // Partial/streaming JSON — extract first quoted-string field
      // via regex so the user sees SOMETHING that differentiates the
      // call (UserName="blitz", subscription_id="6ed638e7…", etc).
      const kv = s.match(/"([A-Za-z_][\w-]*)"\s*:\s*"([^"]{1,80})"/);
      if (kv) return `${kv[1]}: ${kv[2]}`;
      const nkv = s.match(/"([A-Za-z_][\w-]*)"\s*:\s*(-?\d+(?:\.\d+)?|true|false)/);
      if (nkv) return `${nkv[1]}: ${nkv[2]}`;
      return null;
    }
  }
  if (typeof input !== 'object') return null;
  const obj = input as Record<string, unknown>;
  const keys = Object.keys(obj);
  if (keys.length === 0) return null;
  for (const key of keys) {
    const v = obj[key];
    if (typeof v === 'string' || typeof v === 'number' || typeof v === 'boolean') {
      const sv = String(v);
      const trimmed = sv.length > 80 ? `${sv.slice(0, 77)}…` : sv;
      return `${key}: ${trimmed}`;
    }
  }
  return `${keys.length} arg${keys.length === 1 ? '' : 's'}`;
}

/**
 * Mock 01 §863 — inline RESULT SUMMARY beside the OK status pill.
 *   <span class="t-status ok">· 2 results</span>
 *   <span class="t-status ok">· 14 VMs</span>
 *
 * Heuristic for deriving a one-line summary from the tool result so the
 * user can read the gist without expanding the card body.
 */
export function summarizeToolResult(result: unknown): string | null {
  if (result == null) return null;
  if (Array.isArray(result)) {
    return `${result.length} item${result.length === 1 ? '' : 's'}`;
  }
  if (typeof result === 'object') {
    const obj = result as Record<string, unknown>;
    // Prefer the SoT array when present and non-empty — count fields can
    // drift from the array (live capture 2026-05-12: azure_list_subscriptions
    // returned `count: 0` with 2 entries in `subscriptions`; the array is the
    // truth). When the array is empty (or absent), fall back to count for
    // legitimate "N rows pre-paginated" cases.
    const arrKeys = Object.keys(obj).filter((k) => Array.isArray(obj[k]));
    if (arrKeys.length === 1) {
      const key = arrKeys[0];
      const arr = obj[key] as unknown[];
      if (arr.length > 0) {
        return `${arr.length} ${key}`;
      }
      // Empty array — see if there's a count that suggests pre-pagination.
      const countLikeEmpty = ['count', 'total', 'totalCount'].find(
        (k) => typeof obj[k] === 'number',
      );
      if (countLikeEmpty) {
        const n = obj[countLikeEmpty] as number;
        return `${n} ${key}`;
      }
      return `0 ${key}`;
    }
    // No companion array — use count if present.
    const countLike = ['count', 'total', 'totalCount'].find(
      (k) => typeof obj[k] === 'number',
    );
    if (countLike) {
      const n = obj[countLike] as number;
      return `${n} items`;
    }
  }
  return null;
}

/**
 * P2-7 of chatmode UX parity — chevron expand state survives reload.
 *
 * The mock keeps a card the user manually expanded (or collapsed) in that
 * state across re-renders even when the parent passes a different
 * `defaultExpanded`. We persist per-card state in sessionStorage when a
 * stable `cardId` is supplied (the wire tool_use_id is the natural key).
 * Without `cardId`, behavior is identical to the previous local-state
 * version — pure additive opt-in.
 */
const TOOL_CARD_EXPAND_KEY = 'cm-tool-card-expand';

function readExpanded(cardId: string | undefined): boolean | null {
  if (!cardId || typeof window === 'undefined') return null;
  try {
    const raw = window.sessionStorage.getItem(TOOL_CARD_EXPAND_KEY);
    if (!raw) return null;
    const map = JSON.parse(raw) as Record<string, boolean>;
    return typeof map[cardId] === 'boolean' ? map[cardId] : null;
  } catch {
    return null;
  }
}

function writeExpanded(cardId: string | undefined, expanded: boolean): void {
  if (!cardId || typeof window === 'undefined') return;
  try {
    const raw = window.sessionStorage.getItem(TOOL_CARD_EXPAND_KEY);
    const map: Record<string, boolean> = raw ? JSON.parse(raw) : {};
    map[cardId] = expanded;
    window.sessionStorage.setItem(TOOL_CARD_EXPAND_KEY, JSON.stringify(map));
  } catch {
    /* ignore quota / parse errors — persistence is best-effort */
  }
}

/**
 * Mock anatomy: `.tool` with `.t-head` + `.t-body` collapsibles and two
 * `.t-section` panels — INPUT (the tool_use args) and RESULT (the
 * tool_result payload). Fence-stripped JSON; status pill (.ok/.err);
 * monospace timer right-aligned. Reference: mocks/UX/01-cloud-ops.html
 * lines 271-355.
 *
 * Replaces EnhancedInlineToolCall.tsx — that component conflated tool
 * args with stream metadata and missed the INPUT/RESULT split entirely.
 *
 * State semantics:
 *   - status='running' → shimmer overlay via `.cm-tool.cm-running`
 *   - status='ok'      → green status text, RESULT visible on expand
 *   - status='err'     → red status text, error message in RESULT
 *
 * Defaults: card opens by default while running, auto-collapses on success
 * (matches the mock's "auto-collapse on tool cards — keep open by default
 * during work" behaviour the user already approved in #173).
 */

export type ToolStatus = 'running' | 'ok' | 'err';

export interface ToolCardProps {
  /** Tool name as shown in `.t-name` (monospace). */
  name: string;
  /** Visible status pill — `.ok` green / `.err` red / running ⇒ no class. */
  status: ToolStatus;
  /** Wall-clock timer, e.g. "0.41s". Tabular nums. */
  durationLabel?: string;
  /** Optional small icon node placed in `.t-ico`. Default = first letter of name. */
  icon?: React.ReactNode;
  /** The model's tool_use input arguments. JSON-rendered. */
  input?: unknown;
  /** The tool_result payload. JSON or string. */
  result?: unknown;
  /** Error message shown in RESULT when status='err'. */
  errorMessage?: string;
  /** Initial expand state (default: open while running, collapsed when done). */
  defaultExpanded?: boolean;
  /** Additional className. */
  className?: string;
  /**
   * P2-7 — when supplied, chevron expand state is persisted in
   * sessionStorage under this id (e.g. the wire tool_use_id) so manual
   * expand/collapse survives re-renders and brief navigations.
   */
  cardId?: string;
  /**
   * Audit L1-2 / Phase A3 — when set, look up
   * `FrameRendererRegistry.lookup(outputTemplate)` and render the
   * resolved component inside the RESULT panel (instead of the raw
   * JsonView fallback). Empty / unknown / missing slug falls through
   * to JsonView (StreamingMarkdown stub returns null so the section
   * still renders the JSON view for fallback templates).
   */
  outputTemplate?: string;
}

export function ToolCard({
  name,
  status,
  durationLabel,
  icon,
  input,
  result,
  errorMessage,
  defaultExpanded,
  className,
  cardId,
  outputTemplate,
}: ToolCardProps) {
  // P2-7 — restore persisted expand state if present, else fall back to
  // the default. Phase 3 (mock 10:257-282) — ok'd tools with structured
  // (object/array) result auto-expand so the JSON Input/Result panels
  // are visible without an extra click. Plain-text or missing results
  // stay collapsed.
  const isStructured = (v: unknown): boolean =>
    typeof v === 'object' && v !== null;
  // Sev-0 dup-render rip (2026-05-21) — when this tool's result feeds a
  // table primitive (the native `<StreamingTable>` mounts INLINE next to
  // the card via AAS's viz_render(template=table) branch), suppress the
  // auto-expand so the user doesn't see a JSON wall AND the table for
  // the same data. The user is the single owner of the
  // expand-this-tool-card decision when the data is already on-screen.
  // Explicit `defaultExpanded` and persisted user state still win — only
  // the implicit auto-open heuristic flips.
  const isTableOutput =
    outputTemplate === 'table' || outputTemplate === 'streaming_table';
  const autoOpen =
    !isTableOutput &&
    (status === 'running' || (status === 'ok' && isStructured(result)));
  const persisted = readExpanded(cardId);
  const [expanded, setExpandedState] = useState<boolean>(
    persisted ?? defaultExpanded ?? autoOpen,
  );

  // Persist on every change. Best-effort — sessionStorage quota errors
  // and absent `cardId` are silently ignored by writeExpanded.
  useEffect(() => {
    writeExpanded(cardId, expanded);
  }, [cardId, expanded]);

  const setExpanded = (next: boolean | ((prev: boolean) => boolean)) => {
    setExpandedState((prev) =>
      typeof next === 'function' ? (next as (p: boolean) => boolean)(prev) : next,
    );
  };

  const statusLabel =
    status === 'running'
      ? 'Running…'
      : status === 'ok'
      ? 'OK'
      : 'Failed';
  const statusClass =
    status === 'running' ? '' : status === 'ok' ? 'cm-ok' : 'cm-err';

  // Mock 01 §863 — inline result summary in the header so the user reads
  // the gist (·2 subscriptions, ·14 VMs) without expanding the card body.
  const resultSummary = useMemo(
    () => (status === 'ok' ? summarizeToolResult(result) : null),
    [status, result],
  );

  // Sev-0 #4 (2026-05-15) — live preview of input args while running. The
  // user reported "tool calls DO run there is still no short summary inline
  // with them" — this puts (e.g.) "tenant_id: phatold" beside "Running…"
  // so the gist of WHICH params got passed is readable mid-stream.
  const runningPreview = useMemo(
    () => (status === 'running' ? summarizeToolInput(input) : null),
    [status, input],
  );

  // Mock-07 cost-summary preview. When (a) the tool name matches the cost
  // family AND (b) the result has the {last30, prior30} shape, surface a
  // tight inline summary BOTH in the head status line ("· $42,118 last 30d")
  // AND in the RESULT panel (the full 4-span strip). When either condition
  // fails we fall through to the existing renderers.
  const costDelta = useMemo(
    () => (status === 'ok' && isCostTool(name) ? extractCostDelta(result) : null),
    [status, name, result],
  );
  const costPreviewNode = useMemo(
    () => (costDelta ? formatCostDeltaPreview(result) : null),
    [costDelta, result],
  );
  const costHeadSummary = costDelta
    ? `$${Math.round(costDelta.last30).toLocaleString('en-US')} last 30d`
    : null;

  // Per-category left-border (mock-07 lines 58-59). Drives a CSS hook
  // (.cm-tool[data-tool-cat='…']) instead of inline styles so the colour
  // resolves through tokens and stays theme-aware.
  const toolCategory = useMemo(() => classifyToolCategory(name), [name]);

  return (
    <div
      className={[
        'cm-tool',
        status === 'running' ? 'cm-running' : '',
        className || '',
      ]
        .filter(Boolean)
        .join(' ')}
      aria-expanded={expanded}
      data-tool-card
      data-tool-name={name}
      data-tool-status={status}
      data-tool-cat={toolCategory}
    >
      <button
        type="button"
        className="cm-t-head"
        aria-expanded={expanded}
        onClick={() => setExpanded((v) => !v)}
      >
        <span className="cm-t-ico" aria-hidden>
          {icon ?? name.charAt(0).toUpperCase()}
        </span>
        <span className="cm-t-name">{name}</span>
        <span className={`cm-t-status ${statusClass}`}>
          {statusLabel}
          {costHeadSummary && (
            <span
              data-testid="cost-head-summary"
              className="cm-t-status-summary"
              style={{ marginLeft: 6, opacity: 0.85 }}
            >
              · {costHeadSummary}
            </span>
          )}
          {!costHeadSummary && resultSummary && (
            <span className="cm-t-status-summary" style={{ marginLeft: 6, opacity: 0.85 }}>
              · {resultSummary}
            </span>
          )}
          {runningPreview && (
            <span
              data-testid="tool-running-preview"
              className="cm-t-running-preview"
              style={{ marginLeft: 6, opacity: 0.85, fontFamily: 'var(--font-mono)', fontSize: '0.9em' }}
            >
              · {runningPreview}
            </span>
          )}
        </span>
        {durationLabel && <span className="cm-t-timer">{durationLabel}</span>}
        <span className="cm-t-chev" aria-hidden>
          ›
        </span>
      </button>
      <div className="cm-t-body">
        {input !== undefined && (
          <section className="cm-t-section" data-testid="tool-input">
            <div className="cm-t-label">Input</div>
            <JsonView value={input} streaming={status === 'running'} />
          </section>
        )}
        {(result !== undefined || errorMessage) && (
          <section className="cm-t-section" data-testid="tool-result">
            <div className="cm-t-label">{status === 'err' ? 'Error' : 'Result'}</div>
            {status === 'err' ? (
              <pre className="cm-json" style={{ color: 'var(--cm-err)' }}>
                {errorMessage || 'Tool execution failed.'}
              </pre>
            ) : costPreviewNode ? (
              // Mock-07 cost tools — surface the {30d / prior / Δ / %} strip
              // INSTEAD of the raw JSON. The full JSON remains available via
              // the model's wire payload (read_large_result) for callers
              // that need the long form; the card stays compact.
              costPreviewNode
            ) : outputTemplate && FrameRendererRegistry.has(outputTemplate) ? (
              // Sprint Z.5 — wrap registered renderers in VizPanel so every
              // compose_visual / compose_app frame gets the mock-SoT chrome:
              //   .viz > .viz-head (ico + name + badge + timer) + renderer output.
              // Audit L1-2 / Phase A3 original dispatch preserved; only the
              // wrapper is new.
              (() => {
                const Renderer = FrameRendererRegistry.lookup(outputTemplate);
                return (
                  <VizPanel slug={outputTemplate} title={name} timer={durationLabel}>
                    <Renderer {...(typeof result === 'object' && result !== null ? result : { value: result })} />
                  </VizPanel>
                );
              })()
            ) : (
              <JsonView value={result} />
            )}
          </section>
        )}
      </div>
    </div>
  );
}

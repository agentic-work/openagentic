/**
 * GroundingVerdictChip (#940 P1, 2026-05-18)
 *
 * Renders a small inline chip below the final assistant text when the
 * model emitted a `Grounding: ...` verdict line under the grounding T1
 * mode (system-prompt addendum in runChat.ts). The chip surfaces the
 * verdict (verified / mixed / refuted / insufficient) plus the source
 * count parsed out of the parenthesized "(N sources)" segment.
 *
 * Theme: all colors via `var(--cm-*)` tokens — no hex literals
 * (CLAUDE.md rule 8b). Verified=success, mixed=warn, refuted=error,
 * insufficient=info, fall back to neutral cm-fg-2.
 */
import React from 'react';
import { SearchCheck } from '@/shared/icons';

export interface GroundingSource {
  url: string;
  title?: string;
}

export interface GroundingVerdict {
  /** verified | mixed | refuted | insufficient */
  status: 'verified' | 'mixed' | 'refuted' | 'insufficient';
  /** Source count parsed out of "(N sources)" — may be undefined for insufficient. */
  sources?: number;
  /** Counterpoint count parsed out of "M counterpoints" — only present for mixed. */
  counterpoints?: number;
  /** Raw matched line for debugging / a11y. */
  raw: string;
  /**
   * The one-sentence verdict claim the model emitted on a line of its own,
   * prefixed `Verdict:` (per the runChat.ts grounding-mode addendum, #942).
   * Undefined when the model did not emit a Verdict line — in that case the
   * chip shows only the status pill (legacy `Grounding: ...`-only path).
   */
  verdict?: string;
  /**
   * The actual URLs the model relied on. Surfaced from a
   * `<grounding-sources>[{url,title},...]</grounding-sources>` block that
   * the runChat.ts addendum instructs the model to emit immediately after
   * the verdict line. Undefined when no block was present (legacy turns)
   * OR when the block JSON failed to parse / contained no safe http(s) urls.
   */
  sourcesList?: GroundingSource[];
}

const STATUS_LINE = /^Grounding:\s+(verified by web|mixed|refuted|insufficient)(?:\s*\(([^)]+)\))?\s*$/m;
// #942 (2026-05-20) — the model's one-sentence verdict claim. The line is
// prefixed `Verdict:` and sits immediately above the `Grounding:` status
// line per the runChat.ts addendum. We match leading whitespace tolerantly
// (small models sometimes indent the line under a bullet) but require the
// claim text to contain at least one non-whitespace character — otherwise
// the chip would render an empty body.
const VERDICT_CLAIM_LINE = /^[ \t]*Verdict:[ \t]+(\S[^\n]*?)\s*$/m;
const SOURCES_BLOCK = /<grounding-sources>([\s\S]*?)<\/grounding-sources>/m;

/**
 * Parse the optional `<grounding-sources>` JSON block. Returns undefined
 * when the block is absent or its contents fail to parse. Drops items
 * whose `url` is not a string OR not http(s). `title` is optional and
 * coerced to a trimmed string.
 */
function parseSourcesBlock(text: string): GroundingSource[] | undefined {
  const m = text.match(SOURCES_BLOCK);
  if (!m) return undefined;
  let raw: unknown;
  try {
    raw = JSON.parse(m[1]);
  } catch {
    return undefined;
  }
  if (!Array.isArray(raw)) return undefined;
  const out: GroundingSource[] = [];
  for (const item of raw) {
    if (!item || typeof item !== 'object') continue;
    const url = (item as any).url;
    if (typeof url !== 'string') continue;
    // Only http(s) — defence against javascript:/data: payload smuggling.
    if (!/^https?:\/\//i.test(url)) continue;
    const titleRaw = (item as any).title;
    const title = typeof titleRaw === 'string' && titleRaw.trim().length > 0
      ? titleRaw.trim()
      : undefined;
    out.push(title ? { url, title } : { url });
  }
  return out.length > 0 ? out : undefined;
}

/**
 * Parse an assistant message text for the grounding verdict.
 *
 * #942 (2026-05-20) — the model is instructed to emit BOTH a
 * `Verdict: <one-sentence claim>` line AND a `Grounding: <status> (...)`
 * status line at end of body. Either may be present alone:
 *   - Status line only (legacy turns / model partial compliance) → chip
 *     shows the status pill with no claim body.
 *   - Verdict line only (fallback path — model emitted claim but skipped
 *     the status shape) → chip shows the claim body with the
 *     `insufficient` status pill so the user still sees the verdict.
 *   - Neither line → returns null (chip renders nothing).
 *
 * An empty/whitespace-only Verdict claim is treated as absent, NOT as a
 * blank verdict — a chip body element with empty text would surface a
 * blank stripe to the user.
 *
 * Defensive on shape — accepts the exact canonical schema and falls back
 * to status='mixed' on any partial status match.
 */
export function parseGroundingVerdict(text: string | undefined | null): GroundingVerdict | null {
  if (!text || typeof text !== 'string') return null;

  const verdictMatch = text.match(VERDICT_CLAIM_LINE);
  const statusMatch = text.match(STATUS_LINE);

  // Neither line present → no chip.
  if (!verdictMatch && !statusMatch) return null;

  // Extract the verdict claim text. The regex already requires a
  // non-whitespace first character, but trim defensively and discard the
  // whole capture if trimming wipes it out.
  let verdict: string | undefined;
  if (verdictMatch) {
    const claim = verdictMatch[1].trim();
    if (claim.length > 0) verdict = claim;
  }

  // If we have ONLY a Verdict line (no status), surface the chip with a
  // sentinel `insufficient` status so the existing render path renders
  // the claim body. The status pill copy is intentionally neutral here —
  // the user sees the verdict claim verbatim, which is what they care
  // about per #942.
  let status: GroundingVerdict['status'];
  let raw: string;
  let sources: number | undefined;
  let counterpoints: number | undefined;
  if (statusMatch) {
    const [statusRaw, kind, paren] = statusMatch;
    raw = statusRaw;
    if (kind === 'verified by web') status = 'verified';
    else if (kind === 'mixed') status = 'mixed';
    else if (kind === 'refuted') status = 'refuted';
    else if (kind === 'insufficient') status = 'insufficient';
    else status = 'mixed';

    if (paren) {
      const srcMatch = paren.match(/(\d+)\s*sources?/);
      if (srcMatch) sources = Number.parseInt(srcMatch[1], 10);
      const cpMatch = paren.match(/(\d+)\s*counterpoints?/);
      if (cpMatch) counterpoints = Number.parseInt(cpMatch[1], 10);
    }
  } else {
    // Verdict-line-only fallback — model gave us the claim but no
    // canonical status line. Skip rendering if the claim itself was
    // empty/whitespace (handled above) — otherwise show the claim with
    // a neutral status pill.
    if (!verdict) return null;
    status = 'insufficient';
    raw = verdictMatch![0];
  }

  const sourcesList = parseSourcesBlock(text);
  return { status, sources, counterpoints, raw, verdict, sourcesList };
}

/**
 * Strip the grounding artifacts — Verdict claim line, Grounding status
 * line, and the optional <grounding-sources> JSON block — from the
 * assistant text. Callers (MessageBubble) pass the cleaned string into
 * the prose renderer so none of these leak into the body.
 */
export function stripGroundingArtifacts(text: string): string {
  return text
    .replace(SOURCES_BLOCK, '')
    .replace(STATUS_LINE, '')
    .replace(VERDICT_CLAIM_LINE, '')
    .replace(/\n{3,}/g, '\n\n')
    .trimEnd();
}

const STATUS_STYLE: Record<GroundingVerdict['status'], { fg: string; bg: string; label: string }> = {
  verified: {
    fg: 'var(--cm-success, var(--cm-accent, var(--text-primary)))',
    bg: 'color-mix(in srgb, var(--cm-success, var(--cm-accent, var(--text-primary))) 12%, transparent)',
    label: 'Verified by web',
  },
  mixed: {
    fg: 'var(--cm-warn, var(--text-primary))',
    bg: 'color-mix(in srgb, var(--cm-warn, var(--text-primary)) 14%, transparent)',
    label: 'Mixed verdict',
  },
  refuted: {
    fg: 'var(--cm-error, var(--text-primary))',
    bg: 'color-mix(in srgb, var(--cm-error, var(--text-primary)) 14%, transparent)',
    label: 'Refuted by web',
  },
  insufficient: {
    fg: 'var(--cm-info, var(--cm-fg-2, var(--text-secondary)))',
    bg: 'color-mix(in srgb, var(--cm-info, var(--cm-fg-2, var(--text-secondary))) 12%, transparent)',
    label: 'Insufficient evidence',
  },
};

export const GroundingVerdictChip: React.FC<{ verdict: GroundingVerdict }> = ({ verdict }) => {
  const style = STATUS_STYLE[verdict.status];
  const countSegment =
    verdict.status === 'mixed' && verdict.counterpoints != null && verdict.sources != null
      ? `${verdict.sources} sources, ${verdict.counterpoints} counterpoints`
      : verdict.sources != null
        ? `${verdict.sources} ${verdict.sources === 1 ? 'source' : 'sources'}`
        : null;

  const sourcesList =
    Array.isArray(verdict.sourcesList) && verdict.sourcesList.length > 0
      ? verdict.sourcesList
      : null;

  // #942 (2026-05-20) — surface the model's one-sentence verdict claim
  // verbatim below the status pill. Only render the claim element when
  // we actually have non-empty claim text — never a blank stripe.
  const claimText =
    typeof verdict.verdict === 'string' && verdict.verdict.trim().length > 0
      ? verdict.verdict.trim()
      : null;

  return (
    <div
      data-testid="grounding-verdict-chip-wrap"
      style={{ display: 'flex', flexDirection: 'column', gap: 6, marginTop: 8 }}
    >
      <div
        role="status"
        aria-live="polite"
        data-testid="grounding-verdict-chip"
        data-verdict={verdict.status}
        style={{
          display: 'inline-flex',
          alignSelf: 'flex-start',
          alignItems: 'center',
          gap: 6,
          padding: '4px 10px',
          borderRadius: 999,
          fontSize: 12,
          fontWeight: 500,
          color: style.fg,
          backgroundColor: style.bg,
          border: `1px solid ${style.fg}`,
        }}
        title={verdict.raw}
      >
        <SearchCheck size={13} aria-hidden="true" />
        <span>{style.label}</span>
        {countSegment ? (
          <span style={{ opacity: 0.75 }}>· {countSegment}</span>
        ) : null}
      </div>
      {claimText ? (
        <div
          data-testid="grounding-verdict-claim"
          style={{
            fontSize: 13,
            lineHeight: 1.5,
            color: 'var(--cm-fg, var(--text-primary))',
          }}
        >
          {claimText}
        </div>
      ) : null}
      {sourcesList ? (
        <ol
          data-testid="grounding-sources-list"
          aria-label="Sources used for grounding"
          style={{
            margin: 0,
            paddingInlineStart: 22,
            display: 'flex',
            flexDirection: 'column',
            gap: 2,
            fontSize: 12,
            color: 'var(--cm-fg-2, var(--text-secondary))',
          }}
        >
          {sourcesList.map((s, i) => (
            <li key={`${i}-${s.url}`} style={{ lineHeight: 1.4 }}>
              <a
                href={s.url}
                target="_blank"
                rel="noopener noreferrer"
                title={s.url}
                style={{
                  color: 'var(--cm-accent, var(--accent, var(--text-primary)))',
                  textDecoration: 'underline',
                  textUnderlineOffset: 2,
                }}
              >
                {s.title || s.url}
              </a>
            </li>
          ))}
        </ol>
      ) : null}
    </div>
  );
};

/**
 * Convenience wrapper — given an assistant message text, parses + renders
 * the chip if a verdict line is present, otherwise renders nothing.
 */
export const InlineGroundingChip: React.FC<{ assistantText: string | null | undefined }> = ({
  assistantText,
}) => {
  const verdict = parseGroundingVerdict(assistantText);
  if (!verdict) return null;
  return <GroundingVerdictChip verdict={verdict} />;
};

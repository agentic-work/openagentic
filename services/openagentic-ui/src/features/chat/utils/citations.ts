/**
 * Phase F.5 — citation detection helpers.
 *
 * Two shapes of "citation" flow through assistant responses today:
 *
 * 1. **GFM footnotes** — the LLM writes `claim [^1]` with `[^1]: url "title"`.
 *    react-markdown + remark-gfm render these as `<sup><a href="#user-content-fn-1">1</a></sup>`
 *    with a definition block at the end. We detect the href prefix and
 *    dress the chip up with a hover tooltip carrying the source url.
 *
 * 2. **Inline markdown links** — the LLM writes `claim [1](https://url)`.
 *    We treat bracketed-digit link text as a citation so the chip renders
 *    compactly instead of showing the whole URL.
 *
 * Both paths converge on a single shape (`CitationInfo`) so the renderer
 * has one code path.
 */

export interface CitationInfo {
  /** What to show inside the chip (e.g. "1", "2") */
  label: string;
  /** Destination URL, when present */
  href?: string;
  /** Hover tooltip / aria-label source detail */
  title?: string;
  /** True when this came from `[^N]` footnote syntax */
  isFootnote: boolean;
}

/** Matches "^1", "^12", but also a bare "1" / "12" inside bracket text. */
const BARE_DIGITS_RE = /^(\^)?(\d{1,3})$/;

/**
 * Detect the GFM-footnote anchor convention used by remark-gfm
 * (`#user-content-fn-1` / `#user-content-fnref-1`). When a link matches,
 * we treat the link text as the footnote number.
 */
export function isFootnoteHref(href: string | null | undefined): boolean {
  if (!href) return false;
  return /^#user-content-fn(ref)?-/.test(href);
}

/**
 * Decide whether a link element represents a citation. Returns the
 * structured info when yes, or null so callers can render the link as-is.
 *
 * `linkText` is the flattened text content of the link anchor (children of
 * the <a>); `href` is the href attribute; `title` is the markdown title
 * (the part after the URL in `[^1]: url "title"`).
 */
export function detectCitation(
  linkText: string,
  href: string | null | undefined,
  title?: string | null,
): CitationInfo | null {
  const trimmed = (linkText || '').trim();
  if (!trimmed) return null;

  // Footnote ref via GFM: href is `#user-content-fn-N`, text is usually N.
  if (isFootnoteHref(href)) {
    const match = trimmed.replace(/[\[\]]/g, '').match(BARE_DIGITS_RE);
    const label = match ? match[2] : trimmed;
    return {
      label,
      href: href ?? undefined,
      title: title ?? undefined,
      isFootnote: true,
    };
  }

  // Inline citation: link text is literally "[1]" / "1" / "^1".
  const bare = trimmed.replace(/[\[\]]/g, '');
  const digitsMatch = bare.match(BARE_DIGITS_RE);
  if (digitsMatch && href) {
    return {
      label: digitsMatch[2],
      href,
      title: title ?? undefined,
      isFootnote: false,
    };
  }

  return null;
}

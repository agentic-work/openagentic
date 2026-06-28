/**
 * AnnotatedCode — code block with inline annotation markers (mocks 03, 07).
 *
 *   <pre class="cm-code" aria-label="{filename}">
 *     <span class="cm-ln">line 1</span>
 *     <span class="cm-ln cm-ann">line 2 — flagged</span>
 *     ...
 *   </pre>
 *
 * Caller provides already-tokenized lines (from Shiki, prism, etc.) and
 * a list of 1-based line numbers to annotate. Annotated lines get an
 * amber-tinted background + left border via the cm-ann class.
 *
 * Used by the security-review (mock 03) and TS-refactor (mock 07) flows
 * where the agent flags specific lines as "the issue is here".
 */

import React from 'react';

export interface AnnotatedCodeProps {
  /** Pre-formatted lines (HTML allowed via dangerouslySetInnerHTML in caller). */
  lines: ReadonlyArray<string | React.ReactNode>;
  /** 1-based line numbers to mark with the cm-ann class. */
  annotatedLines: ReadonlyArray<number>;
  /** Optional aria-label, typically the filename. */
  ariaLabel?: string;
  /** Optional language label for hover tooltips. */
  language?: string;
}

export function AnnotatedCode({
  lines,
  annotatedLines,
  ariaLabel,
  language,
}: AnnotatedCodeProps) {
  if (!lines || lines.length === 0) return null;
  const annSet = new Set(annotatedLines);
  return (
    <pre className="cm-code" aria-label={ariaLabel} data-language={language}>
      {lines.map((line, idx) => {
        const lineNo = idx + 1;
        const isAnn = annSet.has(lineNo);
        return (
          <span
            key={lineNo}
            className={`cm-ln${isAnn ? ' cm-ann' : ''}`}
            data-line={lineNo}
          >
            {line}
          </span>
        );
      })}
    </pre>
  );
}

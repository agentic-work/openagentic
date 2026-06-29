/**
 * #781 Phase C1 — PythonReport renderer.
 *
 * Renders synth_execute stdout-as-markdown payloads inside the
 * editorial-prestige slide-out body. Reuses the markdown->HTML
 * conversion from `exportPdf.ts` so the rendered DOM and the PDF
 * export look identical (single SoT for markdown formatting).
 */
import React from 'react';
import { buildPrintableHtml } from '../exportPdf.js';

export interface PythonReportProps {
  stdout: string;
  executionTimeMs?: number;
}

/**
 * Extract the inner <body> HTML from the full printable doc — we only
 * want the formatted markdown body for in-place rendering, not the
 * whole document chrome.
 */
function extractBodyHtml(fullDoc: string): string {
  const match = fullDoc.match(/<body>([\s\S]*?)<\/body>/);
  return match ? match[1] : fullDoc;
}

export const PythonReport: React.FC<PythonReportProps> = ({ stdout, executionTimeMs }) => {
  if (!stdout || !stdout.trim()) {
    return (
      <div
        data-testid="python-report-empty"
        style={{
          padding: '40px 20px',
          textAlign: 'center',
          color: 'var(--graphite, rgba(13,13,12,0.55))',
          fontFamily: 'var(--font-mono, ui-monospace, monospace)',
          fontSize: '12px',
          letterSpacing: '0.04em',
        }}
      >
        synth_execute returned no output.
      </div>
    );
  }
  const html = extractBodyHtml(buildPrintableHtml('Report', stdout));
  return (
    <article
      data-testid="python-report-root"
      style={{
        fontFamily: 'var(--font-serif, ui-serif, Georgia, serif)',
        fontSize: '14.5px',
        lineHeight: 1.55,
        color: 'var(--ink, #0d0d0c)',
        maxWidth: '64ch',
      }}
    >
      <div data-testid="python-report-body" dangerouslySetInnerHTML={{ __html: html }} />
      {executionTimeMs !== undefined && (
        <footer
          data-testid="python-report-footer"
          style={{
            marginTop: '24px',
            paddingTop: '14px',
            borderTop: '1px solid var(--ink-on-paper, rgba(13,13,12,0.12))',
            fontFamily: 'var(--font-mono, ui-monospace, monospace)',
            fontSize: '10.5px',
            letterSpacing: '0.08em',
            textTransform: 'uppercase',
            color: 'var(--graphite, rgba(13,13,12,0.55))',
          }}
        >
          synth · {executionTimeMs} ms
        </footer>
      )}
    </article>
  );
};

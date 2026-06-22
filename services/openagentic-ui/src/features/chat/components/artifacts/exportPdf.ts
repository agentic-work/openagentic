/**
 * #781 Phase B — PDF export for artifact slide-outs.
 *
 * Strategy: browser-print fallback. We build a print-friendly HTML
 * document from the markdown content + title, open it in a hidden
 * iframe, and trigger the browser's native print dialog (which lets
 * the user save as PDF). This avoids bundling `@react-pdf/renderer`
 * (~500KB) for a path most users won't take.
 *
 * `buildPrintableHtml` is exported separately so the caller can drive
 * the iframe + trigger logic and tests can assert on the document
 * shape without mocking the browser print pipeline.
 */

function escapeHtml(s: string): string {
  return s
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

/**
 * Convert simple markdown to HTML — headers, paragraphs, bold/italic,
 * code blocks. Not a full markdown parser; covers the shapes synth_execute
 * emits as `python-report` stdout. For richer markdown, callers should
 * pre-render via the platform's markdown component and pass through to
 * print directly.
 */
function markdownToHtml(md: string): string {
  // Code fences first (so we don't mangle # inside code)
  const blocks: string[] = [];
  // Sentinel wraps a code-block index while the rest of the markdown is
  // transformed. Uses Private-Use-Area code points (not control chars) so the
  // marker never collides with real markdown text and stays regex-safe.
  const placeholder = (i: number) => `\uE000${i}\uE001`;
  let working = md.replace(
    /```(\w*)\n([\s\S]*?)```/g,
    (_match, lang: string, code: string) => {
      const idx = blocks.length;
      blocks.push(
        `<pre><code data-lang="${escapeHtml(lang || 'text')}">${escapeHtml(code)}</code></pre>`,
      );
      return placeholder(idx);
    },
  );

  // Inline code
  working = working.replace(/`([^`]+)`/g, (_m, c: string) => `<code>${escapeHtml(c)}</code>`);

  // Headers (h1-h6)
  for (let level = 6; level >= 1; level--) {
    const hashes = '#'.repeat(level);
    const re = new RegExp(`^${hashes}\\s+(.+)$`, 'gm');
    working = working.replace(re, (_m, txt: string) => `<h${level}>${escapeHtml(txt)}</h${level}>`);
  }

  // Bold
  working = working.replace(/\*\*([^*]+)\*\*/g, '<strong>$1</strong>');
  // Italic
  working = working.replace(/(^|[^*])\*([^*]+)\*/g, '$1<em>$2</em>');

  // Lists (simple unordered)
  working = working.replace(/(^|\n)((?:- [^\n]+\n?)+)/g, (_m, lead: string, block: string) => {
    const items = block
      .trim()
      .split(/\n/)
      .map((line) => `<li>${line.replace(/^-\s+/, '')}</li>`)
      .join('');
    return `${lead}<ul>${items}</ul>`;
  });

  // Paragraphs (blank-line separated)
  working = working
    .split(/\n{2,}/)
    .map((para) => {
      const trimmed = para.trim();
      if (!trimmed) return '';
      if (/^<(h\d|pre|ul|ol|table|blockquote)/i.test(trimmed)) return trimmed;
      if (/^\uE000\d+\uE001$/.test(trimmed)) return trimmed;
      return `<p>${trimmed.replace(/\n/g, '<br/>')}</p>`;
    })
    .join('\n');

  // Restore code blocks
  working = working.replace(/\uE000(\d+)\uE001/g, (_m, idx: string) => blocks[Number(idx)] ?? '');

  return working;
}

export function buildPrintableHtml(title: string, markdownBody: string): string {
  const body = markdownToHtml(markdownBody);
  return `<!doctype html>
<html>
<head>
<meta charset="utf-8" />
<title>${escapeHtml(title)}</title>
<style>
  :root {
    color-scheme: light;
  }
  body {
    margin: 0;
    padding: 48px 64px;
    font-family: ui-serif, Georgia, "Times New Roman", serif;
    font-size: 12pt;
    line-height: 1.55;
    color: #0d0d0c;
    background: #f8f3e8;
    max-width: 7.5in;
  }
  h1, h2, h3, h4, h5, h6 {
    font-family: ui-serif, Georgia, "Times New Roman", serif;
    font-weight: 600;
    color: #0d0d0c;
    margin-top: 1.4em;
    margin-bottom: 0.6em;
    page-break-after: avoid;
  }
  h1 { font-size: 22pt; letter-spacing: -0.014em; }
  h2 { font-size: 18pt; }
  h3 { font-size: 14pt; }
  p { margin: 0 0 0.9em; }
  pre {
    background: #f0e9d8;
    padding: 12px 16px;
    overflow: auto;
    font-family: ui-monospace, "JetBrains Mono", monospace;
    font-size: 10.5pt;
    border-left: 3px solid #c1440e;
  }
  code {
    font-family: ui-monospace, "JetBrains Mono", monospace;
    font-size: 0.92em;
    background: #f0e9d8;
    padding: 0 4px;
  }
  pre code { background: transparent; padding: 0; }
  ul { padding-left: 1.5em; }
  li { margin: 0.2em 0; }
  table { border-collapse: collapse; width: 100%; margin: 0.8em 0; }
  th, td { border-bottom: 1px solid rgba(13,13,12,0.12); padding: 6px 10px; text-align: left; }
  th { font-weight: 600; }
  @media print {
    body { background: white; padding: 0.5in; max-width: none; }
    pre { background: #f0f0f0; }
  }
</style>
</head>
<body>
${body}
</body>
</html>`;
}

/**
 * Open a hidden iframe with the printable HTML and trigger the browser
 * print dialog. Returns a sentinel Blob the caller can pass to a
 * download link as a UX hint (browsers won't actually generate a PDF
 * here — the user must select "Save as PDF" in the print dialog).
 *
 * In environments without `window` (SSR / Node tests), this no-ops
 * cleanly and returns a sentinel.
 */
export async function exportArtifactToPdf(
  title: string,
  markdownBody: string,
): Promise<Blob> {
  const html = buildPrintableHtml(title, markdownBody);
  if (typeof window === 'undefined' || typeof document === 'undefined') {
    return new Blob([html], { type: 'text/html' });
  }
  const iframe = document.createElement('iframe');
  iframe.setAttribute('aria-hidden', 'true');
  iframe.style.position = 'fixed';
  iframe.style.right = '0';
  iframe.style.bottom = '0';
  iframe.style.width = '0';
  iframe.style.height = '0';
  iframe.style.border = '0';
  document.body.appendChild(iframe);
  try {
    const doc = iframe.contentDocument;
    if (doc) {
      doc.open();
      doc.write(html);
      doc.close();
      // Wait for fonts/images then print
      await new Promise<void>((resolve) => {
        const w = iframe.contentWindow;
        if (!w) return resolve();
        const fire = () => {
          try {
            w.focus();
            w.print();
          } catch {
            /* print may be blocked; user can right-click the iframe */
          }
          resolve();
        };
        if (doc.readyState === 'complete') {
          fire();
        } else {
          w.addEventListener('load', fire, { once: true });
          // Safety timeout
          setTimeout(fire, 600);
        }
      });
    }
  } finally {
    // Keep the iframe in the DOM for ~5s so the print dialog stays
    // wired up, then GC it.
    setTimeout(() => {
      iframe.parentNode?.removeChild(iframe);
    }, 5000);
  }
  return new Blob([html], { type: 'text/html' });
}

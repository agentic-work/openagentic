/**
 * SafeHtmlIframe — sandboxed iframe wrapper for arbitrary HTML strings
 * that cross a trust boundary (workflow tool output, model output,
 * user-supplied envelopes, etc.).
 *
 * Architecture:
 *   - srcdoc isolates the content in an opaque cross-origin context.
 *   - sandbox="allow-scripts" — scripts run, but cannot reach back to
 *     the parent realm (no allow-same-origin → cookies / localStorage /
 *     window.parent inspection all blocked).
 *   - Inline CSP <meta http-equiv="Content-Security-Policy"> caps script
 *     execution to a per-render nonce so injected <script> tags without
 *     the nonce are blocked at the parser layer.
 *   - connect-src is locked to the chat-dev origin so a malicious
 *     payload can't exfiltrate via fetch/XHR/WebSocket.
 *
 * Used by S6 to replace the previous `dangerouslySetInnerHTML={{ __html:
 * envelope.content }}` in ExecutionResultsPanel — workflow tool outputs
 * marked `format: 'html'` were rendering directly into chat DOM, which
 * is an XSS surface for any tool that emits unfiltered HTML.
 *
 * Spec: docs/superpowers/specs/2026-05-09-v3-enterprise-chatmode-design.md §3 S6
 */

import React, { useEffect, useMemo, useState } from 'react';

import { getCurrentIframeTheme, getIframeThemeStylesheet } from '@/features/workflows/utils/iframeThemeStylesheet';

export interface SafeHtmlIframeProps {
  /** Raw HTML content to render (any source, untrusted). */
  content: string;
  /** Title for accessibility (announced by screen readers). */
  title?: string;
  /** Optional explicit nonce; falls back to a random per-render value. */
  nonce?: string;
  /** Optional fixed height — defaults to a sensible inline default. */
  minHeight?: number;
  className?: string;
  style?: React.CSSProperties;
}

function generateNonce(): string {
  // Per-render nonce. Inside the iframe's opaque origin this is enough
  // — the parent never reuses it, and the CSP it gates is meta-tag
  // scoped to that single srcdoc.
  const rand = (typeof crypto !== 'undefined' && 'getRandomValues' in crypto)
    ? Array.from(crypto.getRandomValues(new Uint8Array(8)))
        .map((b) => b.toString(16).padStart(2, '0'))
        .join('')
    : Math.random().toString(36).slice(2, 18);
  return `n-${rand}`;
}

export function SafeHtmlIframe({
  content,
  title = 'safe-html',
  nonce,
  minHeight = 200,
  className,
  style,
}: SafeHtmlIframeProps): JSX.Element {
  // Re-render the iframe srcdoc when the parent app theme flips so the
  // injected <style id="openagentic-theme-injected"> snapshot reflects the new
  // computed CSS-variable values. Iframe srcdocs are opaque cross-origin
  // contexts and don't inherit :root vars from the parent — we have to
  // re-copy them in on every theme toggle.
  //
  // Subscribes to both the `storage` event (cross-tab sync) and a
  // MutationObserver on documentElement (same-tab class / data-theme
  // attribute flips driven by useTheme.ts).
  const [themeTick, setThemeTick] = useState<string>(() =>
    typeof document !== 'undefined' ? getCurrentIframeTheme() : 'dark'
  );

  useEffect(() => {
    if (typeof document === 'undefined') return;
    const root = document.documentElement;
    const observer = new MutationObserver(() => {
      const next = getCurrentIframeTheme();
      setThemeTick((prev) => (prev === next ? prev : next));
    });
    observer.observe(root, {
      attributes: true,
      attributeFilter: ['data-theme', 'class', 'style'],
    });

    const onStorage = (e: StorageEvent) => {
      if (e.key && (e.key === 'ac-theme' || e.key === 'openagentic-theme')) {
        setThemeTick(getCurrentIframeTheme());
      }
    };
    window.addEventListener('storage', onStorage);

    return () => {
      observer.disconnect();
      window.removeEventListener('storage', onStorage);
    };
  }, []);

  const srcdoc = useMemo(() => {
    const effectiveNonce = nonce ?? generateNonce();
    const csp = [
      "default-src 'none'",
      `script-src 'nonce-${effectiveNonce}'`,
      `style-src 'nonce-${effectiveNonce}' 'unsafe-inline'`,
      "img-src data: https:",
      "font-src data:",
      "connect-src https://chat.example.com",
    ].join('; ');

    // Inject the nonce into every <script> tag so legitimate inline JS
    // (model-emitted) still runs, while raw injected scripts without the
    // nonce are blocked at the CSP parser. Same pattern existing
    // WidgetRenderer / AppRenderer use.
    const noncedContent = content.replace(/<script\b/gi, `<script nonce="${effectiveNonce}"`);

    // Pull live theme vars from the parent app at render-time so the
    // iframe inherits dark/light/accent. `themeTick` participates in
    // the dep array so a parent theme flip re-runs this useMemo.
    const themeStyle = getIframeThemeStylesheet();
    void themeTick;

    return [
      '<!DOCTYPE html>',
      '<html>',
      '<head>',
      '<meta charset="utf-8">',
      `<meta http-equiv="Content-Security-Policy" content="${csp}">`,
      themeStyle,
      '</head>',
      `<body>${noncedContent}</body>`,
      '</html>',
    ].join('\n');
  }, [content, nonce, themeTick]);

  return (
    <iframe
      title={title}
      sandbox="allow-scripts"
      srcDoc={srcdoc}
      className={className}
      style={{
        width: '100%',
        minHeight,
        border: '1px solid var(--color-border, var(--line-1))',
        borderRadius: 10,
        background: 'var(--bg-1, var(--color-surface))',
        colorScheme: 'inherit',
        ...style,
      }}
    />
  );
}

export default SafeHtmlIframe;

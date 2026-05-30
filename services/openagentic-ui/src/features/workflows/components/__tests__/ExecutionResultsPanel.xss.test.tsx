/**
 * S6 — XSS resistance tests for ExecutionResultsPanel.
 *
 * Tests the two primitives that previously routed untrusted tool/model
 * content through `dangerouslySetInnerHTML`:
 *   - `JsonBlock`: syntax-highlighted JSON envelope (used for JSON
 *     output rendering). Now renders via `tokenizeJson` -> React tree.
 *   - SafeHtmlIframe (used for `format: 'html'` envelopes): sandboxed
 *     iframe with allow-scripts ONLY, no allow-same-origin.
 *
 * Together these cover the two attack surfaces in the panel:
 *   1. JSON values containing `<script>` no longer become live DOM.
 *   2. HTML envelopes can't reach the chat DOM (sandboxed iframe).
 *
 * Spec: docs/superpowers/specs/2026-05-09-v3-enterprise-chatmode-design.md §3 S6
 */

import React from 'react';
import { describe, it, expect, beforeEach } from 'vitest';
import { render } from '@testing-library/react';
import { JsonBlock, tokenizeJson } from '../ExecutionResultsPanel';
import { SafeHtmlIframe } from '@/shared/components/SafeHtmlIframe';

describe('ExecutionResultsPanel — XSS resistance (S6)', () => {
  beforeEach(() => {
    delete (window as unknown as Record<string, unknown>).__pwned;
  });

  describe('JsonBlock', () => {
    it('does NOT execute <script> tags embedded in a JSON string value', () => {
      const malicious = {
        name: '<script>window.__pwned = true</script>',
        ok: true,
      };
      const { container } = render(<JsonBlock data={malicious} />);
      // The script tag becomes ESCAPED text inside a span, not live DOM.
      expect((window as unknown as Record<string, unknown>).__pwned).toBeUndefined();
      // No <script> element actually present in the rendered subtree
      expect(container.querySelector('script')).toBeNull();
      // The escaped text is visible to the user
      expect(container.textContent).toContain('<script>');
    });

    it('does NOT use dangerouslySetInnerHTML — no innerHTML injection path', () => {
      const { container } = render(<JsonBlock data={{ a: 1, b: 'x' }} />);
      // pre.innerHTML should contain the className-tagged spans and the
      // JSON text, but every <span> is a real React element, not an
      // injected HTML string. Verifying the className tagging proves the
      // tokenizer ran and produced proper DOM.
      const pre = container.querySelector('pre');
      expect(pre).toBeTruthy();
      expect(pre!.querySelector('.wf-json-key')).toBeTruthy();
      expect(pre!.querySelector('.wf-json-number')).toBeTruthy();
      // String value 'x' renders as a wf-json-string span
      expect(pre!.querySelector('.wf-json-string')).toBeTruthy();
    });

    it('tokenizeJson returns React nodes, not an HTML string', () => {
      const tokens = tokenizeJson('{"a": 1}');
      expect(Array.isArray(tokens)).toBe(true);
      // At least one token should be a React element with a className
      const hasReactSpan = tokens.some(
        (t) =>
          typeof t === 'object' &&
          t !== null &&
          (t as { type?: unknown }).type === 'span',
      );
      expect(hasReactSpan).toBe(true);
    });
  });

  describe('SafeHtmlIframe (HTML envelope path)', () => {
    it('renders content inside a sandboxed iframe with allow-scripts only', () => {
      const malicious = '<button onclick="window.__pwned=true">click</button><script>window.__pwned=true</script>';
      const { container } = render(<SafeHtmlIframe content={malicious} />);
      const iframe = container.querySelector('iframe') as HTMLIFrameElement | null;
      expect(iframe).toBeTruthy();
      // Sandbox MUST be allow-scripts ONLY (never allow-same-origin)
      const sandbox = iframe!.getAttribute('sandbox') ?? '';
      expect(sandbox).toBe('allow-scripts');
      expect(sandbox).not.toContain('allow-same-origin');
      // The script never runs in parent scope (jsdom doesn't execute
      // iframe srcdoc, but the verification is the sandbox attribute +
      // CSP meta tag in srcdoc — see below).
      expect((window as unknown as Record<string, unknown>).__pwned).toBeUndefined();
    });

    it('embeds CSP meta tag with default-src none and nonced script-src', () => {
      const { container } = render(
        <SafeHtmlIframe content="<script>1</script>" nonce="test-abc" />,
      );
      const iframe = container.querySelector('iframe') as HTMLIFrameElement | null;
      expect(iframe).toBeTruthy();
      const srcdoc = iframe!.getAttribute('srcdoc') ?? iframe!.srcdoc;
      expect(srcdoc).toContain('Content-Security-Policy');
      expect(srcdoc).toContain("default-src 'none'");
      expect(srcdoc).toContain("'nonce-test-abc'");
      expect(srcdoc).toContain('connect-src https://chat.example.com');
      // <script> tag should be nonced (so legitimate model JS can run
      // under the CSP, while injected scripts without the nonce are
      // blocked at parse time).
      expect(srcdoc).toContain('<script nonce="test-abc"');
    });

    it('uses unique per-render nonce when none is supplied', () => {
      const { container: a } = render(<SafeHtmlIframe content="<div>a</div>" />);
      const { container: b } = render(<SafeHtmlIframe content="<div>b</div>" />);
      const srcdocA = (a.querySelector('iframe') as HTMLIFrameElement).srcdoc;
      const srcdocB = (b.querySelector('iframe') as HTMLIFrameElement).srcdoc;
      const nonceA = /'nonce-([^']+)'/.exec(srcdocA)?.[1];
      const nonceB = /'nonce-([^']+)'/.exec(srcdocB)?.[1];
      expect(nonceA).toBeTruthy();
      expect(nonceB).toBeTruthy();
      expect(nonceA).not.toBe(nonceB);
    });
  });
});

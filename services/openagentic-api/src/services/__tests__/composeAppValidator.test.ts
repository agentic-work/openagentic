/**
 * Phase 4 #474 — composeAppValidator
 *
 * Plan: <internal-plan>
 *
 * Server-side validation pipeline for compose_app payloads. Composes:
 *   - CdnAllowList.validateScriptUrls (shipped 1bb497aa) — script src
 *   - Payload size cap                                   — DoS / cost control
 *   - No `eval(...)` / no `new Function(...)`            — defense in depth
 *   - No nested `<iframe>`                               — sandbox escape risk
 *
 * Returns ALL violations together so the model can correct the entire
 * payload at once. Empty-payload guard returns ok (the tool dispatcher
 * separately requires a non-empty html).
 */
import { describe, it, expect } from 'vitest';
import { validateComposeAppPayload } from '../composeAppValidator.js';

describe('composeAppValidator (#474 Phase 4 step 2)', () => {
  describe('happy path', () => {
    it('accepts a minimal valid payload with internal-CDN scripts', () => {
      // #482/#491 — same-origin architecture. The synth-cdn pod is ClusterIP-only
      // (the sandbox executor pod), exposed to the browser via UI nginx
      // reverse-proxy at `/api/cdn/lib/*`. There is NO `cdn.openagentic.io` host
      // (no DNS, no ingress, no TLS cert) — the legacy URL form is explicitly
      // banned (#491). Use the canonical same-origin `/api/cdn/lib/*` path.
      const html = `<html><body>
        <div id="app"></div>
        <script src="/api/cdn/lib/d3@7/dist/d3.min.js"></script>
        <script>const x = 42;</script>
      </body></html>`;
      const r = validateComposeAppPayload(html);
      expect(r.ok).toBe(true);
      expect(r.errors).toEqual([]);
    });

    it('accepts empty html (caller-side check rejects empty separately)', () => {
      const r = validateComposeAppPayload('');
      expect(r.ok).toBe(true);
    });
  });

  describe('size cap', () => {
    it('rejects payload over default cap (1MB)', () => {
      const html = '<div>' + 'x'.repeat(1024 * 1024 + 1) + '</div>';
      const r = validateComposeAppPayload(html);
      expect(r.ok).toBe(false);
      expect(r.errors.some(e => /size|too\s*large|cap/i.test(e))).toBe(true);
    });

    it('respects custom maxBytes', () => {
      const html = 'x'.repeat(1000);
      const r = validateComposeAppPayload(html, { maxBytes: 500 });
      expect(r.ok).toBe(false);
      expect(r.errors.some(e => /size|too\s*large|cap/i.test(e))).toBe(true);
    });

    it('accepts payload exactly at cap', () => {
      const html = 'x'.repeat(500);
      const r = validateComposeAppPayload(html, { maxBytes: 500 });
      // size check uses byte length; pure ASCII => 500 bytes
      expect(r.ok).toBe(true);
    });
  });

  describe('no-eval rule', () => {
    it('rejects eval() call in inline script', () => {
      const html = `<script>eval("alert(1)");</script>`;
      const r = validateComposeAppPayload(html);
      expect(r.ok).toBe(false);
      expect(r.errors.some(e => /eval/i.test(e))).toBe(true);
    });

    it('rejects new Function() call', () => {
      const html = `<script>const f = new Function("return 1");</script>`;
      const r = validateComposeAppPayload(html);
      expect(r.ok).toBe(false);
      expect(r.errors.some(e => /Function/.test(e))).toBe(true);
    });

    it('does NOT match the substring "eval" inside a longer identifier', () => {
      const html = `<script>const evaluator = 1; const _eval_helper = 2;</script>`;
      const r = validateComposeAppPayload(html);
      // No actual eval() call — should pass.
      expect(r.ok).toBe(true);
    });

    it('does NOT match inside a comment-mention of eval', () => {
      const html = `<script>// don't use eval here\nconst x = 1;</script>`;
      // We allow benign mentions of the word "eval" in comments. The
      // word-boundary + open-paren check should exempt comments.
      const r = validateComposeAppPayload(html);
      expect(r.ok).toBe(true);
    });
  });

  describe('no-nested-iframe rule', () => {
    it('rejects nested <iframe>', () => {
      const html = `<html><body><iframe src="https://evil"></iframe></body></html>`;
      const r = validateComposeAppPayload(html);
      expect(r.ok).toBe(false);
      expect(r.errors.some(e => /iframe/i.test(e))).toBe(true);
    });

    it('rejects self-closing <iframe />', () => {
      const html = `<iframe src="x" />`;
      expect(validateComposeAppPayload(html).ok).toBe(false);
    });

    it('rejects uppercase <IFRAME>', () => {
      const html = `<IFRAME src="x"></IFRAME>`;
      expect(validateComposeAppPayload(html).ok).toBe(false);
    });
  });

  describe('CdnAllowList integration', () => {
    it('rejects external CDN script in production mode', () => {
      const html = `<script src="https://cdn.jsdelivr.net/npm/d3"></script>`;
      const r = validateComposeAppPayload(html);
      expect(r.ok).toBe(false);
      expect(r.errors.some(e => /jsdelivr|allow-list|cdn/i.test(e))).toBe(true);
    });

    it('allows external CDN when allowExternalCdn=true', () => {
      const html = `<script src="https://cdn.jsdelivr.net/npm/d3"></script>`;
      const r = validateComposeAppPayload(html, { allowExternalCdn: true });
      expect(r.ok).toBe(true);
    });

    it('always rejects skypack regardless of allowExternalCdn', () => {
      const html = `<script src="https://cdn.skypack.dev/d3"></script>`;
      const r = validateComposeAppPayload(html, { allowExternalCdn: true });
      expect(r.ok).toBe(false);
    });
  });

  describe('multi-violation reporting', () => {
    it('reports CdnAllowList + eval + iframe in one call', () => {
      const html = `
        <iframe src="x"></iframe>
        <script src="https://cdn.skypack.dev/d3"></script>
        <script>eval("danger");</script>
      `;
      const r = validateComposeAppPayload(html);
      expect(r.ok).toBe(false);
      expect(r.errors.length).toBeGreaterThanOrEqual(3);
      expect(r.errors.some(e => /iframe/i.test(e))).toBe(true);
      expect(r.errors.some(e => /skypack|cdn|allow-list/i.test(e))).toBe(true);
      expect(r.errors.some(e => /eval/i.test(e))).toBe(true);
    });
  });
});

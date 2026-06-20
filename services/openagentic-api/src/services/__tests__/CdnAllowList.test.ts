/**
 * Phase 4 #474 — CdnAllowList: validates `<script src=...>` URLs in
 * compose_app HTML payloads against the cluster-internal CDN allow-list.
 *
 * Plan: <internal-plan>
 *
 * Contract:
 *  - Inline scripts (no `src` attr) PASS — validated by separate no-eval rule.
 *  - `https://cdn.openagentic.io/lib/...` ALWAYS allowed.
 *  - `jsdelivr.net`, `unpkg.com`, `cdnjs.cloudflare.com` allowed ONLY when
 *    `opts.allowExternalCdn === true` (dev/test mode behind a feature flag).
 *  - skypack.dev, esm.sh — ALWAYS rejected (skypack sunsetting per
 *    https://www.jsdelivr.com/skypack ; esm.sh has weak audit history).
 *  - Anything else (third-party domains, IPs, http://, data:, blob:) — REJECTED.
 *
 * The validator returns ALL violations, not just the first — UI surfaces a
 * complete error list so the model can correct the entire payload at once.
 */
import { describe, it, expect } from 'vitest';
import { validateScriptUrls } from '../CdnAllowList.js';

describe('CdnAllowList — validateScriptUrls (#474 Phase 4)', () => {
  describe('rejected: legacy cdn.openagentic.io hostname (#491)', () => {
    // synth-cdn is a ClusterIP-only service. There is no DNS, no ingress,
    // no TLS cert for `cdn.openagentic.io` — the browser cannot reach it.
    // Any model emitting that hostname is using stale plan-spec URLs that
    // were superseded by the same-origin /api/cdn/* path. Reject so the
    // server-side validator catches the model drift before browser CSP does.
    it('rejects legacy https://cdn.openagentic.io/lib/ URL form', () => {
      const html = `<script src="https://cdn.openagentic.io/lib/d3@7/dist/d3.min.js"></script>`;
      const r = validateScriptUrls(html);
      expect(r.ok).toBe(false);
      expect(r.violations).toContain('https://cdn.openagentic.io/lib/d3@7/dist/d3.min.js');
    });

    it('rejects legacy cdn.openagentic.io even for pyodide bundle', () => {
      const html = `<script src="https://cdn.openagentic.io/lib/pyodide/0.27/pyodide.js"></script>`;
      expect(validateScriptUrls(html).ok).toBe(false);
    });
  });

  describe('always-allowed: same-origin /api/cdn/lib/', () => {
    // #482 — same-origin architecture (no separate cdn.openagentic.io host).
    // The UI's nginx reverse-proxies /api/cdn/* to synth-cdn:8080 inside the
    // cluster. Iframe srcdoc <base href> resolves these paths against the
    // parent origin (chat.example.com). We accept BOTH:
    //   1) `/api/cdn/lib/...`   — relative path the model SHOULD emit
    //   2) `https://${host}/api/cdn/lib/...` — absolute, any host (model may inline origin)
    it('passes relative <script src="/api/cdn/lib/d3.min.js">', () => {
      const html = `<script src="/api/cdn/lib/d3.min.js"></script>`;
      expect(validateScriptUrls(html).ok).toBe(true);
    });

    it('passes relative pyodide path under /api/cdn/lib/pyodide/', () => {
      const html = `<script src="/api/cdn/lib/pyodide/0.27/pyodide.js"></script>`;
      expect(validateScriptUrls(html).ok).toBe(true);
    });

    it('passes absolute /api/cdn/lib/* on a deployed origin', () => {
      const html = `<script src="https://chat.example.com/api/cdn/lib/echarts.min.js"></script>`;
      expect(validateScriptUrls(html).ok).toBe(true);
    });

    it('rejects relative path NOT under /api/cdn/lib/', () => {
      const html = `<script src="/api/code/payload.js"></script>`;
      const r = validateScriptUrls(html);
      expect(r.ok).toBe(false);
      expect(r.violations).toContain('/api/code/payload.js');
    });

    it('rejects relative path traversal attempts', () => {
      const html = `<script src="/api/cdn/lib/../../etc/passwd"></script>`;
      const r = validateScriptUrls(html);
      expect(r.ok).toBe(false);
    });

    // #484 C3 — percent-encoded traversal bypass.
    // `new URL('https://x/api/cdn/lib/..%2fetc/passwd').pathname` does NOT
    // decode `%2f`; the seg-split sees `..%2fetc` not `..` and accepts.
    // nginx upstream URL-decodes before path resolution, reaching files
    // outside the allowed root. Validator MUST decode before checking.
    it('rejects %2f-encoded ../ traversal', () => {
      const html = `<script src="/api/cdn/lib/..%2fetc/passwd"></script>`;
      expect(validateScriptUrls(html).ok).toBe(false);
    });

    it('rejects %2e%2e-encoded .. traversal', () => {
      const html = `<script src="/api/cdn/lib/%2e%2e/etc/passwd"></script>`;
      expect(validateScriptUrls(html).ok).toBe(false);
    });

    it('rejects mixed-case %2E encoded traversal', () => {
      const html = `<script src="/api/cdn/lib/%2E%2E/etc/passwd"></script>`;
      expect(validateScriptUrls(html).ok).toBe(false);
    });

    it('rejects backslash traversal (some servers normalize)', () => {
      const html = `<script src="/api/cdn/lib/..\\etc\\passwd"></script>`;
      expect(validateScriptUrls(html).ok).toBe(false);
    });

    it('rejects double-encoded %252f traversal', () => {
      const html = `<script src="/api/cdn/lib/..%252fetc"></script>`;
      expect(validateScriptUrls(html).ok).toBe(false);
    });

    it('passes mixed inline + allowed-CDN scripts', () => {
      const html = `<script src="/api/cdn/lib/d3@7/dist/d3.min.js"></script>
                    <script>console.log("inline ok");</script>`;
      expect(validateScriptUrls(html).ok).toBe(true);
    });
  });

  describe('inline scripts (no src)', () => {
    it('passes pure inline script (no src attr)', () => {
      const html = `<script>alert(1)</script>`;
      expect(validateScriptUrls(html).ok).toBe(true);
    });

    it('passes empty body', () => {
      expect(validateScriptUrls('<html><body></body></html>').ok).toBe(true);
    });

    it('passes empty string', () => {
      expect(validateScriptUrls('').ok).toBe(true);
    });
  });

  describe('rejected: third-party CDNs', () => {
    it('rejects jsdelivr by default', () => {
      const html = `<script src="https://cdn.jsdelivr.net/npm/d3@7"></script>`;
      const r = validateScriptUrls(html);
      expect(r.ok).toBe(false);
      expect(r.violations).toContain('https://cdn.jsdelivr.net/npm/d3@7');
    });

    it('rejects unpkg by default', () => {
      const html = `<script src="https://unpkg.com/react@18/umd/react.production.min.js"></script>`;
      expect(validateScriptUrls(html).ok).toBe(false);
    });

    it('rejects cdnjs by default', () => {
      const html = `<script src="https://cdnjs.cloudflare.com/ajax/libs/d3/7.0.0/d3.min.js"></script>`;
      expect(validateScriptUrls(html).ok).toBe(false);
    });

    it('rejects raw IP address', () => {
      const html = `<script src="https://10.0.0.1/lib/d3.js"></script>`;
      expect(validateScriptUrls(html).ok).toBe(false);
    });

    it('rejects http:// (insecure)', () => {
      const html = `<script src="http://cdn.openagentic.io/lib/d3.js"></script>`;
      const r = validateScriptUrls(html);
      expect(r.ok).toBe(false);
      expect(r.violations.length).toBeGreaterThan(0);
    });

    it('rejects data: URIs', () => {
      const html = `<script src="data:text/javascript,alert(1)"></script>`;
      expect(validateScriptUrls(html).ok).toBe(false);
    });
  });

  describe('always-rejected: skypack + esm.sh (per plan rejection list)', () => {
    it('rejects skypack even when allowExternalCdn=true', () => {
      const html = `<script src="https://cdn.skypack.dev/d3"></script>`;
      const r = validateScriptUrls(html, { allowExternalCdn: true });
      expect(r.ok).toBe(false);
      expect(r.violations).toContain('https://cdn.skypack.dev/d3');
    });

    it('rejects esm.sh even when allowExternalCdn=true', () => {
      const html = `<script src="https://esm.sh/d3@7"></script>`;
      const r = validateScriptUrls(html, { allowExternalCdn: true });
      expect(r.ok).toBe(false);
    });
  });

  describe('dev mode: allowExternalCdn=true permits jsdelivr/unpkg/cdnjs', () => {
    it('allows jsdelivr when flag set', () => {
      const html = `<script src="https://cdn.jsdelivr.net/npm/d3@7"></script>`;
      const r = validateScriptUrls(html, { allowExternalCdn: true });
      expect(r.ok).toBe(true);
    });

    it('allows unpkg when flag set', () => {
      const html = `<script src="https://unpkg.com/react@18"></script>`;
      const r = validateScriptUrls(html, { allowExternalCdn: true });
      expect(r.ok).toBe(true);
    });

    it('allows cdnjs when flag set', () => {
      const html = `<script src="https://cdnjs.cloudflare.com/ajax/libs/d3/7.0.0/d3.min.js"></script>`;
      const r = validateScriptUrls(html, { allowExternalCdn: true });
      expect(r.ok).toBe(true);
    });
  });

  describe('reports ALL violations, not just first', () => {
    it('returns every violating URL when multiple are bad', () => {
      const html = `
        <script src="/api/cdn/lib/d3@7/dist/d3.min.js"></script>
        <script src="https://cdn.skypack.dev/d3"></script>
        <script src="https://evil.example.com/payload.js"></script>
        <script src="https://unpkg.com/react"></script>
      `;
      const r = validateScriptUrls(html);
      expect(r.ok).toBe(false);
      expect(r.violations).toContain('https://cdn.skypack.dev/d3');
      expect(r.violations).toContain('https://evil.example.com/payload.js');
      expect(r.violations).toContain('https://unpkg.com/react');
      // The same-origin /api/cdn/lib/* path is the only allow-listed shape.
      expect(r.violations).not.toContain('/api/cdn/lib/d3@7/dist/d3.min.js');
      expect(r.violations.length).toBe(3);
    });
  });

  describe('case-insensitive tag + attribute parsing', () => {
    it('parses <SCRIPT SRC=...> uppercase', () => {
      const html = `<SCRIPT SRC="https://evil.example.com/x.js"></SCRIPT>`;
      expect(validateScriptUrls(html).ok).toBe(false);
    });

    it('parses single-quoted src', () => {
      const html = `<script src='https://evil.example.com/x.js'></script>`;
      expect(validateScriptUrls(html).ok).toBe(false);
    });
  });
});

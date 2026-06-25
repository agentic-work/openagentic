/**
 * #487 Sev-2 — composeAppValidator must (a) generate a per-render nonce,
 * (b) attach it to every inline + external `<script>` tag, and (c)
 * surface it on the result so AppRenderer can build a CSP that drops
 * `'unsafe-inline'` and uses `'nonce-XXX'` instead.
 *
 * Live trust-model gap: AppRenderer.tsx:76 ships `script-src 'self'
 * ${origin}/api/cdn/lib/ 'unsafe-inline'`. With unsafe-inline any
 * `<script>...</script>` block bypasses the host allow-list, defeating
 * the path-prefix protection from #482/#490. Per-render nonce lets us
 * drop 'unsafe-inline' entirely while still allowing the model's
 * approved (validated) inline glue code to run.
 *
 * Contract:
 *   - `validateComposeAppPayload(html, ...)` returns `{ ok, errors, nonce, hardenedHtml }`.
 *   - `nonce` is a 22-char URL-safe base64 string (16 random bytes).
 *   - `hardenedHtml` has every `<script>` tag rewritten with `nonce="<value>"`.
 *   - When validation fails, hardenedHtml is undefined (no point hardening
 *     a payload that's about to be rejected).
 *   - Each call returns a fresh nonce (no module-level cache).
 */

import { describe, it, expect } from 'vitest';
import { validateComposeAppPayload } from '../composeAppValidator.js';

describe('#487 — composeAppValidator nonce + inline-script harden', () => {
  it('returns a 22-char URL-safe base64 nonce on success', () => {
    const r = validateComposeAppPayload('<!doctype html><html><body><script>console.log(1);</script></body></html>') as any;
    expect(r.ok).toBe(true);
    expect(typeof r.nonce).toBe('string');
    expect(r.nonce).toMatch(/^[A-Za-z0-9_-]{22}$/);
  });

  it('attaches the nonce to inline <script> tags in hardenedHtml', () => {
    const r = validateComposeAppPayload(
      '<!doctype html><html><body><script>const x=1;</script></body></html>',
    ) as any;
    expect(r.ok).toBe(true);
    expect(r.hardenedHtml).toContain(`<script nonce="${r.nonce}"`);
    expect(r.hardenedHtml).toContain('const x=1;');
  });

  it('attaches the nonce to external <script src=...> tags too', () => {
    const r = validateComposeAppPayload(
      '<!doctype html><html><head><script src="/api/cdn/lib/echarts@5/dist/echarts.min.js"></script></head><body></body></html>',
    ) as any;
    expect(r.ok).toBe(true);
    // The src attr must still be present + the nonce attached. Order
    // doesn't matter, but both must end up on the same tag.
    expect(r.hardenedHtml).toMatch(/<script[^>]*nonce="[A-Za-z0-9_-]{22}"[^>]*src="\/api\/cdn\/lib\/echarts@5\/dist\/echarts\.min\.js"|<script[^>]*src="\/api\/cdn\/lib\/echarts@5\/dist\/echarts\.min\.js"[^>]*nonce="[A-Za-z0-9_-]{22}"/);
  });

  it('returns a fresh nonce on every call (not module-level cache)', () => {
    const r1 = validateComposeAppPayload('<!doctype html><body><script>1</script>') as any;
    const r2 = validateComposeAppPayload('<!doctype html><body><script>1</script>') as any;
    expect(r1.nonce).not.toBe(r2.nonce);
  });

  it('does not include hardenedHtml or nonce when validation fails', () => {
    const r = validateComposeAppPayload(
      '<!doctype html><body><script>eval("uh oh")</script>',
    ) as any;
    expect(r.ok).toBe(false);
    expect(r.errors.length).toBeGreaterThan(0);
    expect(r.hardenedHtml).toBeUndefined();
    expect(r.nonce).toBeUndefined();
  });

  it('preserves multiple inline scripts (each gets the same nonce)', () => {
    const r = validateComposeAppPayload(
      '<!doctype html><body><script>const a=1;</script><div></div><script>const b=2;</script></body>',
    ) as any;
    expect(r.ok).toBe(true);
    const matches = r.hardenedHtml.match(/<script[^>]*nonce="/g) || [];
    expect(matches.length).toBe(2);
  });
});

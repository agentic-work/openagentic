/**
 * AppRenderer (#474)
 *
 * Mounts the server's `app_render` NDJSON frame (T3 compose_app payload)
 * inside a sandboxed iframe with srcdoc — same architecture as
 * WidgetRenderer but with stricter CSP and optional Pyodide bootstrap.
 *
 * Contract pinned by these tests:
 *   - sandbox attribute is "allow-scripts" only — NEVER allow-same-origin
 *     (sandbox-escape risk, https://oxc.rs/docs/guide/usage/linter/rules/react/iframe-missing-sandbox)
 *   - srcdoc starts with the canonical CSP <meta http-equiv> tag pointing at
 *     the SAME-ORIGIN /api/cdn/lib/ proxy path (#482 — UI nginx reverse-proxies
 *     /api/cdn/* to the ClusterIP synth-cdn pod; no external CDN host exists).
 *   - data-artifact-id attribute on the container for Playwright probing
 *   - data-app-renderer="true" so DOM-grep tests can find it
 *   - title attribute on iframe for a11y
 *   - When pyodide_required=true, srcdoc references /api/cdn/lib/pyodide
 *   - When pyodide_required=false, srcdoc does NOT reference pyodide
 *   - Empty html prop renders nothing (defensive)
 */

import React from 'react';
import { describe, it, expect } from 'vitest';
import { render } from '@testing-library/react';
import '@testing-library/jest-dom';
import { AppRenderer } from '../AppRenderer.js';

const BASIC_HTML = `<!doctype html><html><body><div id="app">hello</div></body></html>`;

describe('AppRenderer — Phase 4 T3 compose_app mount', () => {
  describe('sandbox attribute', () => {
    it('renders iframe with sandbox="allow-scripts"', () => {
      const { container } = render(
        <AppRenderer artifactId="a1" html={BASIC_HTML} title="t" />,
      );
      const iframe = container.querySelector('iframe');
      expect(iframe).not.toBeNull();
      expect(iframe!.getAttribute('sandbox')).toBe('allow-scripts');
    });

    it('NEVER includes allow-same-origin (sandbox-escape risk)', () => {
      const { container } = render(
        <AppRenderer artifactId="a1" html={BASIC_HTML} title="t" />,
      );
      const sandbox = container.querySelector('iframe')?.getAttribute('sandbox') || '';
      expect(sandbox).not.toMatch(/allow-same-origin/);
    });
  });

  describe('CSP injection inside srcdoc — same-origin (#482)', () => {
    it('srcdoc starts with <meta http-equiv="Content-Security-Policy">', () => {
      const { container } = render(
        <AppRenderer artifactId="a1" html={BASIC_HTML} title="t" />,
      );
      const srcdoc = container.querySelector('iframe')?.getAttribute('srcdoc') || '';
      expect(srcdoc).toMatch(/<meta\s+http-equiv\s*=\s*["']Content-Security-Policy["']/i);
      // CSP must NOT mention public CDNs (jsdelivr / unpkg / cdnjs / skypack / esm.sh)
      expect(srcdoc).not.toMatch(/jsdelivr/i);
      expect(srcdoc).not.toMatch(/unpkg/i);
      expect(srcdoc).not.toMatch(/cdnjs/i);
      expect(srcdoc).not.toMatch(/skypack/i);
      expect(srcdoc).not.toMatch(/esm\.sh/i);
    });

    it('srcdoc CSP script-src is path-prefixed to /api/cdn/lib/ (#484 C2)', () => {
      // jsdom default origin is http://localhost. AppRenderer reads window.location.origin
      // at render-time so the CSP allow-list always matches the host that actually serves
      // /api/cdn/* via UI nginx — no separate cdn.openagentic.io DNS / cert.
      //
      // Reviewer C2: must NOT allow `${origin}` alone — that lets the iframe
      // `<script src="/api/embed/anything.js">` since /api/embed returns
      // application/javascript. Tighten with a path-prefix source per CSP3.
      const { container } = render(
        <AppRenderer artifactId="a1" html={BASIC_HTML} title="t" />,
      );
      const srcdoc = container.querySelector('iframe')?.getAttribute('srcdoc') || '';
      const origin = window.location.origin;
      const escapedOrigin = origin.replace(/[/.]/g, '\\$&');
      // The CSP source MUST be `${origin}/api/cdn/lib/` — not bare origin.
      expect(srcdoc).toMatch(new RegExp(`script-src[^;]*${escapedOrigin}/api/cdn/lib/`, 'i'));
      // Bare ${origin} (without /api/cdn/lib/) MUST NOT appear in script-src.
      // Match the script-src value up to the next `;`, then assert no
      // bare-origin-without-path-prefix in that span.
      const scriptSrcMatch = srcdoc.match(/script-src[^;]*/i);
      expect(scriptSrcMatch).not.toBeNull();
      const scriptSrc = scriptSrcMatch![0];
      // Allowed: `${origin}/api/cdn/lib/`. Banned: `${origin}` followed by
      // anything other than `/api/cdn/lib/`.
      const bareOriginPattern = new RegExp(`${escapedOrigin}(?!/api/cdn/lib/)`);
      expect(scriptSrc).not.toMatch(bareOriginPattern);
    });

    it('srcdoc CSP allows the parent origin for connect-src (POST /api/synth/exec)', () => {
      const { container } = render(
        <AppRenderer artifactId="a1" html={BASIC_HTML} title="t" />,
      );
      const srcdoc = container.querySelector('iframe')?.getAttribute('srcdoc') || '';
      const origin = window.location.origin;
      expect(srcdoc).toMatch(new RegExp(`connect-src[^;]*${origin.replace(/[/.]/g, '\\$&')}`, 'i'));
    });

    it('srcdoc injects <base href="${origin}/"> so relative /api/cdn/* URLs resolve', () => {
      // Without <base>, relative URLs in a srcdoc iframe resolve against
      // about:srcdoc — every fetch fails. The base tag pins them to the
      // parent origin so the model can author <script src="/api/cdn/lib/...">
      // without knowing the absolute host.
      const { container } = render(
        <AppRenderer artifactId="a1" html={BASIC_HTML} title="t" />,
      );
      const srcdoc = container.querySelector('iframe')?.getAttribute('srcdoc') || '';
      const origin = window.location.origin;
      expect(srcdoc).toMatch(new RegExp(`<base\\s+href=["']${origin.replace(/[/.]/g, '\\$&')}/?["']`, 'i'));
    });

    it('srcdoc preserves the user-supplied html body', () => {
      const { container } = render(
        <AppRenderer artifactId="a1" html='<div id="zzz">CANARY_TOKEN</div>' title="t" />,
      );
      const srcdoc = container.querySelector('iframe')?.getAttribute('srcdoc') || '';
      expect(srcdoc).toContain('CANARY_TOKEN');
    });
  });

  describe('Pyodide bootstrap (pyodide_required flag)', () => {
    it('srcdoc references /api/cdn/lib/pyodide (same-origin) when pyodide_required=true', () => {
      const { container } = render(
        <AppRenderer
          artifactId="a1"
          html={BASIC_HTML}
          title="t"
          pyodideRequired
        />,
      );
      const srcdoc = container.querySelector('iframe')?.getAttribute('srcdoc') || '';
      // Same-origin path — resolves via UI nginx /api/cdn/* → synth-cdn:8080.
      expect(srcdoc).toMatch(/\/api\/cdn\/lib\/pyodide/);
    });

    it('srcdoc does NOT reference pyodide when pyodide_required=false', () => {
      const { container } = render(
        <AppRenderer artifactId="a1" html={BASIC_HTML} title="t" />,
      );
      const srcdoc = container.querySelector('iframe')?.getAttribute('srcdoc') || '';
      expect(srcdoc).not.toMatch(/pyodide/i);
    });
  });

  describe('container attributes for Playwright probing', () => {
    it('exposes data-artifact-id on the wrapper', () => {
      const { container } = render(
        <AppRenderer artifactId="azure-mig-dashboard:abc123" html={BASIC_HTML} title="t" />,
      );
      const wrapper = container.querySelector('[data-app-renderer="true"]');
      expect(wrapper).not.toBeNull();
      expect(wrapper!.getAttribute('data-artifact-id')).toBe('azure-mig-dashboard:abc123');
    });

    it('iframe carries title attribute for a11y', () => {
      const { container } = render(
        <AppRenderer artifactId="a1" html={BASIC_HTML} title="cost-flow-dashboard" />,
      );
      expect(container.querySelector('iframe')?.getAttribute('title')).toBe('cost-flow-dashboard');
    });
  });

  describe('defensive: empty html', () => {
    it('renders nothing when html is empty', () => {
      const { container } = render(
        <AppRenderer artifactId="a1" html="" title="t" />,
      );
      expect(container.querySelector('iframe')).toBeNull();
    });
  });

  describe('CLAUDE.md rule 8(b) — parent theme token override (canonical --cm-* names)', () => {
    // Iframes are isolated documents — they do NOT inherit CSS variables from
    // the parent. Server-baked templates that `var(--cm-bg-0)` resolve against
    // the iframe's own `:root`, which the template hardcodes to one theme.
    // AppRenderer must read the parent's resolved tokens and inject an override
    // `<style id="cm-parent-theme-override">` into the srcdoc <head>, using the
    // CANONICAL token names from lib/charts/hooks/useThemeTokens.ts VAR_MAP
    // (--cm-bg-0/1/2, --cm-fg-0/1/2/3, --cm-ok, --cm-warn, --cm-err, --cm-info,
    // --cm-accent, --cm-line-1/2). Reading non-canonical names like `--cm-bg`,
    // `--cm-fg-dim`, `--cm-success` silently no-ops because :root never
    // defines them.

    beforeEach(() => {
      // Seed the canonical tokens on document.documentElement before render
      // so getComputedStyle(parent) has values to propagate into the iframe.
      const root = document.documentElement;
      root.style.setProperty('--cm-bg-0', 'rgb(11, 15, 20)');
      root.style.setProperty('--cm-bg-1', 'rgb(16, 22, 28)');
      root.style.setProperty('--cm-fg-1', 'rgb(220, 230, 240)');
      root.style.setProperty('--cm-accent', 'rgb(80, 220, 140)');
      root.style.setProperty('--cm-ok', 'rgb(34, 197, 94)');
      root.style.setProperty('--cm-err', 'rgb(239, 68, 68)');
    });

    afterEach(() => {
      const root = document.documentElement;
      for (const name of [
        '--cm-bg-0', '--cm-bg-1', '--cm-fg-1', '--cm-accent', '--cm-ok', '--cm-err',
      ]) {
        root.style.removeProperty(name);
      }
    });

    it('srcdoc contains <style id="cm-parent-theme-override"> block', () => {
      const { container } = render(
        <AppRenderer artifactId="a1" html={BASIC_HTML} title="t" />,
      );
      const srcdoc = container.querySelector('iframe')?.getAttribute('srcdoc') || '';
      expect(srcdoc).toMatch(/<style\s+id=["']cm-parent-theme-override["']/);
    });

    it('override block emits canonical --cm-bg-0 with parent value', () => {
      const { container } = render(
        <AppRenderer artifactId="a1" html={BASIC_HTML} title="t" />,
      );
      const srcdoc = container.querySelector('iframe')?.getAttribute('srcdoc') || '';
      // Extract the override block content so we don't false-positive on the
      // template-supplied --cm-bg-0 (BASIC_HTML doesn't set one but a real
      // template might).
      const match = srcdoc.match(
        /<style\s+id=["']cm-parent-theme-override["'][^>]*>([\s\S]*?)<\/style>/i,
      );
      expect(match).not.toBeNull();
      const body = match![1];
      expect(body).toMatch(/--cm-bg-0:\s*rgb\(11,\s*15,\s*20\)/);
    });

    it('override block emits canonical --cm-accent with parent value', () => {
      const { container } = render(
        <AppRenderer artifactId="a1" html={BASIC_HTML} title="t" />,
      );
      const srcdoc = container.querySelector('iframe')?.getAttribute('srcdoc') || '';
      const match = srcdoc.match(
        /<style\s+id=["']cm-parent-theme-override["'][^>]*>([\s\S]*?)<\/style>/i,
      );
      expect(match).not.toBeNull();
      expect(match![1]).toMatch(/--cm-accent:\s*rgb\(80,\s*220,\s*140\)/);
    });

    it('override block emits canonical --cm-ok / --cm-err (not legacy --cm-success / --cm-error)', () => {
      const { container } = render(
        <AppRenderer artifactId="a1" html={BASIC_HTML} title="t" />,
      );
      const srcdoc = container.querySelector('iframe')?.getAttribute('srcdoc') || '';
      const match = srcdoc.match(
        /<style\s+id=["']cm-parent-theme-override["'][^>]*>([\s\S]*?)<\/style>/i,
      );
      expect(match).not.toBeNull();
      const body = match![1];
      expect(body).toMatch(/--cm-ok:\s*rgb\(34,\s*197,\s*94\)/);
      expect(body).toMatch(/--cm-err:\s*rgb\(239,\s*68,\s*68\)/);
      // Negative: legacy non-canonical names must NOT appear (regression of
      // 4a5300dd which read --cm-success / --cm-error).
      expect(body).not.toMatch(/--cm-success:/);
      expect(body).not.toMatch(/--cm-error:/);
    });

    it('override block is appended after the head injection so CSS cascade wins over template :root', () => {
      // The template's own `:root { --cm-bg-0: <dark default> }` is inside
      // the user-supplied html. The parent override must come AFTER so the
      // cascade resolves to the parent value, not the template default.
      const templated = `<!doctype html><html><head><style>:root{--cm-bg-0:#000}</style></head><body></body></html>`;
      const { container } = render(
        <AppRenderer artifactId="a1" html={templated} title="t" />,
      );
      const srcdoc = container.querySelector('iframe')?.getAttribute('srcdoc') || '';
      const templateRootIdx = srcdoc.search(/:root\s*{\s*--cm-bg-0:\s*#000/);
      const overrideIdx = srcdoc.search(/id=["']cm-parent-theme-override["']/);
      expect(templateRootIdx).toBeGreaterThan(-1);
      expect(overrideIdx).toBeGreaterThan(-1);
      expect(overrideIdx).toBeGreaterThan(templateRootIdx);
    });
  });
});

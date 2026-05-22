/**
 * ComposeAppTool — `template` + `params` registry path.
 *
 * Spec: docs/superpowers/specs/2026-05-03-chatmode-end-state-design.md
 *
 * The tool gains an optional `template?: string` (registry slug) and
 * `params?: object`. When `template` is set:
 *   - Server resolves the slug in COMPOSE_APP_TEMPLATES.
 *   - Validates params against the template's paramsSchema.
 *   - Calls htmlTemplate(params) to produce the HTML.
 *   - Runs the SAME composeAppValidator + CdnAllowList checks as freestyle.
 *
 * Trust boundary unchanged: every payload still flows through the validator.
 */

import { describe, test, expect, vi } from 'vitest';
import {
  COMPOSE_APP_TOOL,
  executeComposeApp,
} from '../ComposeAppTool.js';
import { findTemplate } from '../composeAppTemplates.js';

function makeCtx() {
  const emits: Array<{ event: string; payload: unknown }> = [];
  return {
    emits,
    ctx: {
      emit: (event: string, payload: unknown) => emits.push({ event, payload }),
      logger: {
        info: vi.fn(),
        warn: vi.fn(),
        error: vi.fn(),
        debug: vi.fn(),
      },
      sessionId: 'test-session',
      userId: 'test-user',
    },
  };
}

const SAFE_FREESTYLE_HTML = [
  '<!doctype html>',
  '<html><head><title>x</title></head><body>',
  '<div id="app"></div>',
  '<script src="/api/cdn/lib/d3@7/dist/d3.min.js"></script>',
  '<script>document.getElementById("app").textContent = "hi";</script>',
  '</body></html>',
].join('\n');

describe('compose_app — schema includes template + params', () => {
  test('parameters.properties exposes template (string) + params (object)', () => {
    const props = COMPOSE_APP_TOOL.function.parameters.properties as Record<string, any>;
    expect(props.template).toBeDefined();
    expect(props.template.type).toBe('string');
    expect(props.params).toBeDefined();
    expect(props.params.type).toBe('object');
  });

  test('description references the template registry', () => {
    expect(COMPOSE_APP_TOOL.function.description).toMatch(/template/i);
  });

  test('html is no longer in `required` (template OR html is acceptable)', () => {
    expect(COMPOSE_APP_TOOL.function.parameters.required).not.toContain('html');
  });
});

describe('compose_app — registry path (template + params)', () => {
  test('emits app_render for a known template + valid params', async () => {
    const { ctx, emits } = makeCtx();
    const tpl = findTemplate('aws-cloud-architecture')!;
    const result = await executeComposeApp(ctx, {
      template: tpl.slug,
      params: tpl.exampleParams,
      title: 'aws_arch_demo',
    } as any);
    expect(result.ok).toBe(true);
    expect(result.artifact_id).toBeTruthy();
    expect(emits).toHaveLength(1);
    expect(emits[0].event).toBe('app_render');
    const payload = emits[0].payload as Record<string, any>;
    expect(payload.title).toBe('aws_arch_demo');
    expect(typeof payload.html).toBe('string');
    expect(payload.html.length).toBeGreaterThan(200);
    // Sanity: the hydrated HTML mentions a label from the example params.
    expect(payload.html).toContain('prod-vpc');
  });

  test('returns error for unknown template slug', async () => {
    const { ctx, emits } = makeCtx();
    const result = await executeComposeApp(ctx, {
      template: 'definitely-not-a-template',
      params: {},
      title: 'broken',
    } as any);
    expect(result.ok).toBe(false);
    expect(result.error).toMatch(/unknown template/i);
    expect(emits).toHaveLength(0);
  });

  test('returns error when params fail schema validation', async () => {
    const { ctx, emits } = makeCtx();
    const result = await executeComposeApp(ctx, {
      template: 'runbook',
      params: { /* missing required title + steps */ },
      title: 'broken-params',
    } as any);
    expect(result.ok).toBe(false);
    expect(result.error).toMatch(/params|invalid|required/i);
    expect(emits).toHaveLength(0);
  });

  test('hydrated HTML still flows through composeAppValidator (registry is not a privilege escalation)', async () => {
    // Sanity: pick every template and run it through the tool. Every one
    // should land an `app_render` (not error) — proving the registry path
    // and the validator coexist for all 9 templates.
    const slugs = [
      'aws-cloud-architecture',
      'k8s-cluster-topology',
      'cost-sankey-savings',
      'multi-tenant-audit-dashboard',
      'traffic-flow-diagram',
      'cloud-run-grid',
      'build-progress',
      'multi-region-eks-dashboard',
      'runbook',
    ];
    for (const slug of slugs) {
      const { ctx, emits } = makeCtx();
      const tpl = findTemplate(slug)!;
      const result = await executeComposeApp(ctx, {
        template: slug,
        params: tpl.exampleParams,
        title: 't_' + slug,
      } as any);
      expect(result.ok, `${slug} should succeed`).toBe(true);
      expect(emits).toHaveLength(1);
      expect(emits[0].event).toBe('app_render');
    }
  });

  test('template path takes precedence when both template + html are set; warns on ignored html', async () => {
    const { ctx, emits } = makeCtx();
    const tpl = findTemplate('runbook')!;
    const result = await executeComposeApp(ctx, {
      template: tpl.slug,
      params: tpl.exampleParams,
      html: '<bogus />',
      title: 'precedence',
    } as any);
    expect(result.ok).toBe(true);
    const payload = emits[0].payload as Record<string, any>;
    // The hydrated HTML must contain runbook content, not the bogus html.
    expect(payload.html).toContain('runbook');
    expect(payload.html).not.toContain('<bogus />');
    expect(ctx.logger.warn).toHaveBeenCalled();
  });
});

describe('compose_app — freestyle path regression (still works without template)', () => {
  test('html-only call still emits app_render', async () => {
    const { ctx, emits } = makeCtx();
    const result = await executeComposeApp(ctx, {
      html: SAFE_FREESTYLE_HTML,
      title: 'Freestyle still works',
    } as any);
    expect(result.ok).toBe(true);
    expect(emits).toHaveLength(1);
    const payload = emits[0].payload as Record<string, any>;
    // #487 — the validator hardens HTML on success by attaching a per-render
    // `nonce="<value>"` to every <script> tag (so the iframe CSP can drop
    // 'unsafe-inline'). Compare ignoring nonce attrs — the body content + tag
    // structure must round-trip intact, but added nonce attributes are expected.
    const stripNonces = (html: string) => html.replace(/\s*nonce="[A-Za-z0-9_-]+"/g, '');
    expect(stripNonces(payload.html)).toBe(SAFE_FREESTYLE_HTML);
    // Sanity: the hardened payload contains nonce attributes matching the
    // emitted nonce (one per <script> tag in the source HTML).
    expect(payload.nonce).toMatch(/^[A-Za-z0-9_-]+$/);
    const nonceMatches = (payload.html as string).match(/nonce="[A-Za-z0-9_-]+"/g) ?? [];
    expect(nonceMatches.length).toBeGreaterThanOrEqual(1);
  });

  test('rejects with structured error when neither template nor html provided', async () => {
    const { ctx, emits } = makeCtx();
    const result = await executeComposeApp(ctx, {
      title: 'no body',
    } as any);
    expect(result.ok).toBe(false);
    expect(result.error).toBeTruthy();
    expect(emits).toHaveLength(0);
  });
});

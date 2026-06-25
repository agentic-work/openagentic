/**
 * ComposeAppTool — T3 mini-app tool surface (#474).
 *
 * Wires the existing pure-functional `validateComposeAppPayload`
 * (commit 336000a2) into an Anthropic-style tool definition + handler.
 * On success, emits a single `app_render` NDJSON frame matching the
 * shape consumed by AppRenderer.tsx (commit 2a508dad) + applyAppRenderFrame
 * (commit 8dc477a5):
 *
 *   {
 *     artifact_id: string,
 *     html: string,
 *     title: string | null,
 *     group_id: string | null,
 *     pyodide_required: boolean,
 *     python_exec_required: boolean,
 *     session_id: string | null,
 *   }
 *
 * On validation failure, returns { ok: false, error } with ALL violations
 * joined — does not emit any frame. Caller (model) receives the rejection
 * as a tool result so it can apologize / retry with a fixed payload.
 *
 * Architecture rule (mirrors ComposeVisualTool):
 *   - NO regex tool-name matching anywhere in this file.
 *   - Tier-strip enforcement happens at the chat-pipeline level
 *     (response.stage drops `app_render` frames if tierProfile.tier < 3
 *     per Phase 6, commit bf5c36c5).
 *   - This handler trusts that tier gating already filtered the tool
 *     out of the model's tools[] before it could be called.
 */

import { describe, test, expect, vi } from 'vitest';
import {
  COMPOSE_APP_TOOL,
  isComposeAppTool,
  executeComposeApp,
  type ComposeAppInput,
} from '../ComposeAppTool.js';

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

// #482/#491 — same-origin CDN. synth-cdn is the cluster-internal ClusterIP
// sandbox executor pod, exposed to browsers via UI nginx
// `/api/cdn/lib/*`. There is NO `cdn.openagentic.io` host — that legacy URL
// form is explicitly banned by CdnAllowList (#491).
const SAFE_HTML = [
  '<!doctype html>',
  '<html>',
  '<head><title>ok</title></head>',
  '<body>',
  '<div id="app"></div>',
  '<script src="/api/cdn/lib/d3@7/dist/d3.min.js"></script>',
  '<script>document.getElementById("app").textContent = "hi";</script>',
  '</body>',
  '</html>',
].join('\n');

describe('compose_app — tool surface', () => {
  test('exports the tool definition with correct shape', () => {
    expect(COMPOSE_APP_TOOL.type).toBe('function');
    expect(COMPOSE_APP_TOOL.function.name).toBe('compose_app');
    expect(COMPOSE_APP_TOOL.function.description.length).toBeGreaterThan(200);
    // Post template-registry: html is no longer required (template can
    // substitute). Only title is strictly required at the JSON-schema level;
    // executeComposeApp enforces "template OR html" at the handler.
    expect(COMPOSE_APP_TOOL.function.parameters.required).toEqual(['title']);
  });

  test('description names the same-origin /api/cdn/lib/ allow-list', () => {
    // #482/#491 — model-facing description must point to the canonical
    // same-origin proxy path, NOT the legacy ghost hostname (cdn.openagentic.io
    // has no DNS / ingress / TLS cert — would 100% fail at runtime).
    expect(COMPOSE_APP_TOOL.function.description).toContain('/api/cdn/lib/');
  });

  test('schema declares pyodide_required + python_exec_required as optional booleans', () => {
    const props = COMPOSE_APP_TOOL.function.parameters.properties as Record<string, any>;
    expect(props.pyodide_required.type).toBe('boolean');
    expect(props.python_exec_required.type).toBe('boolean');
  });

  test('isComposeAppTool matches canonical name + common aliases', () => {
    expect(isComposeAppTool('compose_app')).toBe(true);
    expect(isComposeAppTool('composeApp')).toBe(true);
    expect(isComposeAppTool('ComposeApp')).toBe(true);
    expect(isComposeAppTool('compose.app')).toBe(true);
    expect(isComposeAppTool('compose_visual')).toBe(false);
    expect(isComposeAppTool('')).toBe(false);
  });
});

describe('compose_app — input validation', () => {
  test('rejects empty html', async () => {
    const { ctx, emits } = makeCtx();
    const result = await executeComposeApp(ctx, {
      html: '',
      title: 'T',
    } as ComposeAppInput);
    expect(result.ok).toBe(false);
    expect(result.error).toBeTruthy();
    expect(emits).toHaveLength(0);
  });

  test('rejects non-string html', async () => {
    const { ctx, emits } = makeCtx();
    const result = await executeComposeApp(ctx, {
      // @ts-expect-error testing runtime guard
      html: 123,
      title: 'T',
    });
    expect(result.ok).toBe(false);
    expect(emits).toHaveLength(0);
  });

  test('rejects empty title', async () => {
    const { ctx, emits } = makeCtx();
    const result = await executeComposeApp(ctx, {
      html: SAFE_HTML,
      title: '',
    } as ComposeAppInput);
    expect(result.ok).toBe(false);
    expect(emits).toHaveLength(0);
  });

  test('rejects payload that fails composeAppValidator (forbidden CDN)', async () => {
    const { ctx, emits } = makeCtx();
    const badHtml = SAFE_HTML.replace(
      '/api/cdn/lib/d3@7/dist/d3.min.js',
      'https://cdn.jsdelivr.net/npm/d3@7/dist/d3.min.js',
    );
    const result = await executeComposeApp(ctx, {
      html: badHtml,
      title: 'Bad',
    });
    expect(result.ok).toBe(false);
    expect(result.error).toMatch(/script src .* allow-list/i);
    expect(result.error).toContain('jsdelivr');
    expect(emits).toHaveLength(0);
  });

  test('rejects payload that fails composeAppValidator (eval)', async () => {
    const { ctx, emits } = makeCtx();
    const badHtml = SAFE_HTML.replace(
      'document.getElementById("app").textContent = "hi";',
      'eval("alert(1)");',
    );
    const result = await executeComposeApp(ctx, {
      html: badHtml,
      title: 'Bad',
    });
    expect(result.ok).toBe(false);
    expect(result.error).toMatch(/eval/i);
    expect(emits).toHaveLength(0);
  });
});

describe('compose_app — happy path', () => {
  // #487 — validator hardens HTML on success by attaching `nonce="<value>"`
  // to every <script> tag so the iframe CSP can drop 'unsafe-inline'. The
  // payload.html in emits[0] is the hardened version. Compare ignoring nonce
  // attrs to assert the body content + structure round-trip intact.
  const stripNonces = (html: string): string =>
    html.replace(/\s*nonce="[A-Za-z0-9_-]+"/g, '');

  test('emits app_render with the validated html + assigned artifact_id', async () => {
    const { ctx, emits } = makeCtx();
    const result = await executeComposeApp(ctx, {
      html: SAFE_HTML,
      title: 'Cost Dashboard',
    });
    expect(result.ok).toBe(true);
    expect(result.artifact_id).toBeTruthy();
    expect(emits).toHaveLength(1);
    expect(emits[0].event).toBe('app_render');
    const payload = emits[0].payload as Record<string, any>;
    expect(stripNonces(payload.html)).toBe(SAFE_HTML);
    expect(payload.title).toBe('Cost Dashboard');
    expect(payload.artifact_id).toBe(result.artifact_id);
    expect(payload.session_id).toBe('test-session');
    // Sanity: nonce emitted + attached to each <script> tag in the source.
    expect(payload.nonce).toMatch(/^[A-Za-z0-9_-]+$/);
  });

  test('group_id is preserved on the wire and embedded in artifact_id', async () => {
    const { ctx, emits } = makeCtx();
    const result = await executeComposeApp(ctx, {
      html: SAFE_HTML,
      title: 'Dashboard v1',
      group_id: 'cost-dash',
    });
    expect(result.ok).toBe(true);
    const payload = emits[0].payload as Record<string, any>;
    expect(payload.group_id).toBe('cost-dash');
    expect(result.artifact_id?.startsWith('cost-dash:')).toBe(true);
  });

  test('pyodide_required + python_exec_required default to false', async () => {
    const { ctx, emits } = makeCtx();
    await executeComposeApp(ctx, {
      html: SAFE_HTML,
      title: 'No Python',
    });
    expect(emits).toHaveLength(1);
    const payload = emits[0].payload as Record<string, any>;
    expect(payload.pyodide_required).toBe(false);
    expect(payload.python_exec_required).toBe(false);
  });

  test('pyodide_required + python_exec_required propagate when set', async () => {
    const { ctx, emits } = makeCtx();
    await executeComposeApp(ctx, {
      html: SAFE_HTML,
      title: 'Pyodide App',
      pyodide_required: true,
      python_exec_required: true,
    });
    expect(emits).toHaveLength(1);
    const payload = emits[0].payload as Record<string, any>;
    expect(payload.pyodide_required).toBe(true);
    expect(payload.python_exec_required).toBe(true);
  });
});

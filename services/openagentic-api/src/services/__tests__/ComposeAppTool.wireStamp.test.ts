/**
 * A2/A3 — compose_app wire stamps tool_use_id + _meta.outputTemplate.
 *
 * the design notes
 *       §2.2.2 + §2.2.3.
 */
import { describe, it, expect } from 'vitest';
import { executeComposeApp } from '../ComposeAppTool.js';

const silentLogger = {
  info: () => {},
  warn: () => {},
  error: () => {},
  debug: () => {},
} as any;

const SAFE_HTML = [
  '<!doctype html>',
  '<html>',
  '<head><title>ok</title></head>',
  '<body>',
  '<div id="app"></div>',
  '<script>document.getElementById("app").textContent = "hi";</script>',
  '</body>',
  '</html>',
].join('\n');

function makeCtx(toolUseId?: string) {
  const emits: Array<{ event: string; payload: any }> = [];
  return {
    emits,
    ctx: {
      emit: (event: string, payload: unknown) =>
        emits.push({ event, payload: payload as any }),
      logger: silentLogger,
      sessionId: 'sess-test',
      userId: 'user-test',
      allowExternalCdn: true,
      ...(toolUseId ? { toolUseId } : {}),
    } as any,
  };
}

describe('compose_app — A2 wire-stamp tool_use_id', () => {
  it('stamps tool_use_id on app_render emit when ctx.toolUseId is set', async () => {
    const { ctx, emits } = makeCtx('toolu_app1');
    const result = await executeComposeApp(ctx, {
      title: 'demo',
      html: SAFE_HTML,
    } as any);
    expect(result.ok).toBe(true);
    const appRender = emits.find((e) => e.event === 'app_render');
    expect(appRender).toBeDefined();
    expect(appRender!.payload.tool_use_id).toBe('toolu_app1');
  });
});

describe('compose_app — A3 wire-stamp _meta.outputTemplate', () => {
  it('puts the template slug (or "freestyle") inside _meta.outputTemplate', async () => {
    const { ctx, emits } = makeCtx('toolu_app2');
    await executeComposeApp(ctx, {
      title: 'demo',
      html: SAFE_HTML,
    } as any);
    const appRender = emits.find((e) => e.event === 'app_render');
    expect(appRender).toBeDefined();
    expect(appRender!.payload._meta).toBeDefined();
    // freestyle HTML path → outputTemplate slug is the kind ('app_render').
    expect(appRender!.payload._meta.outputTemplate).toBe('app_render');
  });
});

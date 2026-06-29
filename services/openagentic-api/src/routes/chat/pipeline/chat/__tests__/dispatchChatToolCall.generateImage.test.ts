/**
 * dispatchChatToolCall — generate_image wire-in (TDD).
 *
 * Regression: `generate_image` was deleted with the legacy ChatPipeline.ts
 * in the #741 chatmode rip. The dispatcher must route a `tool_use` block
 * named `generate_image` to `deps.executeGenerateImage` — NOT fall through
 * to the MCP executor (there is no MCP image tool) or the approval gate.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { dispatchChatToolCall } from '../dispatchChatToolCall.js';

function makeCtx(overrides: Record<string, any> = {}) {
  return {
    emit: vi.fn(),
    logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() },
    sessionId: 'sess-test',
    userId: 'user-test',
    user: { id: 'user-test' },
    ...overrides,
  } as any;
}

function makeDeps(): any {
  return {
    executeComposeVisual: vi.fn(),
    executeComposeApp: vi.fn(),
    executeRenderArtifact: vi.fn(),
    executeGenerateImage: vi.fn(),
    executeTask: vi.fn(),
    executeRequestClarification: vi.fn(),
    executeBrowserSandbox: vi.fn(),
    executeMemorize: vi.fn(),
    executeMcpTool: vi.fn(),
    listSubagentTypes: vi.fn(),
    runSubagent: vi.fn(),
    approvalGate: { evaluate: vi.fn() },
  };
}

beforeEach(() => {
  vi.clearAllMocks();
});

describe('dispatchChatToolCall — generate_image', () => {
  it('routes call.name=="generate_image" to executeGenerateImage', async () => {
    const ctx = makeCtx();
    const deps = makeDeps();
    deps.executeGenerateImage.mockResolvedValue({
      ok: true,
      artifact_id: 'img_x',
      output: 'image generated',
    });

    const result = await dispatchChatToolCall(
      ctx,
      { name: 'generate_image', input: { prompt: 'a man on a computer' } },
      deps,
    );

    expect(deps.executeGenerateImage).toHaveBeenCalledTimes(1);
    // dispatcher passes (ctx, input)
    expect(deps.executeGenerateImage).toHaveBeenCalledWith(ctx, {
      prompt: 'a man on a computer',
    });
    expect(deps.executeMcpTool).not.toHaveBeenCalled();
    expect(deps.approvalGate.evaluate).not.toHaveBeenCalled();
    expect((result as any).ok).toBe(true);
  });

  it('also matches the generateImage camelCase alias', async () => {
    const ctx = makeCtx();
    const deps = makeDeps();
    deps.executeGenerateImage.mockResolvedValue({ ok: true, artifact_id: 'img_y' });
    await dispatchChatToolCall(ctx, { name: 'generateImage', input: { prompt: 'x' } }, deps);
    expect(deps.executeGenerateImage).toHaveBeenCalledTimes(1);
    expect(deps.executeMcpTool).not.toHaveBeenCalled();
  });

  it('does NOT route other tool names to executeGenerateImage', async () => {
    const ctx = makeCtx();
    const deps = makeDeps();
    deps.executeMcpTool.mockResolvedValue({ ok: true, output: 'mcp ok' });
    deps.approvalGate.evaluate.mockResolvedValue({ approved: true, reason: 'allow' });
    await dispatchChatToolCall(ctx, { name: 'some_mcp_tool', input: {} }, deps);
    expect(deps.executeGenerateImage).not.toHaveBeenCalled();
  });
});

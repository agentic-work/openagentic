/**
 * RED → GREEN spec for Task A: shouldEnableThinking must read
 * capabilities.thinking from ModelCapabilityRegistry (admin.model_role_assignments
 * SoT) instead of substring-sniffing the model name.
 *
 * Cage contract (CLAUDE.md Rule 7 + AnthropicProvider.no-literals cage):
 *   - No model-name substring patterns inside shouldEnableThinking.
 *   - Capability gate comes from registry.supportsThinking(model).
 *   - Falls back to false if the registry is unavailable (fail-safe).
 *
 * RED → GREEN cycle:
 *   RED: shouldEnableThinking reads thinkingMarkers substring array,
 *        ignores registry → negative mock returns true anyway (wrong).
 *   GREEN: shouldEnableThinking calls getModelCapabilityRegistry()
 *          → supportsThinking(model) → mock drives both outcomes.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import type { Logger } from 'pino';

// ─── hoist mock state so it survives module cache (vi.hoisted) ───────────────
const { supportsThinkingMock, registryReturnNull } = vi.hoisted(() => ({
  supportsThinkingMock: vi.fn<(modelId: string) => boolean>(),
  registryReturnNull: { value: false },
}));

vi.mock('../../ModelCapabilityRegistry.js', () => ({
  getModelCapabilityRegistry: () => {
    if (registryReturnNull.value) return null;
    return { supportsThinking: supportsThinkingMock };
  },
  setModelCapabilityRegistry: vi.fn(),
  ModelCapabilityRegistry: class {},
}));

// ─── Anthropic SDK mock ───────────────────────────────────────────────────────
vi.mock('@anthropic-ai/sdk', () => ({
  default: class {
    messages = { stream: vi.fn(), create: vi.fn() };
  },
}));

// ─── logger stub ─────────────────────────────────────────────────────────────
const silentLogger: Logger = {
  info:  vi.fn(),
  warn:  vi.fn(),
  error: vi.fn(),
  debug: vi.fn(),
  fatal: vi.fn(),
  trace: vi.fn(),
  child: () => silentLogger,
} as unknown as Logger;

// ─── import provider once (mocks already hoisted) ────────────────────────────
import { AnthropicProvider } from '../AnthropicProvider.js';

// ─── helpers ─────────────────────────────────────────────────────────────────
async function makeProvider(enableThinking: boolean) {
  const p = new AnthropicProvider(silentLogger);
  await p.initialize({ apiKey: 'test-key', enableThinking });
  return p;
}

// shouldEnableThinking is private — access via reflect for unit isolation.
function callShouldEnableThinking(provider: AnthropicProvider, model: string): boolean {
  return (provider as any).shouldEnableThinking(model);
}

// ─── tests ───────────────────────────────────────────────────────────────────
describe('AnthropicProvider.shouldEnableThinking — registry SoT', () => {
  beforeEach(() => {
    supportsThinkingMock.mockReset();
    registryReturnNull.value = false;
  });

  afterEach(() => {
    vi.clearAllMocks();
  });

  it('returns true when enableThinking flag is ON and registry.supportsThinking returns true', async () => {
    supportsThinkingMock.mockReturnValue(true);
    const provider = await makeProvider(true);

    // Use a model whose name carries no classic "claude-4" marker so we
    // know the result must come from the registry and not from a substring.
    const result = callShouldEnableThinking(provider, 'test-model-registry-thinking');

    expect(result).toBe(true);
    expect(supportsThinkingMock).toHaveBeenCalledWith('test-model-registry-thinking');
  });

  it('returns false when enableThinking flag is ON but registry.supportsThinking returns false', async () => {
    supportsThinkingMock.mockReturnValue(false);
    const provider = await makeProvider(true);

    const result = callShouldEnableThinking(provider, 'test-model-no-thinking');

    expect(result).toBe(false);
    expect(supportsThinkingMock).toHaveBeenCalledWith('test-model-no-thinking');
  });

  it('returns false when the enableThinking config flag is OFF even if registry says the model supports it', async () => {
    // Registry shouldn't even be queried — config gate fires first.
    supportsThinkingMock.mockReturnValue(true);
    const provider = await makeProvider(false);

    const result = callShouldEnableThinking(provider, 'test-model-registry-thinking');

    expect(result).toBe(false);
    // Registry MAY or MAY NOT be called — either is acceptable when the
    // config gate short-circuits. What matters is the final boolean.
  });

  it('returns false (fail-safe) when registry is null (not yet initialized)', async () => {
    registryReturnNull.value = true;
    const provider = await makeProvider(true);

    const result = callShouldEnableThinking(provider, 'some-model');
    expect(result).toBe(false);
  });

  it('does NOT rely on model-name substrings: model with no recognizable pattern is driven by registry', async () => {
    // An unrecognisable name that carries none of the former
    // thinkingMarkers ('opus-4', 'sonnet-4', etc.).
    const alienModel = 'acme-corp-reasoning-v99';
    supportsThinkingMock.mockReturnValue(true); // registry says YES
    const provider = await makeProvider(true);

    const result = callShouldEnableThinking(provider, alienModel);

    // Must be true because registry said so — not because of substring match.
    expect(result).toBe(true);
    expect(supportsThinkingMock).toHaveBeenCalledWith(alienModel);
  });

  it('negative: model with former substring marker but registry=false must return false', async () => {
    // Model whose name contains 'sonnet-4' (former marker).
    const markerModel = 'us.vendor.sonnet-4-test';
    supportsThinkingMock.mockReturnValue(false); // registry says NO

    const provider = await makeProvider(true);
    const result = callShouldEnableThinking(provider, markerModel);

    // Must respect registry=false, not substring marker.
    expect(result).toBe(false);
    expect(supportsThinkingMock).toHaveBeenCalledWith(markerModel);
  });
});

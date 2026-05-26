/**
 * SmartModelRouter — per-model functionCallingAccuracy sourced from the
 * first-class registry column (ModelRoleAssignment.function_calling_accuracy).
 *
 * Root cause this pins: createProfileFromDiscovery previously read FCA ONLY
 * from the capabilities JSON blob (defaulting to 0 when absent). All live
 * registry rows had an empty capabilities blob, so every model scored FCA=0,
 * failed every FCA floor, and the router could never select on capability or
 * route DOWN to a cheap model. The fix makes FCA a first-class column that the
 * profile builder reads, falling back to the capabilities JSON for legacy rows.
 *
 * Contract:
 *   1. registryRow.functionCallingAccuracy (the column) wins.
 *   2. When the column is null/undefined, fall back to
 *      capabilities.functionCallingAccuracy.
 *   3. When neither is present, default to 0 (unchanged).
 */
import { describe, test, expect, beforeEach } from 'vitest';
import { SmartModelRouter } from '../../SmartModelRouter.js';

const SILENT_LOGGER: any = {
  info: () => {},
  warn: () => {},
  error: () => {},
  debug: () => {},
  child: () => SILENT_LOGGER,
};

describe('SmartModelRouter — FCA from first-class column', () => {
  let router: SmartModelRouter;

  beforeEach(() => {
    router = new SmartModelRouter(SILENT_LOGGER);
  });

  test('column functionCallingAccuracy is used when capabilities JSON lacks it', () => {
    const model: any = { id: 'gpt-oss:20b' };
    const registryRow = {
      capabilities: { chat: true, functionCalling: true } as Record<string, any>,
      contextWindowTokens: 32_000,
      functionCallingAccuracy: 0.87, // the new first-class column
    };

    const profile = (router as any).createProfileFromDiscovery(model, 'hal-ollama', registryRow);

    expect(profile.capabilities.functionCallingAccuracy).toBe(0.87);
  });

  test('column takes precedence over capabilities JSON when both present', () => {
    const model: any = { id: 'us.anthropic.claude-sonnet-4-5-20250929-v1:0' };
    const registryRow = {
      capabilities: { chat: true, functionCalling: true, functionCallingAccuracy: 0.50 } as Record<string, any>,
      contextWindowTokens: 200_000,
      functionCallingAccuracy: 0.96,
    };

    const profile = (router as any).createProfileFromDiscovery(model, 'bedrock-dev', registryRow);

    expect(profile.capabilities.functionCallingAccuracy).toBe(0.96);
  });

  test('falls back to capabilities JSON when column is null', () => {
    const model: any = { id: 'legacy-model' };
    const registryRow = {
      capabilities: { chat: true, functionCalling: true, functionCallingAccuracy: 0.91 } as Record<string, any>,
      contextWindowTokens: 8_192,
      functionCallingAccuracy: null,
    };

    const profile = (router as any).createProfileFromDiscovery(model, 'some-provider', registryRow);

    expect(profile.capabilities.functionCallingAccuracy).toBe(0.91);
  });

  test('defaults to 0 when neither column nor capabilities JSON has FCA', () => {
    const model: any = { id: 'bare-model' };
    const registryRow = {
      capabilities: { chat: true } as Record<string, any>,
      contextWindowTokens: 8_192,
      // no functionCallingAccuracy anywhere
    };

    const profile = (router as any).createProfileFromDiscovery(model, 'some-provider', registryRow);

    expect(profile.capabilities.functionCallingAccuracy).toBe(0);
  });
});

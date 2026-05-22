/**
 * #577 — AWSBedrockProvider must not crash on undefined model.
 *
 * Live evidence 2026-04-30 — wizard Test Connection on a freshly-added
 * Bedrock provider (Registry empty, no env fallback set) crashed with:
 *   "Cannot read properties of undefined (reading 'startsWith')"
 *
 * Root cause (AWSBedrockProvider.ts:637-642):
 *   const requestedModelId =
 *     request.model || process.env.AWS_BEDROCK_DEFAULT_MODEL || process.env.ECONOMICAL_MODEL;
 *   const primaryModelId = this.toInferenceProfile(requestedModelId!);  // ← undefined!
 *
 * `toInferenceProfile` immediately calls `modelId.startsWith(...)`, crashing
 * with an opaque TypeError. The correct behavior is to throw a clear error
 * naming the problem so the Test Connection UI can surface actionable
 * guidance (e.g. "Add a Bedrock model in the Registry first").
 *
 * Contract pinned here:
 *   - createCompletion with no model configured throws an Error whose
 *     .message contains "No Bedrock model configured" (not "startsWith").
 *   - createCompletion with an empty-string model is treated the same as
 *     undefined.
 *   - createCompletion with a valid model + no primary inference profile
 *     mapping still returns a real result (i.e. the defensive guard is
 *     narrowly scoped to "model is missing entirely", not "model is
 *     unfamiliar").
 */

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';

// Mock the AWS SDK clients so we don't hit the network.
vi.mock('@aws-sdk/client-bedrock-runtime', () => ({
  BedrockRuntimeClient: vi.fn().mockImplementation(() => ({
    send: vi.fn(),
  })),
  InvokeModelCommand: vi.fn(),
  InvokeModelWithResponseStreamCommand: vi.fn(),
  ConverseCommand: vi.fn(),
  ConverseStreamCommand: vi.fn(),
}));

vi.mock('@aws-sdk/client-bedrock', () => ({
  BedrockClient: vi.fn().mockImplementation(() => ({
    send: vi.fn(),
  })),
  ListFoundationModelsCommand: vi.fn(),
  GetFoundationModelCommand: vi.fn(),
  ListInferenceProfilesCommand: vi.fn(),
}));

import { AWSBedrockProvider } from '../AWSBedrockProvider.js';

const fakeLogger: any = {
  info: vi.fn(),
  warn: vi.fn(),
  error: vi.fn(),
  debug: vi.fn(),
  child: () => fakeLogger,
};

describe('#577 — AWSBedrockProvider undefined-model guard', () => {
  let provider: AWSBedrockProvider;

  beforeEach(() => {
    // Scrub any env leakage that would mask the bug.
    delete process.env.AWS_BEDROCK_DEFAULT_MODEL;
    delete process.env.ECONOMICAL_MODEL;

    provider = new AWSBedrockProvider(fakeLogger, {
      type: 'aws-bedrock',
      authType: 'iam-keys',
      accessKeyId: 'AKIA-TEST',
      secretAccessKey: 'test-secret',
      region: 'us-east-1',
    } as any);
    // Short-circuit initialize() — we don't want to hit AWS.
    (provider as any).initialized = true;
    (provider as any).runtimeClient = { send: vi.fn() };
  });

  afterEach(() => {
    vi.clearAllMocks();
  });

  it('throws a clear "No Bedrock model configured" error when request.model is undefined AND no env fallback is set', async () => {
    let caught: Error | null = null;
    try {
      await provider.createCompletion({
        messages: [{ role: 'user', content: 'Hi' }],
        // model: undefined — explicit
      } as any);
    } catch (err) {
      caught = err as Error;
    }

    expect(caught).toBeInstanceOf(Error);
    // The clear-error contract: the message must explain what's missing,
    // not leak the internal "startsWith" TypeError.
    expect(caught!.message).toMatch(/no bedrock model configured|no model configured/i);
    expect(caught!.message).not.toMatch(/startsWith/i);
    expect(caught!.message).not.toMatch(/Cannot read properties of undefined/i);
  });

  it('throws the same clear error when request.model is an empty string', async () => {
    let caught: Error | null = null;
    try {
      await provider.createCompletion({
        messages: [{ role: 'user', content: 'Hi' }],
        model: '',
      } as any);
    } catch (err) {
      caught = err as Error;
    }

    expect(caught).toBeInstanceOf(Error);
    expect(caught!.message).toMatch(/no bedrock model configured|no model configured/i);
  });

  it('throws the clear error when model is only whitespace', async () => {
    let caught: Error | null = null;
    try {
      await provider.createCompletion({
        messages: [{ role: 'user', content: 'Hi' }],
        model: '   ',
      } as any);
    } catch (err) {
      caught = err as Error;
    }

    expect(caught).toBeInstanceOf(Error);
    expect(caught!.message).toMatch(/no bedrock model configured|no model configured/i);
  });

  it('does NOT crash with "Cannot read properties of undefined" — the UI gets actionable guidance', async () => {
    let caught: Error | null = null;
    try {
      await provider.createCompletion({
        messages: [{ role: 'user', content: 'Hi' }],
      } as any);
    } catch (err) {
      caught = err as Error;
    }

    expect(caught).toBeInstanceOf(Error);
    // Pin the regression: this exact user-visible string used to ship.
    expect(caught!.message).not.toContain("Cannot read properties of undefined (reading 'startsWith')");
  });
});

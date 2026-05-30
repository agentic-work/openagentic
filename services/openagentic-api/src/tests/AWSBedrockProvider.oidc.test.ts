/**
 * AWSBedrockProvider — OIDC federation integration tests (TDD).
 *
 * Covers the `resolveCredentials` + `getBedrockClient` factory that
 * swaps in user-scoped OIDC-derived creds when a callerContext with
 * an AAD token is supplied. When no callerContext is present, the
 * provider must fall through to the existing static-cred / default-
 * chain path — i.e. back-compat for legacy service-init flows.
 */

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';

// -----------------------------------------------------------------------------
// Hoisted mocks
// -----------------------------------------------------------------------------
const {
  assumeRoleMock,
  runtimeCtorSpy,
  runtimeSendMock,
  bedrockCtorSpy,
  bedrockSendMock,
} = vi.hoisted(() => ({
  assumeRoleMock: vi.fn(),
  runtimeCtorSpy: vi.fn(),
  runtimeSendMock: vi.fn(),
  bedrockCtorSpy: vi.fn(),
  bedrockSendMock: vi.fn(),
}));

vi.mock('../services/llm-providers/AWSOIDCFederation.js', () => ({
  assumeRoleWithAADToken: assumeRoleMock,
  __clearOIDCCache: vi.fn(),
}));

vi.mock('@aws-sdk/client-bedrock-runtime', () => {
  class BedrockRuntimeClient {
    public config: Record<string, unknown>;
    constructor(cfg: Record<string, unknown>) {
      this.config = cfg;
      runtimeCtorSpy(cfg);
    }
    send(cmd: unknown) {
      return runtimeSendMock(cmd);
    }
  }
  class InvokeModelCommand {
    input: Record<string, unknown>;
    constructor(input: Record<string, unknown>) {
      this.input = input;
    }
  }
  class InvokeModelWithResponseStreamCommand {
    input: Record<string, unknown>;
    constructor(input: Record<string, unknown>) {
      this.input = input;
    }
  }
  class ConverseCommand {
    input: Record<string, unknown>;
    constructor(input: Record<string, unknown>) {
      this.input = input;
    }
  }
  class ConverseStreamCommand {
    input: Record<string, unknown>;
    constructor(input: Record<string, unknown>) {
      this.input = input;
    }
  }
  return {
    BedrockRuntimeClient,
    InvokeModelCommand,
    InvokeModelWithResponseStreamCommand,
    ConverseCommand,
    ConverseStreamCommand,
  };
});

vi.mock('@aws-sdk/client-bedrock', () => {
  class BedrockClient {
    public config: Record<string, unknown>;
    constructor(cfg: Record<string, unknown>) {
      this.config = cfg;
      bedrockCtorSpy(cfg);
    }
    send(cmd: unknown) {
      return bedrockSendMock(cmd);
    }
  }
  class ListFoundationModelsCommand {
    constructor(public input?: Record<string, unknown>) {}
  }
  class GetFoundationModelCommand {
    constructor(public input: Record<string, unknown>) {}
  }
  class ListInferenceProfilesCommand {
    constructor(public input?: Record<string, unknown>) {}
  }
  return {
    BedrockClient,
    ListFoundationModelsCommand,
    GetFoundationModelCommand,
    ListInferenceProfilesCommand,
  };
});

// Import after mocks so provider sees mocked SDK clients.
import { AWSBedrockProvider } from '../services/llm-providers/AWSBedrockProvider.js';

// -----------------------------------------------------------------------------
// Fixtures
// -----------------------------------------------------------------------------
function mockLogger() {
  return {
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
    debug: vi.fn(),
    trace: vi.fn(),
    fatal: vi.fn(),
    child: vi.fn().mockReturnThis(),
  } as any;
}

async function initializedProvider(): Promise<AWSBedrockProvider> {
  const provider = new AWSBedrockProvider(mockLogger());
  // ListFoundationModelsCommand returns something non-throwing.
  bedrockSendMock.mockResolvedValue({ modelSummaries: [] });
  await provider.initialize({ region: 'us-east-1' });
  return provider;
}

const OIDC_CREDS = {
  accessKeyId: 'ASIA-OIDC',
  secretAccessKey: 'oidc-secret',
  sessionToken: 'oidc-session-token',
  expiration: new Date(Date.now() + 3600 * 1000),
};

const AAD_TOKEN = 'eyJhbGciOiJSUzI1NiJ9.fake.sig';

beforeEach(() => {
  assumeRoleMock.mockReset();
  runtimeCtorSpy.mockReset();
  runtimeSendMock.mockReset();
  bedrockCtorSpy.mockReset();
  bedrockSendMock.mockReset();
});

afterEach(() => {
  vi.clearAllMocks();
});

// -----------------------------------------------------------------------------
// Tests
// -----------------------------------------------------------------------------

describe('AWSBedrockProvider.resolveCredentials', () => {
  it('returns OIDC-derived creds when callerContext has aadToken', async () => {
    const provider = await initializedProvider();
    assumeRoleMock.mockResolvedValueOnce(OIDC_CREDS);

    const creds = await (provider as any).resolveCredentials({
      aadToken: AAD_TOKEN,
      userEmail: 'alice@example.com',
    });

    expect(assumeRoleMock).toHaveBeenCalledTimes(1);
    expect(assumeRoleMock).toHaveBeenCalledWith(
      AAD_TOKEN,
      expect.objectContaining({ userEmail: 'alice@example.com' }),
    );
    expect(creds).toEqual(OIDC_CREDS);
  });

  it('returns null (fall-through) when no callerContext provided', async () => {
    const provider = await initializedProvider();
    const creds = await (provider as any).resolveCredentials(undefined);
    expect(creds).toBeNull();
    expect(assumeRoleMock).not.toHaveBeenCalled();
  });

  it('returns null when callerContext has no aadToken', async () => {
    const provider = await initializedProvider();
    const creds = await (provider as any).resolveCredentials({
      userEmail: 'alice@example.com',
    });
    expect(creds).toBeNull();
    expect(assumeRoleMock).not.toHaveBeenCalled();
  });
});

describe('AWSBedrockProvider.getBedrockClient factory', () => {
  it('returns a fresh client whose config.credentials are the OIDC creds when callerContext provided', async () => {
    const provider = await initializedProvider();
    assumeRoleMock.mockResolvedValueOnce(OIDC_CREDS);

    const initialCtorCount = runtimeCtorSpy.mock.calls.length;

    const client = await (provider as any).getBedrockClient({
      aadToken: AAD_TOKEN,
      userEmail: 'alice@example.com',
    });

    // A new BedrockRuntimeClient was constructed beyond the initial singleton.
    expect(runtimeCtorSpy.mock.calls.length).toBeGreaterThan(initialCtorCount);

    const cfg = (client as any).config;
    expect(cfg.credentials).toEqual({
      accessKeyId: OIDC_CREDS.accessKeyId,
      secretAccessKey: OIDC_CREDS.secretAccessKey,
      sessionToken: OIDC_CREDS.sessionToken,
    });
  });

  it('returns the singleton runtimeClient when no callerContext', async () => {
    const provider = await initializedProvider();
    const singleton = (provider as any).runtimeClient;

    const ctorCountBefore = runtimeCtorSpy.mock.calls.length;
    const client = await (provider as any).getBedrockClient();

    // No extra construction — returned the pre-existing singleton.
    expect(runtimeCtorSpy.mock.calls.length).toBe(ctorCountBefore);
    expect(client).toBe(singleton);
    expect(assumeRoleMock).not.toHaveBeenCalled();
  });

  it('returns the singleton when callerContext has no aadToken', async () => {
    const provider = await initializedProvider();
    const singleton = (provider as any).runtimeClient;

    const client = await (provider as any).getBedrockClient({
      userEmail: 'alice@example.com',
    });

    expect(client).toBe(singleton);
    expect(assumeRoleMock).not.toHaveBeenCalled();
  });

  it('end-to-end: OIDC-derived client runs .send with OIDC creds', async () => {
    const provider = await initializedProvider();
    assumeRoleMock.mockResolvedValueOnce(OIDC_CREDS);
    runtimeSendMock.mockResolvedValueOnce({
      body: new TextEncoder().encode(JSON.stringify({ content: [{ text: 'ok' }] })),
    });

    const client = await (provider as any).getBedrockClient({
      aadToken: AAD_TOKEN,
      userEmail: 'alice@example.com',
    });

    const { InvokeModelCommand } = await import('@aws-sdk/client-bedrock-runtime');
    const cmd = new (InvokeModelCommand as any)({
      modelId: 'us.anthropic.claude-sonnet-4-6',
      body: JSON.stringify({ messages: [] }),
      contentType: 'application/json',
      accept: 'application/json',
    });

    await client.send(cmd);

    expect(runtimeSendMock).toHaveBeenCalledTimes(1);
    expect((client as any).config.credentials).toEqual({
      accessKeyId: OIDC_CREDS.accessKeyId,
      secretAccessKey: OIDC_CREDS.secretAccessKey,
      sessionToken: OIDC_CREDS.sessionToken,
    });
  });
});

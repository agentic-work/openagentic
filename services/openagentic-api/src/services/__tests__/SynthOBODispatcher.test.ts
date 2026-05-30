/**
 * SynthOBODispatcher — RED tests for the OBO-aware synth dispatch path
 * (chatmode-rip Phase C.5 dispatcher refactor).
 *
 * Plan: docs/superpowers/plans/2026-05-10-chatmode-rip-implementation.md
 * §Phase C task C.5 steps 1-5:
 *   - "refuses to run if userJwt missing — returns clear error, never
 *      calls broker"
 *   - "brokers credentials per capability list"
 *   - "passes brokered creds to SynthExecutorClient, never logs them in
 *      plaintext"
 *
 * The dispatcher wraps executeSynthExecute (existing) by:
 *   1. requiring ctx.userJwt
 *   2. filtering capabilities[] to cloud targets (aws/azure/gcp)
 *   3. calling CredentialBroker.brokerFor(userJwt, [cloud targets])
 *   4. flattening BrokeredCredentials → Record<string,string>
 *   5. forwarding flattened creds via the existing input.credentials path
 *
 * This file pins the contract; the CredentialBroker integration tests
 * + SynthExecutorClient unit tests already cover the deeper layers.
 */
import { describe, it, expect, vi } from 'vitest';
import { executeSynthOBO } from '../SynthOBODispatcher.js';

const SILENT_LOGGER = {
  info: () => {},
  warn: () => {},
  error: () => {},
  debug: () => {},
};

function makeStubBroker() {
  return {
    brokerFor: vi.fn().mockResolvedValue({
      aws: {
        AWS_ACCESS_KEY_ID: 'AKIA-x',
        AWS_SECRET_ACCESS_KEY: 'sec',
        AWS_SESSION_TOKEN: 'tok',
        AWS_DEFAULT_REGION: 'us-east-1',
      },
    }),
  };
}

function makeStubClient() {
  return {
    execute: vi.fn().mockResolvedValue({
      success: true,
      stdout: 'ok',
      stderr: '',
      result: 42,
      executionTimeMs: 12,
    }),
  };
}

describe('executeSynthOBO (chatmode-rip Phase C.5 dispatcher)', () => {
  it('refuses when ctx.userJwt is missing — never calls broker', async () => {
    const broker = makeStubBroker();
    const client = makeStubClient();
    const result = await executeSynthOBO(
      { userId: 'u1', logger: SILENT_LOGGER },
      { code: 'print(1)', intent: 'test', capabilities: ['aws'] },
      { broker, client },
    );
    expect(result.ok).toBe(false);
    expect(result.error).toMatch(/auth|jwt|sign in|userJwt/i);
    expect(broker.brokerFor).not.toHaveBeenCalled();
    expect(client.execute).not.toHaveBeenCalled();
  });

  it('refuses when ctx.userJwt is empty string', async () => {
    const broker = makeStubBroker();
    const client = makeStubClient();
    const result = await executeSynthOBO(
      { userId: 'u1', userJwt: '', logger: SILENT_LOGGER },
      { code: 'print(1)', intent: 'test', capabilities: ['aws'] },
      { broker, client },
    );
    expect(result.ok).toBe(false);
    expect(broker.brokerFor).not.toHaveBeenCalled();
  });

  it('brokers cloud capabilities and forwards flattened creds to client', async () => {
    const broker = makeStubBroker();
    const client = makeStubClient();
    const result = await executeSynthOBO(
      { userId: 'u1', userJwt: 'eyJ-access', logger: SILENT_LOGGER },
      {
        code: 'print(1)',
        intent: 'list S3 buckets',
        capabilities: ['aws', 'http', 'json'],
      },
      { broker, client },
    );
    expect(result.ok).toBe(true);
    // Broker called with ONLY the cloud targets — not 'http' / 'json'.
    expect(broker.brokerFor).toHaveBeenCalledWith('eyJ-access', ['aws']);
    // Client called with flattened cred env-vars.
    const clientCall = client.execute.mock.calls[0][0];
    expect(clientCall.credentials).toMatchObject({
      AWS_ACCESS_KEY_ID: 'AKIA-x',
      AWS_SECRET_ACCESS_KEY: 'sec',
      AWS_SESSION_TOKEN: 'tok',
      AWS_DEFAULT_REGION: 'us-east-1',
    });
  });

  it('skips broker when no cloud capabilities declared (empty / non-cloud only)', async () => {
    const broker = makeStubBroker();
    const client = makeStubClient();
    await executeSynthOBO(
      { userId: 'u1', userJwt: 'eyJ-access', logger: SILENT_LOGGER },
      { code: 'print(1)', intent: 'compute', capabilities: ['http', 'json'] },
      { broker, client },
    );
    expect(broker.brokerFor).not.toHaveBeenCalled();
    // But client.execute STILL fires — synth without cloud creds is valid.
    expect(client.execute).toHaveBeenCalled();
    // No credentials forwarded — undefined or empty.
    const clientCall = client.execute.mock.calls[0][0];
    expect(clientCall.credentials).toBeUndefined();
  });

  it('skips broker when capabilities is undefined (no declaration)', async () => {
    const broker = makeStubBroker();
    const client = makeStubClient();
    await executeSynthOBO(
      { userId: 'u1', userJwt: 'eyJ-access', logger: SILENT_LOGGER },
      { code: 'print(1)', intent: 'compute' },
      { broker, client },
    );
    expect(broker.brokerFor).not.toHaveBeenCalled();
  });

  it('returns ok:false with broker error when broker throws (cred leak guard)', async () => {
    const broker = {
      brokerFor: vi.fn().mockRejectedValue(new Error('STS denied')),
    };
    const client = makeStubClient();
    const result = await executeSynthOBO(
      { userId: 'u1', userJwt: 'eyJ-access', logger: SILENT_LOGGER },
      { code: 'print(1)', intent: 'test', capabilities: ['aws'] },
      { broker, client },
    );
    expect(result.ok).toBe(false);
    expect(result.error).toMatch(/STS denied|broker|credentials/i);
    expect(client.execute).not.toHaveBeenCalled();
  });

  // The old "intent-vs-capabilities" narrative-regex guard was RIPPED in
  // Q1-blocker-12 (2026-05-13) after the Q1-redrive showed the model
  // could trivially dodge it with generic "across clouds" phrasing. The
  // replacement (code-import scan) lives in `SynthOBODispatcher.codeImports.test.ts`.

  it('flattens multiple cloud creds (aws + azure + gcp)', async () => {
    const broker = {
      brokerFor: vi.fn().mockResolvedValue({
        aws: { AWS_ACCESS_KEY_ID: 'a', AWS_SECRET_ACCESS_KEY: 'b', AWS_SESSION_TOKEN: 'c', AWS_DEFAULT_REGION: 'us-east-1' },
        azure: { AZURE_ACCESS_TOKEN: 'eyJ-azure' },
        gcp: { GOOGLE_SA_JSON: '{"type":"service_account"}' },
      }),
    };
    const client = makeStubClient();
    await executeSynthOBO(
      { userId: 'u1', userJwt: 'eyJ-access', logger: SILENT_LOGGER },
      {
        code: 'print(1)',
        intent: 'multi-cloud',
        capabilities: ['aws', 'azure', 'gcp'],
      },
      { broker, client },
    );
    const clientCall = client.execute.mock.calls[0][0];
    expect(clientCall.credentials).toMatchObject({
      AWS_ACCESS_KEY_ID: 'a',
      AZURE_ACCESS_TOKEN: 'eyJ-azure',
      GOOGLE_SA_JSON: '{"type":"service_account"}',
    });
  });
});

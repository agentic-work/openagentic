/**
 * AWSOIDCFederation unit tests (TDD — written before implementation).
 *
 * Verifies the AssumeRoleWithWebIdentity flow that exchanges an Azure AD
 * ID token for short-lived AWS credentials. Mirrors the Python reference
 * at `services/mcps/oap-aws-mcp/server.py::_get_credentials_via_direct_oidc`.
 */

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';

// -----------------------------------------------------------------------------
// Hoisted STS mock
// -----------------------------------------------------------------------------
const { sendMock, stsCtorSpy, commandCtorSpy } = vi.hoisted(() => ({
  sendMock: vi.fn(),
  stsCtorSpy: vi.fn(),
  commandCtorSpy: vi.fn(),
}));

vi.mock('@aws-sdk/client-sts', () => {
  class MockSTSClient {
    constructor(cfg: unknown) {
      stsCtorSpy(cfg);
    }
    send(cmd: unknown) {
      return sendMock(cmd);
    }
  }
  class MockAssumeRoleWithWebIdentityCommand {
    input: Record<string, unknown>;
    constructor(input: Record<string, unknown>) {
      commandCtorSpy(input);
      this.input = input;
    }
  }
  return {
    STSClient: MockSTSClient,
    AssumeRoleWithWebIdentityCommand: MockAssumeRoleWithWebIdentityCommand,
  };
});

// Imported AFTER vi.mock so the module sees the mocked SDK.
import {
  assumeRoleWithAADToken,
  __clearOIDCCache,
} from '../AWSOIDCFederation.js';

// -----------------------------------------------------------------------------
// Helpers
// -----------------------------------------------------------------------------
function buildStsSuccess(overrides: Partial<{
  AccessKeyId: string;
  SecretAccessKey: string;
  SessionToken: string;
  Expiration: Date;
}> = {}) {
  return {
    Credentials: {
      AccessKeyId: 'ASIATESTACCESS',
      SecretAccessKey: 'test-secret-key',
      SessionToken: 'test-session-token',
      Expiration: new Date(Date.now() + 3600 * 1000),
      ...overrides,
    },
    AssumedRoleUser: {
      Arn: 'arn:aws:sts::123456789012:assumed-role/OpenAgenticOBORole/test-session',
      AssumedRoleId: 'AROATEST:test-session',
    },
  };
}

// jwt-ish shape, doesn't need to be a real token because the SDK is mocked
const AAD_TOKEN = 'eyJhbGciOiJSUzI1NiIsInR5cCI6IkpXVCJ9.payload.sig';
const AAD_TOKEN_2 = 'eyJhbGciOiJSUzI1NiIsInR5cCI6IkpXVCJ9.payload2.sig';

const SAVED_ENV = {
  AWS_OBO_ROLE_ARN: process.env.AWS_OBO_ROLE_ARN,
  AWS_ACCOUNT_ID: process.env.AWS_ACCOUNT_ID,
  AWS_REGION: process.env.AWS_REGION,
};

beforeEach(() => {
  sendMock.mockReset();
  stsCtorSpy.mockReset();
  commandCtorSpy.mockReset();
  __clearOIDCCache();
  delete process.env.AWS_OBO_ROLE_ARN;
  delete process.env.AWS_ACCOUNT_ID;
  delete process.env.AWS_REGION;
  vi.useRealTimers();
});

afterEach(() => {
  process.env.AWS_OBO_ROLE_ARN = SAVED_ENV.AWS_OBO_ROLE_ARN;
  process.env.AWS_ACCOUNT_ID = SAVED_ENV.AWS_ACCOUNT_ID;
  process.env.AWS_REGION = SAVED_ENV.AWS_REGION;
  vi.useRealTimers();
});

// -----------------------------------------------------------------------------
// Tests
// -----------------------------------------------------------------------------

describe('AWSOIDCFederation.assumeRoleWithAADToken', () => {
  it('maps STS Credentials to the typed shape on happy path', async () => {
    const expiration = new Date(Date.now() + 3600 * 1000);
    sendMock.mockResolvedValueOnce(buildStsSuccess({ Expiration: expiration }));

    const creds = await assumeRoleWithAADToken(AAD_TOKEN, {
      roleArn: 'arn:aws:iam::123456789012:role/OpenAgenticOBORole',
      userEmail: 'alice@example.com',
    });

    expect(creds).toEqual({
      accessKeyId: 'ASIATESTACCESS',
      secretAccessKey: 'test-secret-key',
      sessionToken: 'test-session-token',
      expiration,
    });
    expect(sendMock).toHaveBeenCalledTimes(1);
  });

  it('throws when aadToken is empty', async () => {
    await expect(
      assumeRoleWithAADToken('', {
        roleArn: 'arn:aws:iam::123456789012:role/OpenAgenticOBORole',
        userEmail: 'alice@example.com',
      }),
    ).rejects.toThrow(/aadToken/i);
    expect(sendMock).not.toHaveBeenCalled();
  });

  it('throws a descriptive error when no roleArn is resolvable', async () => {
    // no opts.roleArn, no env
    await expect(
      assumeRoleWithAADToken(AAD_TOKEN, { userEmail: 'alice@example.com' }),
    ).rejects.toThrow(/role.?arn|AWS_OBO_ROLE_ARN|AWS_ACCOUNT_ID/i);
    expect(sendMock).not.toHaveBeenCalled();
  });

  it('uses AWS_OBO_ROLE_ARN when opts.roleArn absent', async () => {
    process.env.AWS_OBO_ROLE_ARN =
      'arn:aws:iam::123456789012:role/OpenAgenticOBORole';
    sendMock.mockResolvedValueOnce(buildStsSuccess());

    await assumeRoleWithAADToken(AAD_TOKEN, {
      userEmail: 'alice@example.com',
    });

    expect(commandCtorSpy).toHaveBeenCalledTimes(1);
    expect(commandCtorSpy.mock.calls[0][0].RoleArn).toBe(
      'arn:aws:iam::123456789012:role/OpenAgenticOBORole',
    );
  });

  it('constructs roleArn from AWS_ACCOUNT_ID when neither opts.roleArn nor AWS_OBO_ROLE_ARN set', async () => {
    process.env.AWS_ACCOUNT_ID = '123456789012';
    sendMock.mockResolvedValueOnce(buildStsSuccess());

    await assumeRoleWithAADToken(AAD_TOKEN, {
      userEmail: 'alice@example.com',
    });

    expect(commandCtorSpy.mock.calls[0][0].RoleArn).toBe(
      'arn:aws:iam::123456789012:role/OpenAgenticOBORole',
    );
  });

  it('sanitizes RoleSessionName (@→-at-, .→-) and caps at 32 chars', async () => {
    sendMock.mockResolvedValueOnce(buildStsSuccess());

    await assumeRoleWithAADToken(AAD_TOKEN, {
      roleArn: 'arn:aws:iam::123456789012:role/OpenAgenticOBORole',
      userEmail: 'alice@example.com',
    });

    const sessionName = commandCtorSpy.mock.calls[0][0].RoleSessionName as string;
    // alice-at-example-com — within 32 chars, no @ or .
    expect(sessionName).not.toMatch(/[@.]/);
    expect(sessionName.length).toBeLessThanOrEqual(32);
    expect(sessionName).toContain('alice-at-example-com');
  });

  it('caps RoleSessionName when user identifier is long', async () => {
    sendMock.mockResolvedValueOnce(buildStsSuccess());

    await assumeRoleWithAADToken(AAD_TOKEN, {
      roleArn: 'arn:aws:iam::123456789012:role/OpenAgenticOBORole',
      userEmail: 'someverylongusername@extra.long.subdomain.example.com',
    });

    const sessionName = commandCtorSpy.mock.calls[0][0].RoleSessionName as string;
    expect(sessionName.length).toBeLessThanOrEqual(32);
  });

  it('returns cached creds on second call with same aadToken (no STS re-call)', async () => {
    sendMock.mockResolvedValueOnce(
      buildStsSuccess({ Expiration: new Date(Date.now() + 3600 * 1000) }),
    );

    const first = await assumeRoleWithAADToken(AAD_TOKEN, {
      roleArn: 'arn:aws:iam::123456789012:role/OpenAgenticOBORole',
      userEmail: 'alice@example.com',
    });
    const second = await assumeRoleWithAADToken(AAD_TOKEN, {
      roleArn: 'arn:aws:iam::123456789012:role/OpenAgenticOBORole',
      userEmail: 'alice@example.com',
    });

    expect(second).toEqual(first);
    expect(sendMock).toHaveBeenCalledTimes(1);
  });

  it('does not return cached creds for a different aadToken', async () => {
    sendMock
      .mockResolvedValueOnce(buildStsSuccess({ AccessKeyId: 'KEY-A' }))
      .mockResolvedValueOnce(buildStsSuccess({ AccessKeyId: 'KEY-B' }));

    const first = await assumeRoleWithAADToken(AAD_TOKEN, {
      roleArn: 'arn:aws:iam::123456789012:role/OpenAgenticOBORole',
      userEmail: 'alice@example.com',
    });
    const second = await assumeRoleWithAADToken(AAD_TOKEN_2, {
      roleArn: 'arn:aws:iam::123456789012:role/OpenAgenticOBORole',
      userEmail: 'alice@example.com',
    });

    expect(first.accessKeyId).toBe('KEY-A');
    expect(second.accessKeyId).toBe('KEY-B');
    expect(sendMock).toHaveBeenCalledTimes(2);
  });

  it('expires cached entry near end of credential lifetime', async () => {
    const start = new Date('2026-04-22T12:00:00Z');
    vi.useFakeTimers();
    vi.setSystemTime(start);

    const expiration = new Date(start.getTime() + 900 * 1000); // 15 min life
    sendMock
      .mockResolvedValueOnce(buildStsSuccess({ Expiration: expiration, AccessKeyId: 'FRESH-1' }))
      .mockResolvedValueOnce(buildStsSuccess({ Expiration: new Date(start.getTime() + 1800 * 1000), AccessKeyId: 'FRESH-2' }));

    const first = await assumeRoleWithAADToken(AAD_TOKEN, {
      roleArn: 'arn:aws:iam::123456789012:role/OpenAgenticOBORole',
      userEmail: 'alice@example.com',
    });
    expect(first.accessKeyId).toBe('FRESH-1');

    // Advance past expiration — cache entry should be evicted
    vi.setSystemTime(new Date(start.getTime() + 1000 * 1000));

    const second = await assumeRoleWithAADToken(AAD_TOKEN, {
      roleArn: 'arn:aws:iam::123456789012:role/OpenAgenticOBORole',
      userEmail: 'alice@example.com',
    });
    expect(second.accessKeyId).toBe('FRESH-2');
    expect(sendMock).toHaveBeenCalledTimes(2);
  });

  it('propagates STS errors with meaningful message', async () => {
    const stsError = Object.assign(new Error('The ID token is invalid'), {
      name: 'InvalidIdentityTokenException',
    });
    sendMock.mockRejectedValueOnce(stsError);

    await expect(
      assumeRoleWithAADToken(AAD_TOKEN, {
        roleArn: 'arn:aws:iam::123456789012:role/OpenAgenticOBORole',
        userEmail: 'alice@example.com',
      }),
    ).rejects.toThrow(/InvalidIdentityToken|ID token is invalid/);
  });

  it('passes DurationSeconds 3600 by default and respects opts override', async () => {
    sendMock.mockResolvedValue(buildStsSuccess());

    await assumeRoleWithAADToken(AAD_TOKEN, {
      roleArn: 'arn:aws:iam::123456789012:role/OpenAgenticOBORole',
      userEmail: 'alice@example.com',
    });
    expect(commandCtorSpy.mock.calls[0][0].DurationSeconds).toBe(3600);

    await assumeRoleWithAADToken(AAD_TOKEN_2, {
      roleArn: 'arn:aws:iam::123456789012:role/OpenAgenticOBORole',
      userEmail: 'alice@example.com',
      durationSeconds: 1800,
    });
    expect(commandCtorSpy.mock.calls[1][0].DurationSeconds).toBe(1800);
  });

  it('forwards the aadToken as WebIdentityToken', async () => {
    sendMock.mockResolvedValueOnce(buildStsSuccess());
    await assumeRoleWithAADToken(AAD_TOKEN, {
      roleArn: 'arn:aws:iam::123456789012:role/OpenAgenticOBORole',
      userEmail: 'alice@example.com',
    });
    expect(commandCtorSpy.mock.calls[0][0].WebIdentityToken).toBe(AAD_TOKEN);
  });
});

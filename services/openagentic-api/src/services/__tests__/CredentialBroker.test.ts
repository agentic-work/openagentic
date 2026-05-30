/**
 * CredentialBroker — TDD spec (tests first).
 *
 * The broker turns a user's AAD token + a list of cloud targets into an
 * env-var dict that can be injected into synth-executor's /execute
 * `credentials` field. It composes:
 *   - AWS:   AAD → STS AssumeRoleWithWebIdentity (via AWSOIDCFederation)
 *   - Azure: AAD token is *itself* the ARM bearer token (pass-through
 *            with audience validation)
 *   - GCP:   SA JSON loaded from GOOGLE_APPLICATION_CREDENTIALS path or
 *            GOOGLE_APPLICATION_CREDENTIALS_JSON env (temporary until
 *            WIF pool for AAD is provisioned)
 */

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';

// Hoist the AWS OIDC mock *before* CredentialBroker imports it.
const { assumeRoleMock, clearCacheMock } = vi.hoisted(() => ({
  assumeRoleMock: vi.fn(),
  clearCacheMock: vi.fn(),
}));

vi.mock('../llm-providers/AWSOIDCFederation.js', () => ({
  assumeRoleWithAADToken: assumeRoleMock,
  __clearOIDCCache: clearCacheMock,
  deriveRoleSessionName: (email?: string) => `sess-${email || 'anon'}`.slice(0, 64),
}));

// Import under test AFTER the mocks are set.
import {
  CredentialBroker,
  CloudTarget,
  InvalidJwtError,
  UnknownCloudError,
} from '../CredentialBroker.js';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/**
 * Minimal JWT builder for tests — header.payload.sig with base64url payload.
 * No cryptographic validity; the broker only parses claims.
 */
function makeJwt(claims: Record<string, unknown>): string {
  const enc = (o: unknown) =>
    Buffer.from(JSON.stringify(o)).toString('base64url');
  return `${enc({ alg: 'none', typ: 'JWT' })}.${enc(claims)}.sig`;
}

const VALID_USER_JWT = makeJwt({
  aud: 'https://management.azure.com/',
  iss: 'https://login.microsoftonline.com/tenant/v2.0',
  exp: Math.floor(Date.now() / 1000) + 3600,
  preferred_username: 'alice@example.com',
  oid: 'user-oid-123',
});

const EXPIRED_JWT = makeJwt({
  aud: 'https://management.azure.com/',
  exp: Math.floor(Date.now() / 1000) - 60,
  preferred_username: 'alice@example.com',
});

const WRONG_AUDIENCE_JWT = makeJwt({
  aud: 'api://some-other-app',
  exp: Math.floor(Date.now() / 1000) + 3600,
});

const AWS_CREDS_OK = {
  accessKeyId: 'ASIATEST' + '0'.repeat(8),
  secretAccessKey: 'secret',
  sessionToken: 'session-token-value',
  expiration: new Date(Date.now() + 3600_000),
};

// ---------------------------------------------------------------------------
// Suite
// ---------------------------------------------------------------------------

describe('CredentialBroker', () => {
  let broker: CredentialBroker;

  beforeEach(() => {
    assumeRoleMock.mockReset();
    clearCacheMock.mockReset();
    // Default: AWS exchange succeeds.
    assumeRoleMock.mockResolvedValue(AWS_CREDS_OK);

    broker = new CredentialBroker({
      awsRoleArn: 'arn:aws:iam::123456789012:role/OpenAgenticOBORole',
      awsRegion: 'us-east-1',
      gcpServiceAccountJson: JSON.stringify({
        type: 'service_account',
        client_email: 'test-sa@test.iam.gserviceaccount.com',
        private_key: '-----BEGIN PRIVATE KEY-----\\nfake\\n-----END PRIVATE KEY-----',
      }),
      cacheTtlSeconds: 60,
      now: () => Date.now(),
    });
  });

  afterEach(() => {
    broker.__clearCache();
  });

  describe('JWT validation', () => {
    it('throws InvalidJwtError on empty token', async () => {
      await expect(broker.brokerFor('', ['azure'])).rejects.toBeInstanceOf(InvalidJwtError);
    });

    it('throws InvalidJwtError on malformed token', async () => {
      await expect(broker.brokerFor('not-a-jwt', ['azure'])).rejects.toBeInstanceOf(InvalidJwtError);
    });

    it('throws InvalidJwtError on expired token', async () => {
      await expect(broker.brokerFor(EXPIRED_JWT, ['azure'])).rejects.toMatchObject({
        name: 'InvalidJwtError',
        message: expect.stringContaining('expired'),
      });
    });

    it('throws InvalidJwtError when Azure requested but audience is not ARM', async () => {
      await expect(broker.brokerFor(WRONG_AUDIENCE_JWT, ['azure'])).rejects.toMatchObject({
        name: 'InvalidJwtError',
        message: expect.stringContaining('audience'),
      });
    });

    it('accepts AWS-only request even with non-ARM audience (AWS OIDC trust validates separately)', async () => {
      const result = await broker.brokerFor(WRONG_AUDIENCE_JWT, ['aws']);
      expect(result.aws).toBeDefined();
    });
  });

  describe('cloud: aws', () => {
    it('returns STS session creds as env-var dict', async () => {
      const result = await broker.brokerFor(VALID_USER_JWT, ['aws']);
      expect(result.aws).toEqual({
        AWS_ACCESS_KEY_ID: AWS_CREDS_OK.accessKeyId,
        AWS_SECRET_ACCESS_KEY: AWS_CREDS_OK.secretAccessKey,
        AWS_SESSION_TOKEN: AWS_CREDS_OK.sessionToken,
        AWS_DEFAULT_REGION: 'us-east-1',
      });
      expect(assumeRoleMock).toHaveBeenCalledOnce();
    });

    it('passes the user email to the STS session name', async () => {
      await broker.brokerFor(VALID_USER_JWT, ['aws']);
      expect(assumeRoleMock).toHaveBeenCalledWith(
        VALID_USER_JWT,
        expect.objectContaining({ userEmail: 'alice@example.com' }),
      );
    });

    it('propagates STS failures with cloud context', async () => {
      assumeRoleMock.mockRejectedValue(new Error('AccessDenied: trust policy mismatch'));
      await expect(broker.brokerFor(VALID_USER_JWT, ['aws'])).rejects.toMatchObject({
        message: expect.stringContaining('aws'),
      });
    });
  });

  describe('cloud: azure', () => {
    it('returns the JWT as AZURE_ACCESS_TOKEN (pass-through)', async () => {
      const result = await broker.brokerFor(VALID_USER_JWT, ['azure']);
      expect(result.azure).toEqual({ AZURE_ACCESS_TOKEN: VALID_USER_JWT });
    });

    it('does NOT call STS when only azure is requested', async () => {
      await broker.brokerFor(VALID_USER_JWT, ['azure']);
      expect(assumeRoleMock).not.toHaveBeenCalled();
    });
  });

  describe('cloud: gcp', () => {
    it('returns GOOGLE_SA_JSON from configured service-account JSON', async () => {
      const result = await broker.brokerFor(VALID_USER_JWT, ['gcp']);
      expect(result.gcp).toBeDefined();
      expect(result.gcp!.GOOGLE_SA_JSON).toContain('service_account');
    });

    it('throws if GCP requested but no SA JSON configured', async () => {
      const emptyBroker = new CredentialBroker({
        awsRoleArn: 'arn',
        gcpServiceAccountJson: undefined,
      });
      await expect(emptyBroker.brokerFor(VALID_USER_JWT, ['gcp'])).rejects.toMatchObject({
        message: expect.stringContaining('GCP service account JSON not configured'),
      });
    });
  });

  describe('multi-cloud composition', () => {
    it('returns all three cloud dicts when all requested', async () => {
      const result = await broker.brokerFor(VALID_USER_JWT, ['aws', 'azure', 'gcp']);
      expect(result.aws).toBeDefined();
      expect(result.azure).toBeDefined();
      expect(result.gcp).toBeDefined();
    });

    it('produces a flat env-var dict via toEnv()', async () => {
      const result = await broker.brokerFor(VALID_USER_JWT, ['aws', 'azure']);
      const env = broker.toEnv(result);
      expect(Object.keys(env).sort()).toEqual([
        'AWS_ACCESS_KEY_ID',
        'AWS_DEFAULT_REGION',
        'AWS_SECRET_ACCESS_KEY',
        'AWS_SESSION_TOKEN',
        'AZURE_ACCESS_TOKEN',
      ]);
    });

    it('rejects unknown cloud names', async () => {
      await expect(
        broker.brokerFor(VALID_USER_JWT, ['aws', 'heroku' as CloudTarget]),
      ).rejects.toBeInstanceOf(UnknownCloudError);
    });
  });

  describe('caching', () => {
    it('serves a second identical request from cache (no second STS call)', async () => {
      await broker.brokerFor(VALID_USER_JWT, ['aws']);
      await broker.brokerFor(VALID_USER_JWT, ['aws']);
      expect(assumeRoleMock).toHaveBeenCalledOnce();
    });

    it('refreshes after TTL expiry', async () => {
      let nowMs = 1_700_000_000_000;
      const freshBroker = new CredentialBroker({
        awsRoleArn: 'arn:aws:iam::1:role/R',
        awsRegion: 'us-east-1',
        cacheTtlSeconds: 60,
        now: () => nowMs,
      });
      await freshBroker.brokerFor(VALID_USER_JWT, ['aws']);
      nowMs += 61_000; // past TTL
      await freshBroker.brokerFor(VALID_USER_JWT, ['aws']);
      expect(assumeRoleMock).toHaveBeenCalledTimes(2);
    });

    it('different users do not share cache', async () => {
      const otherUserJwt = makeJwt({
        aud: 'https://management.azure.com/',
        exp: Math.floor(Date.now() / 1000) + 3600,
        preferred_username: 'bob@example.com',
      });
      await broker.brokerFor(VALID_USER_JWT, ['aws']);
      await broker.brokerFor(otherUserJwt, ['aws']);
      expect(assumeRoleMock).toHaveBeenCalledTimes(2);
    });
  });

  describe('redaction (never log raw secrets)', () => {
    it('redactForAudit strips values, keeps key names + hash prefix', async () => {
      const result = await broker.brokerFor(VALID_USER_JWT, ['aws']);
      const audit = broker.redactForAudit(broker.toEnv(result));
      // Keys preserved
      expect(Object.keys(audit)).toContain('AWS_ACCESS_KEY_ID');
      // Values never appear raw
      for (const v of Object.values(audit)) {
        expect(v).not.toBe(AWS_CREDS_OK.accessKeyId);
        expect(v).not.toBe(AWS_CREDS_OK.secretAccessKey);
        expect(v).not.toBe(AWS_CREDS_OK.sessionToken);
      }
      // Hash prefix present (8 hex chars + ellipsis)
      expect(audit.AWS_ACCESS_KEY_ID).toMatch(/^sha256:[0-9a-f]{8}\.\.\.$/);
    });
  });
});

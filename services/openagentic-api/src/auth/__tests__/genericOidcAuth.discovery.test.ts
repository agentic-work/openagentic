/**
 * GenericOidcStrategy — discovery-doc-driven behavior.
 *
 * Verifies the generic OIDC strategy against a fixture .well-known discovery
 * document (Keycloak-shaped, generalizable to Okta/Auth0/Entra-as-generic):
 *
 *   - constructed OFFLINE from a cached discovery doc (no network discovery())
 *   - validateDiscovery() rejects docs missing required endpoints, accepts complete ones
 *   - generateAuthUrl() emits state + scope + S256 PKCE and stashes the verifier
 *   - exchangeCodeForTokens() recovers the verifier, exchanges, returns validated claims
 *   - buildUserContext() reads groups from the directory-configured group_claim
 *
 * openid-client + node-jose + Redis are mocked — this is a unit test, no network.
 */

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';

// ---- Discovery-doc fixture (Keycloak realm shape) ----
const DISCOVERY_FIXTURE = {
  issuer: 'https://idp.example.com/realms/corp',
  authorization_endpoint: 'https://idp.example.com/realms/corp/protocol/openid-connect/auth',
  token_endpoint: 'https://idp.example.com/realms/corp/protocol/openid-connect/token',
  jwks_uri: 'https://idp.example.com/realms/corp/protocol/openid-connect/certs',
  userinfo_endpoint: 'https://idp.example.com/realms/corp/protocol/openid-connect/userinfo',
  response_types_supported: ['code'],
  subject_types_supported: ['public'],
  id_token_signing_alg_values_supported: ['RS256'],
};

// ---- Redis mock (no real connection) ----
const redisStore = new Map<string, string>();
vi.mock('../../services/redis.js', () => ({
  createRedisService: () => ({
    get: vi.fn(async (k: string) => (redisStore.has(k) ? redisStore.get(k)! : null)),
    set: vi.fn(async (k: string, v: string) => {
      redisStore.set(k, v);
    }),
    del: vi.fn(async (k: string) => {
      redisStore.delete(k);
    }),
    expire: vi.fn(async () => {}),
    exists: vi.fn(async (k: string) => redisStore.has(k)),
    keys: vi.fn(async () => []),
  }),
}));

// ---- openid-client mock — functional v6 surface ----
const discoveryMock = vi.fn();
const buildAuthorizationUrlMock = vi.fn();
const authorizationCodeGrantMock = vi.fn();
const ConfigurationCtor = vi.fn();

vi.mock('openid-client', () => {
  class Configuration {
    private _md: any;
    constructor(server: any, _clientId: string, _metadata: any, _auth: any) {
      ConfigurationCtor(server, _clientId, _metadata, _auth);
      this._md = server;
    }
    serverMetadata() {
      return this._md;
    }
  }
  return {
    Configuration,
    discovery: discoveryMock,
    buildAuthorizationUrl: buildAuthorizationUrlMock,
    authorizationCodeGrant: authorizationCodeGrantMock,
    ClientSecretPost: (s: string) => ({ __auth: 'client_secret_post', s }),
    randomPKCECodeVerifier: () => 'test-code-verifier-xyz',
    calculatePKCECodeChallenge: async (_v: string) => 'test-code-challenge-abc',
    randomState: () => 'random-state-value',
  };
});

const SILENT_LOGGER = { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() } as any;

const BASE_CONFIG = {
  clientId: 'corp-app',
  clientSecret: 'corp-secret',
  issuer: 'https://idp.example.com/realms/corp',
  redirectUri: 'https://app.example.com/api/auth/sso/dir-1/callback',
  scopes: ['openid', 'profile', 'email', 'groups'],
  groupClaim: 'groups',
};

describe('GenericOidcStrategy — discovery-doc-driven', () => {
  beforeEach(() => {
    redisStore.clear();
    discoveryMock.mockReset();
    buildAuthorizationUrlMock.mockReset();
    authorizationCodeGrantMock.mockReset();
    ConfigurationCtor.mockReset();
  });

  afterEach(() => {
    vi.clearAllMocks();
  });

  it('constructs OFFLINE from a cached discovery doc — no network discovery()', async () => {
    const { GenericOidcStrategy } = await import('../genericOidcAuth.js');
    buildAuthorizationUrlMock.mockReturnValue(new URL('https://idp.example.com/realms/corp/protocol/openid-connect/auth?x=1'));

    const strat = new GenericOidcStrategy({ ...BASE_CONFIG, discovery: DISCOVERY_FIXTURE }, SILENT_LOGGER);

    // Forcing config construction via generateAuthUrl
    await strat.generateAuthUrl('s1');

    // Built from the cached doc; network discovery() never called.
    expect(ConfigurationCtor).toHaveBeenCalledTimes(1);
    expect(discoveryMock).not.toHaveBeenCalled();
    // The cached doc is surfaced for the caller to persist.
    expect(strat.getDiscoveryDocument()).toEqual(DISCOVERY_FIXTURE);
  });

  it('fetches + caches the discovery doc when none is cached', async () => {
    const { GenericOidcStrategy } = await import('../genericOidcAuth.js');
    discoveryMock.mockResolvedValue({ serverMetadata: () => DISCOVERY_FIXTURE });
    buildAuthorizationUrlMock.mockReturnValue(new URL('https://idp.example.com/x?y=1'));

    const strat = new GenericOidcStrategy({ ...BASE_CONFIG }, SILENT_LOGGER); // no discovery
    await strat.generateAuthUrl('s2');

    expect(discoveryMock).toHaveBeenCalledTimes(1);
    // The fetched metadata is cached for later offline use.
    expect(strat.getDiscoveryDocument()).toMatchObject({ issuer: DISCOVERY_FIXTURE.issuer });
  });

  it('generateAuthUrl emits state + scope + S256 PKCE and stores the verifier', async () => {
    const { GenericOidcStrategy } = await import('../genericOidcAuth.js');
    buildAuthorizationUrlMock.mockReturnValue(new URL('https://idp.example.com/auth?ok=1'));

    const strat = new GenericOidcStrategy({ ...BASE_CONFIG, discovery: DISCOVERY_FIXTURE }, SILENT_LOGGER);
    const url = await strat.generateAuthUrl('state-123');

    expect(typeof url).toBe('string');
    const [, params] = buildAuthorizationUrlMock.mock.calls[0];
    expect(params).toMatchObject({
      redirect_uri: BASE_CONFIG.redirectUri,
      scope: 'openid profile email groups',
      state: 'state-123',
      code_challenge: 'test-code-challenge-abc',
      code_challenge_method: 'S256',
    });
    // Verifier stashed under the state key.
    expect(redisStore.has('generic_oidc_pkce:state-123')).toBe(true);
  });

  it('exchangeCodeForTokens recovers the verifier + returns validated claims', async () => {
    const { GenericOidcStrategy } = await import('../genericOidcAuth.js');
    buildAuthorizationUrlMock.mockReturnValue(new URL('https://idp.example.com/auth?ok=1'));
    authorizationCodeGrantMock.mockResolvedValue({
      access_token: 'AT',
      refresh_token: 'RT',
      id_token: 'IDT',
      expiresIn: () => 3599,
      claims: () => ({
        sub: 'user-1',
        email: 'alice@example.com',
        name: 'Alice',
        email_verified: true,
        groups: ['platform-admins', 'engineering'],
      }),
    });

    const strat = new GenericOidcStrategy({ ...BASE_CONFIG, discovery: DISCOVERY_FIXTURE }, SILENT_LOGGER);
    await strat.generateAuthUrl('state-xyz'); // stashes the verifier

    const result = await strat.exchangeCodeForTokens(
      'https://app.example.com/api/auth/sso/dir-1/callback?code=abc&state=state-xyz',
      'state-xyz',
    );

    expect(result.accessToken).toBe('AT');
    expect(result.refreshToken).toBe('RT');
    expect(result.idToken).toBe('IDT');
    expect(result.expiresIn).toBe(3599);
    expect(result.claims.email).toBe('alice@example.com');

    // The grant received the recovered PKCE verifier + expected state.
    const [, , checks] = authorizationCodeGrantMock.mock.calls[0];
    expect(checks).toMatchObject({ pkceCodeVerifier: 'test-code-verifier-xyz', expectedState: 'state-xyz' });
    // Verifier consumed (single use).
    expect(redisStore.has('generic_oidc_pkce:state-xyz')).toBe(false);
  });

  it('exchangeCodeForTokens throws when the PKCE verifier is missing/expired', async () => {
    const { GenericOidcStrategy } = await import('../genericOidcAuth.js');
    const strat = new GenericOidcStrategy({ ...BASE_CONFIG, discovery: DISCOVERY_FIXTURE }, SILENT_LOGGER);

    await expect(
      strat.exchangeCodeForTokens('https://app.example.com/cb?code=abc&state=never-issued', 'never-issued'),
    ).rejects.toThrow(/PKCE verifier not found/);
  });

  it('validateDiscovery accepts a complete document', async () => {
    const { GenericOidcStrategy } = await import('../genericOidcAuth.js');
    discoveryMock.mockResolvedValue({ serverMetadata: () => DISCOVERY_FIXTURE });

    const strat = new GenericOidcStrategy({ ...BASE_CONFIG }, SILENT_LOGGER);
    const res = await strat.validateDiscovery();

    expect(res.valid).toBe(true);
    expect(res.discovery).toMatchObject({ issuer: DISCOVERY_FIXTURE.issuer });
  });

  it('validateDiscovery rejects a document missing required endpoints', async () => {
    const { GenericOidcStrategy } = await import('../genericOidcAuth.js');
    const incomplete = { issuer: DISCOVERY_FIXTURE.issuer, authorization_endpoint: DISCOVERY_FIXTURE.authorization_endpoint };
    discoveryMock.mockResolvedValue({ serverMetadata: () => incomplete });

    const strat = new GenericOidcStrategy({ ...BASE_CONFIG }, SILENT_LOGGER);
    const res = await strat.validateDiscovery();

    expect(res.valid).toBe(false);
    expect(res.error).toMatch(/token_endpoint/);
    expect(res.error).toMatch(/jwks_uri/);
  });

  it('validateDiscovery surfaces a fetch/parse error as invalid', async () => {
    const { GenericOidcStrategy } = await import('../genericOidcAuth.js');
    discoveryMock.mockRejectedValue(new Error('ENOTFOUND idp.example.com'));

    const strat = new GenericOidcStrategy({ ...BASE_CONFIG }, SILENT_LOGGER);
    const res = await strat.validateDiscovery();

    expect(res.valid).toBe(false);
    expect(res.error).toMatch(/ENOTFOUND/);
  });

  it('buildUserContext extracts groups from the configured group_claim', async () => {
    const { GenericOidcStrategy } = await import('../genericOidcAuth.js');

    // A directory that maps groups onto a non-default claim ("roles").
    const strat = new GenericOidcStrategy(
      { ...BASE_CONFIG, groupClaim: 'roles', discovery: DISCOVERY_FIXTURE },
      SILENT_LOGGER,
    );

    const ctx = strat.buildUserContext({
      sub: 'u-9',
      email: 'bob@example.com',
      name: 'Bob',
      roles: ['admins', 'sre'],
      groups: ['should-be-ignored'],
    });

    expect(ctx.userId).toBe('u-9');
    expect(ctx.email).toBe('bob@example.com');
    expect(ctx.groups).toEqual(['admins', 'sre']);
  });

  it('throws on construction when a required field is missing', async () => {
    const { GenericOidcStrategy } = await import('../genericOidcAuth.js');
    expect(() => new GenericOidcStrategy({ ...BASE_CONFIG, issuer: '' } as any, SILENT_LOGGER)).toThrow(/issuer is required/);
    expect(() => new GenericOidcStrategy({ ...BASE_CONFIG, clientId: '' } as any, SILENT_LOGGER)).toThrow(/clientId is required/);
  });
});

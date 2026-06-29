/**
 * Regression: GoogleVertexProvider.generateImage() constructed
 *   new GoogleAuth({ scopes: [...] })
 * with no credentials — so google-auth-library fell through to
 * Application Default Credentials, which aren't available on k3s-local
 * (no GOOGLE_APPLICATION_CREDENTIALS file, no GCE metadata server).
 * Image gen threw:
 *   Could not load the default credentials. Browse to
 *   https://cloud.google.com/docs/authentication/getting-started
 *
 * The working paths (embeddings + models REST fallback) already parse
 * `process.env.GOOGLE_APPLICATION_CREDENTIALS_JSON` and attach it as
 * `credentials` to GoogleAuthOptions. Extracted that logic into
 * buildVertexAuthOptions() so every GoogleAuth construction in the
 * provider uses the same shape. Unit-tested here.
 *
 * initialize() at GoogleVertexProvider.ts:106 sets this env var from
 * config.serviceAccountJson (which ProviderConfigService pulls from the
 * DB llm_providers.auth_config.credentials blob). So as long as the
 * provider initialized and this helper is called at generateImage time,
 * credentials reach the google-auth-library.
 */
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { buildVertexAuthOptions, VERTEX_SCOPE } from '../GoogleVertexAuth.js';

const REAL_SA = JSON.stringify({
  type: 'service_account',
  project_id: 'test-project',
  private_key_id: 'abc',
  private_key: '-----BEGIN PRIVATE KEY-----\nAAAA\n-----END PRIVATE KEY-----\n',
  client_email: 'test@test-project.iam.gserviceaccount.com',
  client_id: '123',
});

describe('buildVertexAuthOptions', () => {
  const orig = process.env.GOOGLE_APPLICATION_CREDENTIALS_JSON;

  beforeEach(() => {
    delete process.env.GOOGLE_APPLICATION_CREDENTIALS_JSON;
  });
  afterEach(() => {
    if (orig !== undefined) process.env.GOOGLE_APPLICATION_CREDENTIALS_JSON = orig;
    else delete process.env.GOOGLE_APPLICATION_CREDENTIALS_JSON;
  });

  it('always sets the cloud-platform scope', () => {
    const opts = buildVertexAuthOptions();
    expect(opts.scopes).toEqual([VERTEX_SCOPE]);
  });

  it('parses GOOGLE_APPLICATION_CREDENTIALS_JSON → credentials', () => {
    process.env.GOOGLE_APPLICATION_CREDENTIALS_JSON = REAL_SA;
    const opts = buildVertexAuthOptions();
    expect(opts.credentials).toBeDefined();
    expect(opts.credentials?.client_email).toBe('test@test-project.iam.gserviceaccount.com');
    expect(opts.credentials?.private_key).toContain('BEGIN PRIVATE KEY');
  });

  it('omits credentials when env var is unset (ADC fallback for GCE / workload-identity)', () => {
    const opts = buildVertexAuthOptions();
    expect(opts.credentials).toBeUndefined();
    expect(opts.scopes).toEqual([VERTEX_SCOPE]); // scope still set
  });

  it('omits credentials when env var is not valid JSON (graceful fallback, not throw)', () => {
    process.env.GOOGLE_APPLICATION_CREDENTIALS_JSON = 'not-json{{{';
    const opts = buildVertexAuthOptions();
    expect(opts.credentials).toBeUndefined();
  });

  it('omits credentials when env var is empty string', () => {
    process.env.GOOGLE_APPLICATION_CREDENTIALS_JSON = '';
    const opts = buildVertexAuthOptions();
    expect(opts.credentials).toBeUndefined();
  });

  it('does NOT propagate the raw process env — returns a fresh object each call', () => {
    const a = buildVertexAuthOptions();
    const b = buildVertexAuthOptions();
    expect(a).not.toBe(b);
  });
});

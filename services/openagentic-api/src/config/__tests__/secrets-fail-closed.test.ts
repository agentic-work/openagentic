/**
 * B2 (FedRAMP P3) — secrets.config.ts must FAIL CLOSED in production.
 *
 * The pre-remediation validator "never crashes": on a missing or placeholder
 * secret it generated an ephemeral random value and continued. Under
 * NODE_ENV=production that is fail-OPEN — the documented `docker compose up`
 * default `openagentic-dev-jwt-secret-change-me` slipped through (the
 * blocklist matched 'change-me' only as an EXACT value, not as a substring),
 * so the API booted signing admin JWTs with a world-readable secret.
 *
 * Required posture (NIST IA-5, CM-6, SI-10):
 *   - production + missing required secret      → throw (abort boot)
 *   - production + weak/placeholder secret      → throw (abort boot)
 *       incl. substring 'change-me' and 'dev-'
 *   - development                               → may auto-generate (unchanged)
 */
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { loadSecrets } from '../secrets.config.js';

const REQUIRED = {
  DATABASE_URL: 'postgresql://u:p@db:5432/app',
  DB_PASSWORD: 'a-real-strong-db-password-9f3a',
  REDIS_URL: 'redis://redis:6379',
  JWT_SECRET: 'd7f3a1c9e5b2486f0a1d2c3b4e5f6a7b8c9d0e1f2a3b4c5d6e7f8a9b0c1d2e3f',
  AZURE_CLIENT_ID: '00000000-0000-0000-0000-000000000000',
  AZURE_TENANT_ID: '11111111-1111-1111-1111-111111111111',
  API_KEY: '5e4d3c2b1a0f9e8d7c6b5a4938271605f4e3d2c1b0a99887',
  MILVUS_PASSWORD: 'milvus-strong-pw-7c2e',
  MINIO_ACCESS_KEY: 'minio-access-3a9f',
  MINIO_SECRET_KEY: 'minio-secret-strong-1b8d',
};

describe('secrets.config — fail-closed in production (B2)', () => {
  const saved = { ...process.env };

  beforeEach(() => {
    for (const k of Object.keys(REQUIRED)) delete process.env[k];
    delete process.env.NODE_ENV;
  });
  afterEach(() => {
    process.env = { ...saved };
  });

  function setAll() {
    for (const [k, v] of Object.entries(REQUIRED)) process.env[k] = v;
  }

  it('throws in production when a required secret is missing', () => {
    process.env.NODE_ENV = 'production';
    setAll();
    delete process.env.JWT_SECRET; // missing required secret
    expect(() => loadSecrets()).toThrow(/JWT_SECRET/);
  });

  it('throws in production on the shipped *-change-me placeholder (substring match)', () => {
    process.env.NODE_ENV = 'production';
    setAll();
    process.env.JWT_SECRET = 'openagentic-dev-jwt-secret-change-me';
    expect(() => loadSecrets()).toThrow(/JWT_SECRET|placeholder|weak/i);
  });

  it("throws in production on a 'dev-' prefixed weak secret", () => {
    process.env.NODE_ENV = 'production';
    setAll();
    process.env.SIGNING_SECRET = 'dev-frontend-secret-change-in-prod';
    process.env.JWT_SECRET = 'dev-jwt-secret';
    expect(() => loadSecrets()).toThrow();
  });

  it('loads cleanly in production when all secrets are strong + real', () => {
    process.env.NODE_ENV = 'production';
    setAll();
    const secrets = loadSecrets();
    expect(secrets.auth.jwtSecret).toBe(REQUIRED.JWT_SECRET);
  });

  it('still auto-generates (does NOT throw) in development', () => {
    process.env.NODE_ENV = 'development';
    // intentionally leave secrets unset — dev convenience path
    expect(() => loadSecrets()).not.toThrow();
  });
});

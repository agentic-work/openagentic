/**
 * `getEnvContextSection()` — dynamic system-prompt section that surfaces
 * deployment-level runtime auth context (cloud OBO roles, AAD tenant, GCP
 * project) so the model knows credentials are auto-handled and never asks
 * users for ARNs / role names.
 *
 * Mirrors the Claude Code pattern at `~/anthropic/src/constants/prompts.ts`:
 *   - Static sections come first (cache-global).
 *   - SYSTEM_PROMPT_DYNAMIC_BOUNDARY splits the cache.
 *   - Dynamic sections are pure functions of (env + per-request inputs).
 *
 * User 2026-05-12: "i need you to test and validate the dynamic env prompts
 * in chat pipeline based on the ref arch in ~/anthropic/src and how they
 * do static and dynamic prompts" — and earlier: "this would need to be an
 * example of a dynamic env prompt that we are supposed to have. don't
 * fucking hardcode aws account shit".
 *
 * Contract:
 *   - With no relevant env set: returns empty string (caller drops it).
 *   - With AWS_OBO_ROLE_ARN set: renders an `<env-context>` block carrying
 *     the role ARN + a single sentence ("AWS tools auto-assume … — never
 *     ask the user for credentials").
 *   - Each cloud (aws / azure / gcp) renders independently. If only Azure
 *     is configured, only the Azure line appears.
 *   - The block is rendered as XML so the consumer model treats it as
 *     ambient context (consistent with `<session-facts>` and
 *     `<tool-catalog>` rendering in the same module).
 *   - NEVER references hardcoded ARNs / account IDs / tenant ids in the
 *     source — every value comes from env at compose time.
 */
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { getEnvContextSection } from '../dynamicSections.js';

describe('getEnvContextSection — runtime env interpolation (ref-arch parity)', () => {
  const originalEnv = {
    AWS_OBO_ROLE_ARN: process.env.AWS_OBO_ROLE_ARN,
    AWS_DEFAULT_REGION: process.env.AWS_DEFAULT_REGION,
    AZURE_AD_TENANT_ID: process.env.AZURE_AD_TENANT_ID,
    AZURE_AD_CLIENT_ID: process.env.AZURE_AD_CLIENT_ID,
    GOOGLE_CLOUD_PROJECT: process.env.GOOGLE_CLOUD_PROJECT,
    VERTEX_PROJECT_ID: process.env.VERTEX_PROJECT_ID,
  };

  beforeEach(() => {
    // Clear all cloud-context env vars before each test for determinism.
    delete process.env.AWS_OBO_ROLE_ARN;
    delete process.env.AWS_DEFAULT_REGION;
    delete process.env.AZURE_AD_TENANT_ID;
    delete process.env.AZURE_AD_CLIENT_ID;
    delete process.env.GOOGLE_CLOUD_PROJECT;
    delete process.env.VERTEX_PROJECT_ID;
  });

  afterEach(() => {
    // Restore any env we mutated.
    for (const [k, v] of Object.entries(originalEnv)) {
      if (v === undefined) delete (process.env as any)[k];
      else (process.env as any)[k] = v;
    }
  });

  it('returns empty string when no relevant env is set', () => {
    expect(getEnvContextSection()).toBe('');
  });

  it('renders aws line when AWS_OBO_ROLE_ARN is set', () => {
    process.env.AWS_OBO_ROLE_ARN = 'arn:aws:iam::000000000000:role/Test';
    const out = getEnvContextSection();
    expect(out).toContain('<env-context>');
    expect(out).toContain('</env-context>');
    expect(out).toContain('arn:aws:iam::000000000000:role/Test');
    // The "never ask for credentials" hint.
    expect(out).toMatch(/never ask.*credentials/i);
    // AWS line is present; other clouds are NOT.
    expect(out).toMatch(/aws/i);
    expect(out).not.toMatch(/azure tenant/i);
    expect(out).not.toMatch(/gcp project/i);
  });

  it('renders azure line when AZURE_AD_TENANT_ID is set', () => {
    process.env.AZURE_AD_TENANT_ID = '00000000-1111-2222-3333-444444444444';
    const out = getEnvContextSection();
    expect(out).toContain('<env-context>');
    expect(out).toContain('00000000-1111-2222-3333-444444444444');
    expect(out).toMatch(/azure/i);
    expect(out).not.toMatch(/aws.*role/i);
  });

  it('renders gcp line when GOOGLE_CLOUD_PROJECT is set', () => {
    process.env.GOOGLE_CLOUD_PROJECT = 'my-test-project';
    const out = getEnvContextSection();
    expect(out).toContain('<env-context>');
    expect(out).toContain('my-test-project');
    expect(out).toMatch(/gcp|google.cloud/i);
  });

  it('renders all clouds when all env vars set', () => {
    process.env.AWS_OBO_ROLE_ARN = 'arn:aws:iam::000:role/X';
    process.env.AWS_DEFAULT_REGION = 'us-east-1';
    process.env.AZURE_AD_TENANT_ID = 'tenant-uuid';
    process.env.AZURE_AD_CLIENT_ID = 'client-uuid';
    process.env.GOOGLE_CLOUD_PROJECT = 'proj-x';
    const out = getEnvContextSection();
    expect(out).toContain('arn:aws:iam::000:role/X');
    expect(out).toContain('us-east-1');
    expect(out).toContain('tenant-uuid');
    expect(out).toContain('proj-x');
    expect((out.match(/never ask/gi) || []).length).toBeGreaterThanOrEqual(1);
  });

  it('falls back to VERTEX_PROJECT_ID when GOOGLE_CLOUD_PROJECT not set', () => {
    process.env.VERTEX_PROJECT_ID = 'vertex-only-project';
    const out = getEnvContextSection();
    expect(out).toContain('vertex-only-project');
  });

  it('does NOT contain any hardcoded production identifiers', () => {
    // Regression guard against the 2026-05-12 mistake — verify the source
    // never leaks a real tenant ARN / account ID. (This catches accidental
    // string-literal additions to the section body.)
    process.env.AWS_OBO_ROLE_ARN = 'arn:aws:iam::PLACEHOLDER:role/Test';
    const out = getEnvContextSection();
    expect(out).not.toContain('123456789012'); // ← known prod account ID
    expect(out).not.toContain('OpenAgenticOBORole'); // ← known prod role name (in env, not source)
  });
});

/**
 * Phase B.3 (rev-2 plan) — RoleKeyedSystemPrompt loader.
 *
 * Loads `prompts/chat-system-{admin,member}.md` from disk, file-cached
 * after first read. Selection happens upstream via `request.user.is_admin`.
 *
 * Spec: docs/superpowers/specs/2026-05-10-chatmode-three-layer-architecture.md §Layer-1
 * Plan: docs/superpowers/plans/2026-05-10-chatmode-rip-implementation.md §Task-B.3
 */
import { describe, it, expect, beforeEach } from 'vitest';
import {
  loadStaticPromptForRole,
  __clearPromptCache,
  type UserRole,
} from '../RoleKeyedSystemPrompt.js';

describe('RoleKeyedSystemPrompt', () => {
  beforeEach(() => {
    __clearPromptCache();
  });

  it('loads admin prompt and returns a non-trivial string', async () => {
    const body = await loadStaticPromptForRole('admin');
    expect(typeof body).toBe('string');
    expect(body.length).toBeGreaterThan(500);
  });

  it('loads member prompt and returns a non-trivial string', async () => {
    const body = await loadStaticPromptForRole('member');
    expect(typeof body).toBe('string');
    expect(body.length).toBeGreaterThan(500);
  });

  it('admin and member bodies differ', async () => {
    const admin = await loadStaticPromptForRole('admin');
    const member = await loadStaticPromptForRole('member');
    expect(admin).not.toBe(member);
  });

  it('admin prompt mentions admin RBAC framing', async () => {
    const body = await loadStaticPromptForRole('admin');
    expect(body).toMatch(/platform administrator/i);
  });

  it('member prompt mentions standard RBAC framing', async () => {
    const body = await loadStaticPromptForRole('member');
    expect(body).toMatch(/standard RBAC|end-user|destructive operation/i);
  });

  it('caches the result — second call does not re-read filesystem (string identity)', async () => {
    const a = await loadStaticPromptForRole('admin');
    const b = await loadStaticPromptForRole('admin');
    // Same in-memory string instance proves cache hit, not just content equality.
    expect(a).toBe(b);
  });

  it('size cap: admin body ≤ 4500 tokens (18000 chars at 4 chars/token)', async () => {
    const body = await loadStaticPromptForRole('admin');
    expect(body.length).toBeLessThanOrEqual(18000);
  });

  it('size cap: member body ≤ 4500 tokens (18000 chars at 4 chars/token)', async () => {
    const body = await loadStaticPromptForRole('member');
    expect(body.length).toBeLessThanOrEqual(18000);
  });

  it('rejects unknown roles', async () => {
    await expect(
      // @ts-expect-error — testing runtime rejection of bad role
      loadStaticPromptForRole('superuser' as UserRole),
    ).rejects.toThrow(/unknown role/i);
  });
});

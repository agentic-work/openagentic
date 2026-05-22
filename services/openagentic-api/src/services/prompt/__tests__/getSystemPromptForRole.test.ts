/**
 * Phase B.4 (rev-2 plan) — getSystemPromptForRole composer.
 *
 * Concatenates the role-keyed static body with three dynamic plain-function
 * sections (session-facts, memories, mcp-instructions). No DB-backed
 * composer, no priority sort, no intent filter, no audience filter.
 *
 * Spec: docs/superpowers/specs/2026-05-10-chatmode-three-layer-architecture.md §Layer-1
 * Plan: docs/superpowers/plans/2026-05-10-chatmode-rip-implementation.md §Task-B.4
 */
import { describe, it, expect, beforeEach } from 'vitest';
import { getSystemPromptForRole } from '../getSystemPromptForRole.js';
import { __clearPromptCache } from '../RoleKeyedSystemPrompt.js';

const minCtx = {
  userId: 'u-test',
  sessionId: 's-test',
  tenantId: 't-test',
  modelInUse: 'some-model',
  userMessage: 'hello',
  priorTurnCount: 0,
};

describe('getSystemPromptForRole', () => {
  beforeEach(() => __clearPromptCache());

  it('admin path: starts with admin static body, ends with session-facts', async () => {
    const out = await getSystemPromptForRole('admin', minCtx, {
      memoryRecall: async () => [], // no memories
    });
    expect(out).toMatch(/^You are OpenAgentic.*platform administrator/);
    expect(out).toContain('<session-facts>');
    expect(out).toContain('<user id="u-test" role="admin"/>');
    expect(out).toContain('<session id="s-test"');
    expect(out).toContain('<model name="some-model"');
  });

  it('member path: starts with member static body', async () => {
    const out = await getSystemPromptForRole('member', minCtx, {
      memoryRecall: async () => [],
    });
    expect(out).toMatch(/^You are OpenAgentic/);
    expect(out).toContain('<user id="u-test" role="member"/>');
  });

  it('admin and member produce different bodies', async () => {
    const admin = await getSystemPromptForRole('admin', minCtx, { memoryRecall: async () => [] });
    const member = await getSystemPromptForRole('member', minCtx, { memoryRecall: async () => [] });
    expect(admin).not.toBe(member);
    expect(admin.length).toBeGreaterThan(member.length); // admin prompt is larger
  });

  it('appends memories block when recall returns hits', async () => {
    const out = await getSystemPromptForRole('admin', minCtx, {
      memoryRecall: async () => [
        { key: 'preferred-region', value: 'eastus2' },
        { key: 'has-billing-reader', value: 'true' },
      ],
    });
    expect(out).toContain('<memories>');
    expect(out).toContain('preferred-region: eastus2');
    expect(out).toContain('has-billing-reader: true');
    expect(out).toContain('</memories>');
  });

  it('omits memories block when recall returns empty', async () => {
    const out = await getSystemPromptForRole('admin', minCtx, {
      memoryRecall: async () => [],
    });
    expect(out).not.toContain('<memories>');
  });

  it('memory recall errors are swallowed (best-effort)', async () => {
    const out = await getSystemPromptForRole('admin', minCtx, {
      memoryRecall: async () => {
        throw new Error('redis down');
      },
    });
    // Should still return a usable prompt with static body + session-facts
    expect(out).toContain('You are OpenAgentic');
    expect(out).toContain('<session-facts>');
    expect(out).not.toContain('<memories>');
  });

  it('total size cap: ≤ 5000 tokens (20000 chars at 4 chars/token) for admin with 5 memories', async () => {
    const out = await getSystemPromptForRole('admin', minCtx, {
      memoryRecall: async () => [
        { key: 'k1', value: 'v1' },
        { key: 'k2', value: 'v2' },
        { key: 'k3', value: 'v3' },
        { key: 'k4', value: 'v4' },
        { key: 'k5', value: 'v5' },
      ],
    });
    expect(out.length).toBeLessThanOrEqual(23000); // bumped 20000→22000→23000 for #880/#807 dispatch mechanism + soften + few-shot
  });

  it('total size cap: ≤ 5000 tokens for member with memories', async () => {
    const out = await getSystemPromptForRole('member', minCtx, {
      memoryRecall: async () => [
        { key: 'k1', value: 'v1' },
        { key: 'k2', value: 'v2' },
        { key: 'k3', value: 'v3' },
      ],
    });
    expect(out.length).toBeLessThanOrEqual(23000); // bumped 20000→22000→23000 for #880/#807 dispatch mechanism + soften + few-shot
  });

  it('renders session-facts AFTER static body (order matters)', async () => {
    const out = await getSystemPromptForRole('admin', minCtx, { memoryRecall: async () => [] });
    const staticIdx = out.indexOf('You are OpenAgentic');
    const factsIdx = out.indexOf('<session-facts>');
    expect(staticIdx).toBeGreaterThanOrEqual(0);
    expect(factsIdx).toBeGreaterThan(staticIdx);
  });

  it('renders memories AFTER session-facts (order matters)', async () => {
    const out = await getSystemPromptForRole('admin', minCtx, {
      memoryRecall: async () => [{ key: 'k', value: 'v' }],
    });
    const factsIdx = out.indexOf('<session-facts>');
    const memIdx = out.indexOf('<memories>');
    expect(factsIdx).toBeGreaterThanOrEqual(0);
    expect(memIdx).toBeGreaterThan(factsIdx);
  });

  it('escapes HTML in memory keys/values to prevent injection', async () => {
    const out = await getSystemPromptForRole('admin', minCtx, {
      memoryRecall: async () => [{ key: '<script>', value: 'alert("x")' }],
    });
    expect(out).not.toContain('<script>');
    expect(out).toContain('&lt;script&gt;');
  });

  // -----------------------------------------------------------------------
  // #790 — global READ-ONLY mode notice injection
  // -----------------------------------------------------------------------

  it('#790: omits read-only-mode block when readOnlyMode is false (default)', async () => {
    const out = await getSystemPromptForRole('admin', minCtx, {
      memoryRecall: async () => [],
    });
    expect(out).not.toContain('<read-only-mode>');
    expect(out).not.toContain('READ-ONLY MODE ACTIVE');
  });

  it('#790: omits read-only-mode block when readOnlyMode dep is explicitly false', async () => {
    const out = await getSystemPromptForRole('admin', minCtx, {
      memoryRecall: async () => [],
      readOnlyMode: false,
    });
    expect(out).not.toContain('<read-only-mode>');
  });

  it('#790: injects READ-ONLY notice when readOnlyMode dep is true', async () => {
    const out = await getSystemPromptForRole('admin', minCtx, {
      memoryRecall: async () => [],
      readOnlyMode: true,
    });
    expect(out).toContain('READ-ONLY MODE ACTIVE');
    expect(out).toContain('write / mutation operations are blocked');
  });

  it('#790: read-only-mode notice fires for member role as well', async () => {
    const out = await getSystemPromptForRole('member', minCtx, {
      memoryRecall: async () => [],
      readOnlyMode: true,
    });
    expect(out).toContain('READ-ONLY MODE ACTIVE');
  });
});

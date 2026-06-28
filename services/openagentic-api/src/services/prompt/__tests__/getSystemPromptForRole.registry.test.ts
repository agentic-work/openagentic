/**
 * Task 4: getSystemPromptForRole composes via section registry.
 *
 * Asserts the dynamic-boundary marker splits static from dynamic, the
 * tool-catalog block names actual loaded tools, the discovery section
 * names tools when they're loaded, and the back-compat path (no `tools`
 * passed) still produces a valid prompt.
 */
import { describe, it, expect, vi } from 'vitest';
import { getSystemPromptForRole } from '../getSystemPromptForRole.js';

describe('getSystemPromptForRole — registry composition', () => {
  const baseCtx = {
    userId: 'u1',
    sessionId: 's1',
    tenantId: 't1',
    modelInUse: 'test-model',
    userMessage: 'show me my Azure subs',
    priorTurnCount: 0,
  };

  it('emits the dynamic-boundary marker between static and dynamic sections', async () => {
    const out = await getSystemPromptForRole('member', baseCtx, {
      tools: [{ function: { name: 'azure_list_subscriptions', description: 'List Azure subs.' } }],
    });
    expect(out).toContain('__SYSTEM_PROMPT_DYNAMIC_BOUNDARY__');
    const idx = out.indexOf('__SYSTEM_PROMPT_DYNAMIC_BOUNDARY__');
    expect(out.slice(0, idx)).toMatch(/Discovery flow/);
    expect(out.slice(idx)).toContain('<tool-catalog>');
  });

  it('tool-catalog block lists every tool passed in', async () => {
    const out = await getSystemPromptForRole('member', baseCtx, {
      tools: [
        { function: { name: 'azure_list_subscriptions', description: 'List Azure subs.' } },
        { function: { name: 'k8s_list_namespaces', description: 'List k8s namespaces.' } },
      ],
    });
    expect(out).toContain('`azure_list_subscriptions`');
    expect(out).toContain('`k8s_list_namespaces`');
  });

  it('discovery section names azure_list_subscriptions when it is in tools', async () => {
    const out = await getSystemPromptForRole('member', baseCtx, {
      tools: [{ function: { name: 'azure_list_subscriptions', description: 'List subs.' } }],
    });
    expect(out).toMatch(/azure_list_subscriptions/);
    expect(out).toMatch(/do not `tool_search`/i);
  });

  it('discovery section omits azure_list_subscriptions when it is NOT in tools', async () => {
    const out = await getSystemPromptForRole('member', baseCtx, { tools: [] });
    // The static discovery section's "do not tool_search for azure_list_subscriptions"
    // bullet is gated on enabledTools.has — when nothing's loaded it must not appear.
    const idx = out.indexOf('__SYSTEM_PROMPT_DYNAMIC_BOUNDARY__');
    const staticPortion = idx === -1 ? out : out.slice(0, idx);
    expect(staticPortion).not.toMatch(/`azure_list_subscriptions`/);
  });

  it('back-compat: omitting tools still produces a valid prompt (no tool-catalog block)', async () => {
    const out = await getSystemPromptForRole('member', baseCtx);
    expect(out.length).toBeGreaterThan(200);
    expect(out).not.toContain('<tool-catalog>');
  });

  it('memoryRecall hits still get rendered in <memories> block after boundary', async () => {
    const memoryRecall = vi.fn(async () => [
      { key: 'user.role', value: 'data scientist' },
    ]);
    const out = await getSystemPromptForRole('member', baseCtx, { memoryRecall });
    const idx = out.indexOf('__SYSTEM_PROMPT_DYNAMIC_BOUNDARY__');
    expect(out.slice(idx)).toContain('<memories>');
    expect(out.slice(idx)).toContain('user.role');
  });

  it('static-section function pack (Discovery / Doing tasks / Output / Safety) is present', async () => {
    const out = await getSystemPromptForRole('member', baseCtx, {
      tools: [{ function: { name: 'tool_search', description: 'Discover.' } }],
    });
    expect(out).toMatch(/## Discovery flow/);
    expect(out).toMatch(/## Doing tasks/);
    expect(out).toMatch(/## Output/);
    expect(out).toMatch(/## Safety/);
  });

  it('admin role gets a different discovery body than member role', async () => {
    const tools = [{ function: { name: 'tool_search', description: 'Discover.' } }];
    const adminOut = await getSystemPromptForRole('admin', baseCtx, { tools });
    const memberOut = await getSystemPromptForRole('member', baseCtx, { tools });
    // They share static body etc. but the discovery body differs.
    const extractDiscovery = (s: string) => {
      const start = s.indexOf('## Discovery flow');
      const end = s.indexOf('## Doing tasks');
      return s.slice(start, end);
    };
    expect(extractDiscovery(adminOut)).not.toBe(extractDiscovery(memberOut));
  });
});

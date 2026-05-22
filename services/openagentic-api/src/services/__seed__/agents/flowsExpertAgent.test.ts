/**
 * flowsExpertAgent — TDD tests.
 *
 * The Flows Expert is a registered prisma.agent that knows the entire
 * OpenAgentic Flows architecture: every node type, every template, every
 * canonical pattern. Users can drop it into a flow OR converse with it
 * to author flows.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('../../../utils/prisma.js', () => ({
  prisma: { agent: { upsert: vi.fn() } },
}));

vi.mock('../../../utils/logger.js', () => ({
  loggers: { services: { info: vi.fn(), warn: vi.fn(), error: vi.fn() } },
}));

import { prisma } from '../../../utils/prisma.js';

beforeEach(() => {
  vi.resetAllMocks();
  (prisma.agent.upsert as any).mockResolvedValue({
    id: 'flows-expert-uuid',
    name: 'flows_expert',
  });
});

describe('seedFlowsExpertAgent', () => {
  it('upserts agent with name=flows_expert and category=platform', async () => {
    const { seedFlowsExpertAgent } = await import('./flowsExpertAgent');
    await seedFlowsExpertAgent();

    expect(prisma.agent.upsert).toHaveBeenCalledOnce();
    const call = (prisma.agent.upsert as any).mock.calls[0][0];
    expect(call.where.name).toBe('flows_expert');
    expect(call.create.category).toBe('platform');
  });

  it('system prompt mentions every primary node category for build guidance', async () => {
    const { seedFlowsExpertAgent } = await import('./flowsExpertAgent');
    await seedFlowsExpertAgent();

    const call = (prisma.agent.upsert as any).mock.calls[0][0];
    const prompt = call.create.system_prompt as string;
    // Expect coverage of the high-level node categories that appear in the registry
    expect(prompt).toMatch(/agent_single|agent_pool|multi_agent/i);
    expect(prompt).toMatch(/data_source_query|http_request/i);
    expect(prompt).toMatch(/openagentic|code/i);
    expect(prompt).toMatch(/output[\s_]?assertions/i);
  });

  it('system prompt instructs the agent to use registered agentIds, not inline ghost agents', async () => {
    const { seedFlowsExpertAgent } = await import('./flowsExpertAgent');
    await seedFlowsExpertAgent();

    const call = (prisma.agent.upsert as any).mock.calls[0][0];
    const prompt = call.create.system_prompt as string;
    expect(prompt).toMatch(/agentId/);
    expect(prompt).toMatch(/registry|SOT|prisma/i);
  });

  it('system prompt teaches the multi_agent pattern dropdown (parallel|sequential|supervisor|debate)', async () => {
    const { seedFlowsExpertAgent } = await import('./flowsExpertAgent');
    await seedFlowsExpertAgent();

    const call = (prisma.agent.upsert as any).mock.calls[0][0];
    const prompt = call.create.system_prompt as string;
    expect(prompt).toMatch(/parallel/i);
    expect(prompt).toMatch(/sequential/i);
    expect(prompt).toMatch(/supervisor/i);
    expect(prompt).toMatch(/debate/i);
  });

  it('agent_type is flows_expert and is_default is false (so admin can edit without re-seed wiping)', async () => {
    const { seedFlowsExpertAgent } = await import('./flowsExpertAgent');
    await seedFlowsExpertAgent();

    const call = (prisma.agent.upsert as any).mock.calls[0][0];
    expect(call.create.agent_type).toBe('flows_expert');
    expect(call.create.is_default).toBe(false);
  });

  it('upsert update path preserves admin edits — only refreshes display_name + category metadata', async () => {
    const { seedFlowsExpertAgent } = await import('./flowsExpertAgent');
    await seedFlowsExpertAgent();

    const call = (prisma.agent.upsert as any).mock.calls[0][0];
    // The update branch must NOT clobber system_prompt or tools_whitelist on re-seed
    expect(call.update.system_prompt).toBeUndefined();
    expect(call.update.tools_whitelist).toBeUndefined();
    // It DOES refresh display_name + description so renames take effect
    expect(call.update.display_name).toBeDefined();
  });

  it('tools_whitelist on initial create includes web_search/web_fetch for doc consultation', async () => {
    const { seedFlowsExpertAgent } = await import('./flowsExpertAgent');
    await seedFlowsExpertAgent();

    const call = (prisma.agent.upsert as any).mock.calls[0][0];
    const tools = call.create.tools_whitelist as string[];
    expect(tools).toEqual(expect.arrayContaining(['web_search', 'web_fetch']));
  });

  it('returns the upserted agent id', async () => {
    const { seedFlowsExpertAgent } = await import('./flowsExpertAgent');
    const id = await seedFlowsExpertAgent();
    expect(id).toBe('flows-expert-uuid');
  });
});

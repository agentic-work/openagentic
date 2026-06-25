import { describe, it, expect } from 'vitest';
import { getSystemMcpPrompts } from '../index.js';

describe('getSystemMcpPrompts — legacy ARTIFACT_GUIDANCE_PROMPT is no longer injected', () => {
  it('does NOT inject the cost+Sankey artifact guidance for visualization-style asks', () => {
    const prompts = getSystemMcpPrompts('show me my cloud costs as a Sankey diagram');
    const joined = prompts.join('\n');
    // The composable artifact-creation module (in ModuleSeeder.ts) is the SoT
    // for visualization guidance — admins edit it from /admin#prompt-modules.
    // The legacy hardcoded paragraph that nudged the LLM toward
    // "fetch costs THEN build a Sankey" must be gone.
    expect(joined).not.toContain('ARTIFACT & VISUALIZATION GUIDANCE');
    expect(joined).not.toContain('When Users Ask About Cloud Costs');
    expect(joined).not.toContain('Create a **Sankey diagram artifact**');
    expect(joined).not.toContain('first**: Use the appropriate MCP tools to GET THE REAL DATA');
  });

  it('returns an empty list for a plain Azure resource ask (no scope-creep injection)', () => {
    const prompts = getSystemMcpPrompts('show me my azure subscriptions and resource groups');
    expect(prompts).toEqual([]);
  });

  it('still injects the browser_exec hint when the prompt suggests computation', () => {
    const prompts = getSystemMcpPrompts('compute the prime sieve up to 1000 and plot it');
    // browser_exec hint is unchanged — only the artifact paragraph is rip'd.
    const joined = prompts.join('\n');
    expect(joined.length).toBeGreaterThan(0);
  });
});

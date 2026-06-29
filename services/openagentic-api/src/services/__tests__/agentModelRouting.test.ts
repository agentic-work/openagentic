/**
 * agentModelRouting — TDD spec for task #86.
 *
 * When SubagentOrchestrator fans out N parallel sub-agents, each should
 * resolve its own model via its role's `preferredTier`. Cheap tiers for
 * research/discovery roles, premium for synthesis/architect, local for
 * mechanical/sandboxed. This module is the resolver.
 *
 * Rules:
 *   - role in ROLE_TIER_MAP → its tier wins
 *   - explicit override via subtask.modelOverride wins over tier lookup
 *   - fallback to defaultModel if tier yields no match
 */

import { describe, it, expect, beforeEach, vi } from 'vitest';
import {
  resolveAgentModel,
  ROLE_TIER_MAP,
  type ModelTier,
} from '../agentModelRouting.js';

// Stub "registry" — callers pass a function that resolves a tier to a
// concrete model id. Tests use a fake with predictable results.
function stubRegistry(mapping: Record<ModelTier, string | null>) {
  return vi.fn((tier: ModelTier) => mapping[tier] ?? null);
}

describe('ROLE_TIER_MAP', () => {
  it('research roles map to economical', () => {
    expect(ROLE_TIER_MAP['research']).toBe('economical');
    expect(ROLE_TIER_MAP['discovery']).toBe('economical');
  });

  it('synthesis / architect map to premium', () => {
    expect(ROLE_TIER_MAP['synthesis']).toBe('premium');
    expect(ROLE_TIER_MAP['architect']).toBe('premium');
  });

  it('#658 — built-in agent role names (with dashes) map correctly', () => {
    // These role names match the .md files in src/agents/built-in/.
    // Capstone Phase 2 smoking-gun: `cloud-operations` and `reasoning`
    // sub-agents were falling through to defaultModel (gpt-oss:20b)
    // because the original map only had partial / underscore-only keys.
    expect(ROLE_TIER_MAP['cloud-operations']).toBe('premium');
    expect(ROLE_TIER_MAP['reasoning']).toBe('premium');
    expect(ROLE_TIER_MAP['planning']).toBe('premium');
    expect(ROLE_TIER_MAP['validation']).toBe('premium');
    expect(ROLE_TIER_MAP['artifact-creation']).toBe('premium');
    expect(ROLE_TIER_MAP['code-execution']).toBe('balanced');
    expect(ROLE_TIER_MAP['data-query']).toBe('balanced');
  });

  it('mechanical roles map to local', () => {
    expect(ROLE_TIER_MAP['mechanical']).toBe('local');
    expect(ROLE_TIER_MAP['sandbox']).toBe('local');
  });

  it('covers the registry-seeded agent types', () => {
    // Agents seeded in admin-agents.ts: synthesis, artifact_creation, …
    expect(ROLE_TIER_MAP['artifact_creation']).toBeDefined();
  });
});

describe('resolveAgentModel', () => {
  const reg = stubRegistry({
    premium: 'claude-sonnet-4-6',
    balanced: 'claude-haiku-4-5',
    economical: 'gpt-oss',
    local: 'ollama:llama3',
  });

  beforeEach(() => reg.mockClear());

  it('picks the economical tier for a research role', () => {
    const out = resolveAgentModel({ role: 'research' }, 'claude-sonnet-4-6', reg);
    expect(out).toBe('gpt-oss');
    expect(reg).toHaveBeenCalledWith('economical');
  });

  it('picks the premium tier for a synthesis role', () => {
    const out = resolveAgentModel({ role: 'synthesis' }, 'claude-sonnet-4-6', reg);
    expect(out).toBe('claude-sonnet-4-6');
  });

  it('picks the local tier for a mechanical role', () => {
    const out = resolveAgentModel({ role: 'mechanical' }, 'claude-sonnet-4-6', reg);
    expect(out).toBe('ollama:llama3');
  });

  it('explicit modelOverride wins over role lookup', () => {
    const out = resolveAgentModel(
      { role: 'research', modelOverride: 'claude-opus-4-7' },
      'claude-sonnet-4-6',
      reg,
    );
    expect(out).toBe('claude-opus-4-7');
    expect(reg).not.toHaveBeenCalled();
  });

  it('falls back to default when registry returns null for tier', () => {
    const sparse = stubRegistry({
      premium: null,
      balanced: null,
      economical: null, // nothing configured at this tier
      local: null,
    });
    const out = resolveAgentModel({ role: 'research' }, 'fallback-model', sparse);
    expect(out).toBe('fallback-model');
  });

  it('unknown role falls back to default model', () => {
    const out = resolveAgentModel({ role: 'totally-made-up' }, 'fallback', reg);
    expect(out).toBe('fallback');
    expect(reg).not.toHaveBeenCalled();
  });

  it('3 agents [research, research, synthesis] pick 2 cheap + 1 premium', () => {
    const agents = [
      { role: 'research' },
      { role: 'research' },
      { role: 'synthesis' },
    ];
    const picks = agents.map((a) => resolveAgentModel(a, 'default', reg));
    expect(picks).toEqual(['gpt-oss', 'gpt-oss', 'claude-sonnet-4-6']);
  });
});

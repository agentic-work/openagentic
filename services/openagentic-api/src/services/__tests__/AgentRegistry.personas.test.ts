import { describe, test, expect } from 'vitest';
import {
  DEFAULT_MODEL_CONFIGS,
  DEFAULT_TOOLS_WHITELIST,
  DEFAULT_PROMPT_MODULES,
  type AgentType,
} from '../AgentRegistry.js';

const PERSONAS = ['finops_analyst', 'security_auditor', 'engineering_metrics', 'product_analyst'] as const;

describe('AgentRegistry personas (plan task 9, stage A)', () => {
  test.each(PERSONAS)('%s is a valid AgentType', (persona) => {
    // TS-level check: assignment to AgentType must compile (guard at assertion site)
    const t: AgentType = persona as AgentType;
    expect(t).toBe(persona);
  });

  test.each(PERSONAS)('%s has preferredTier:premium in DEFAULT_MODEL_CONFIGS', (persona) => {
    expect(DEFAULT_MODEL_CONFIGS[persona]?.preferredTier).toBe('premium');
  });

  test.each(PERSONAS)('%s has empty tool whitelist in DEFAULT_TOOLS_WHITELIST', (persona) => {
    expect(DEFAULT_TOOLS_WHITELIST[persona]).toEqual([]);
  });

  test.each(PERSONAS)('%s prompt modules include artifact-creation + architecture-diagram', (persona) => {
    const mods = DEFAULT_PROMPT_MODULES[persona];
    expect(mods).toContain('artifact-creation');
    expect(mods).toContain('architecture-diagram');
    expect(mods).toContain('identity-default');
    expect(mods).toContain('safety');
    expect(mods).toContain('continuation');
  });

  test.each(PERSONAS)('%s model-config mirrors artifact_creation (same thinking/temperature/maxTokens)', (persona) => {
    const p = DEFAULT_MODEL_CONFIGS[persona];
    const a = DEFAULT_MODEL_CONFIGS['artifact_creation'];
    expect(p.thinkingEnabled).toBe(a.thinkingEnabled);
    expect(p.temperature).toBe(a.temperature);
    expect(p.maxTokens).toBe(a.maxTokens);
    expect(p.thinkingBudget).toBe(a.thinkingBudget);
    expect(p.costBudgetPerCall).toBe(a.costBudgetPerCall);
    expect(p.timeoutMs).toBe(a.timeoutMs);
    expect(p.primaryModel).toBe(a.primaryModel);
    expect(p.retryAttempts).toBe(a.retryAttempts);
    expect(p.fallbackModel).toBe(a.fallbackModel);
  });
});

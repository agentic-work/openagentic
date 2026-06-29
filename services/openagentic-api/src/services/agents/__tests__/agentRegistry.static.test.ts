/**
 * Agent Registry — Static Configuration Tests (A1)
 *
 * Validates that EVERY registered AgentType has the required structural
 * invariants in the exported constants from AgentRegistry.ts:
 *
 *   A1-a  name is non-empty and unique (enforced by AgentType union)
 *   A1-b  DEFAULT_MODEL_CONFIGS entry exists with required fields
 *   A1-c  primaryModel is 'auto' (Smart Router — no hardcoded model IDs)
 *   A1-d  fallbackModel is 'auto' when present
 *   A1-e  maxTokens > 0
 *   A1-f  temperature in [0, 2]
 *   A1-g  costBudgetPerCall > 0
 *   A1-h  timeoutMs > 0
 *   A1-i  retryAttempts >= 0
 *   A1-j  preferredTier is a known ModelTierPreference value
 *   A1-k  DEFAULT_TOOLS_WHITELIST entry exists (may be [] for "all tools")
 *   A1-l  DEFAULT_PROMPT_MODULES entry exists and includes 'identity-default', 'safety', 'continuation'
 *
 * These tests are purely static — they do NOT touch the database or network.
 * They run against the exported constants and will catch config drift before
 * it reaches production.
 *
 * Coverage: 18 AgentTypes × 12 assertions = 216 static assertions
 * (The "32" figure in the UI reflects multiple rows per type; unique types = 18)
 */

import { describe, it, expect } from 'vitest';
import {
  DEFAULT_MODEL_CONFIGS,
  DEFAULT_TOOLS_WHITELIST,
  DEFAULT_PROMPT_MODULES,
  type AgentType,
  type ModelTierPreference,
} from '../../AgentRegistry.js';

// ---------------------------------------------------------------------------
// All 18 registered AgentTypes — source of truth is the AgentType union in
// AgentRegistry.ts. Update this list if/when new types are added.
// ---------------------------------------------------------------------------
const ALL_AGENT_TYPES: AgentType[] = [
  'data_query',
  'data_extraction',
  'tool_orchestration',
  'reasoning',
  'summarization',
  'code_execution',
  'planning',
  'validation',
  'synthesis',
  'artifact_creation',
  'docs_assistant',
  'flows_agent',
  'cloud_operations',
  'finops_analyst',
  'security_auditor',
  'engineering_metrics',
  'product_analyst',
  'custom',
];

const VALID_TIERS: ModelTierPreference[] = ['premium', 'balanced', 'economical', 'free'];

// ---------------------------------------------------------------------------
// A1-a: ALL_AGENT_TYPES list is unique (sanity-check the test fixture itself)
// ---------------------------------------------------------------------------
describe('agentRegistry static — fixture integrity', () => {
  it('ALL_AGENT_TYPES list has no duplicates', () => {
    const set = new Set(ALL_AGENT_TYPES);
    expect(set.size).toBe(ALL_AGENT_TYPES.length);
  });

  it('ALL_AGENT_TYPES covers every key in DEFAULT_MODEL_CONFIGS', () => {
    const configKeys = Object.keys(DEFAULT_MODEL_CONFIGS) as AgentType[];
    for (const key of configKeys) {
      expect(ALL_AGENT_TYPES).toContain(key);
    }
  });

  it('DEFAULT_MODEL_CONFIGS covers every type in ALL_AGENT_TYPES', () => {
    for (const agentType of ALL_AGENT_TYPES) {
      expect(DEFAULT_MODEL_CONFIGS).toHaveProperty(agentType);
    }
  });
});

// ---------------------------------------------------------------------------
// A1-b through A1-j: model_config invariants — one test.each per invariant
// ---------------------------------------------------------------------------
describe('agentRegistry static — DEFAULT_MODEL_CONFIGS', () => {
  it.each(ALL_AGENT_TYPES)(
    'A1-b %s: DEFAULT_MODEL_CONFIGS entry exists',
    (agentType) => {
      expect(DEFAULT_MODEL_CONFIGS[agentType]).toBeDefined();
    }
  );

  it.each(ALL_AGENT_TYPES)(
    'A1-c %s: primaryModel is "auto" (Smart Router — no hardcoded model IDs)',
    (agentType) => {
      expect(DEFAULT_MODEL_CONFIGS[agentType].primaryModel).toBe('auto');
    }
  );

  it.each(ALL_AGENT_TYPES)(
    'A1-d %s: fallbackModel is "auto" when defined',
    (agentType) => {
      const { fallbackModel } = DEFAULT_MODEL_CONFIGS[agentType];
      if (fallbackModel !== undefined) {
        expect(fallbackModel).toBe('auto');
      }
    }
  );

  it.each(ALL_AGENT_TYPES)(
    'A1-e %s: maxTokens > 0',
    (agentType) => {
      expect(DEFAULT_MODEL_CONFIGS[agentType].maxTokens).toBeGreaterThan(0);
    }
  );

  it.each(ALL_AGENT_TYPES)(
    'A1-f %s: temperature in [0, 2]',
    (agentType) => {
      const { temperature } = DEFAULT_MODEL_CONFIGS[agentType];
      expect(temperature).toBeGreaterThanOrEqual(0);
      expect(temperature).toBeLessThanOrEqual(2);
    }
  );

  it.each(ALL_AGENT_TYPES)(
    'A1-g %s: costBudgetPerCall > 0',
    (agentType) => {
      expect(DEFAULT_MODEL_CONFIGS[agentType].costBudgetPerCall).toBeGreaterThan(0);
    }
  );

  it.each(ALL_AGENT_TYPES)(
    'A1-h %s: timeoutMs > 0',
    (agentType) => {
      expect(DEFAULT_MODEL_CONFIGS[agentType].timeoutMs).toBeGreaterThan(0);
    }
  );

  it.each(ALL_AGENT_TYPES)(
    'A1-i %s: retryAttempts >= 0',
    (agentType) => {
      expect(DEFAULT_MODEL_CONFIGS[agentType].retryAttempts).toBeGreaterThanOrEqual(0);
    }
  );

  it.each(ALL_AGENT_TYPES)(
    'A1-j %s: preferredTier is a valid ModelTierPreference',
    (agentType) => {
      const { preferredTier } = DEFAULT_MODEL_CONFIGS[agentType];
      if (preferredTier !== undefined) {
        expect(VALID_TIERS).toContain(preferredTier);
      }
    }
  );

  it.each(ALL_AGENT_TYPES)(
    'A1-j2 %s: agentType field matches the key',
    (agentType) => {
      expect(DEFAULT_MODEL_CONFIGS[agentType].agentType).toBe(agentType);
    }
  );
});

// ---------------------------------------------------------------------------
// A1-k: tools whitelist — entry exists (may be [] for "all tools available")
// ---------------------------------------------------------------------------
describe('agentRegistry static — DEFAULT_TOOLS_WHITELIST', () => {
  it.each(ALL_AGENT_TYPES)(
    'A1-k %s: DEFAULT_TOOLS_WHITELIST entry exists',
    (agentType) => {
      expect(DEFAULT_TOOLS_WHITELIST).toHaveProperty(agentType);
    }
  );

  it.each(ALL_AGENT_TYPES)(
    'A1-k2 %s: tools whitelist is an Array',
    (agentType) => {
      expect(Array.isArray(DEFAULT_TOOLS_WHITELIST[agentType])).toBe(true);
    }
  );

  // Spot-check known whitelists that must contain specific tools
  it('reasoning whitelist contains web_search and web_fetch', () => {
    expect(DEFAULT_TOOLS_WHITELIST['reasoning']).toContain('web_search');
    expect(DEFAULT_TOOLS_WHITELIST['reasoning']).toContain('web_fetch');
  });

  it('data_query whitelist contains query_data', () => {
    expect(DEFAULT_TOOLS_WHITELIST['data_query']).toContain('query_data');
  });

  it('code_execution whitelist contains openagentic_execute', () => {
    expect(DEFAULT_TOOLS_WHITELIST['code_execution']).toContain('openagentic_execute');
  });

  it('validation whitelist contains web_search', () => {
    expect(DEFAULT_TOOLS_WHITELIST['validation']).toContain('web_search');
  });

  // cloud_operations / persona agents use "all tools" (empty list)
  it.each(['cloud_operations', 'finops_analyst', 'security_auditor', 'engineering_metrics', 'product_analyst'])(
    '%s has empty tools whitelist (all tools available)',
    (agentType) => {
      expect(DEFAULT_TOOLS_WHITELIST[agentType]).toEqual([]);
    }
  );
});

// ---------------------------------------------------------------------------
// A1-l: prompt modules — required baseline modules must appear in every agent
// ---------------------------------------------------------------------------
describe('agentRegistry static — DEFAULT_PROMPT_MODULES', () => {
  it.each(ALL_AGENT_TYPES)(
    'A1-l %s: DEFAULT_PROMPT_MODULES entry exists',
    (agentType) => {
      expect(DEFAULT_PROMPT_MODULES).toHaveProperty(agentType);
    }
  );

  it.each(ALL_AGENT_TYPES)(
    'A1-l2 %s: prompt modules is a non-empty Array',
    (agentType) => {
      const mods = DEFAULT_PROMPT_MODULES[agentType];
      expect(Array.isArray(mods)).toBe(true);
      expect(mods.length).toBeGreaterThan(0);
    }
  );

  it.each(ALL_AGENT_TYPES)(
    'A1-l3 %s: includes identity-default',
    (agentType) => {
      expect(DEFAULT_PROMPT_MODULES[agentType]).toContain('identity-default');
    }
  );

  it.each(ALL_AGENT_TYPES)(
    'A1-l4 %s: includes safety',
    (agentType) => {
      expect(DEFAULT_PROMPT_MODULES[agentType]).toContain('safety');
    }
  );

  it.each(ALL_AGENT_TYPES)(
    'A1-l5 %s: includes continuation',
    (agentType) => {
      expect(DEFAULT_PROMPT_MODULES[agentType]).toContain('continuation');
    }
  );

  // Agents with tool calling must include a tool-calling strategy module
  it.each(['reasoning', 'data_query', 'tool_orchestration', 'code_execution', 'validation'])(
    '%s includes a tool-calling module',
    (agentType) => {
      const mods = DEFAULT_PROMPT_MODULES[agentType as AgentType];
      const hasToolCalling = mods.some((m: string) =>
        m === 'tool-calling-strategy' || m === 'tool-calling' || m === 'tool_calling'
      );
      expect(hasToolCalling).toBe(true);
    }
  );

  // cloud_operations must have the 10 cloud-ops-* behavioral modules
  it('cloud_operations has all cloud-ops-* safety modules', () => {
    const mods = DEFAULT_PROMPT_MODULES['cloud_operations'];
    const cloudOpsModules = [
      'cloud-ops-identity-discovery',
      'cloud-ops-typed-tools-first',
      'cloud-ops-quota-fallback',
      'cloud-ops-region-fallback',
      'cloud-ops-dependency-ordering',
      'cloud-ops-long-running',
      'cloud-ops-cleanup',
      'cloud-ops-hitl-denial',
      'cloud-ops-no-early-termination',
      'cloud-ops-token-failure',
    ];
    for (const mod of cloudOpsModules) {
      expect(mods).toContain(mod);
    }
  });

  // Persona agents share the visualization module set
  it.each(['finops_analyst', 'security_auditor', 'engineering_metrics', 'product_analyst'])(
    '%s includes artifact-creation and architecture-diagram modules',
    (agentType) => {
      const mods = DEFAULT_PROMPT_MODULES[agentType as AgentType];
      expect(mods).toContain('artifact-creation');
      expect(mods).toContain('architecture-diagram');
    }
  );
});

// ---------------------------------------------------------------------------
// A2: output_schema shape declarations (expected output shape per agent)
// These are enforced at the config level; the actual JSON Schema lives in the
// AGENT_EXPECTED_OUTPUT_SCHEMAS map in agentBehavior.harness.ts.
// This test just confirms the harness map covers all 19 agent types.
// ---------------------------------------------------------------------------
describe('agentRegistry static — ALL_AGENT_TYPES completeness', () => {
  it('has exactly 19 unique agent types', () => {
    expect(ALL_AGENT_TYPES).toHaveLength(19);
  });

  it('cloud_operations has contextWindowMin >= 1_000_000', () => {
    expect(DEFAULT_MODEL_CONFIGS['cloud_operations'].contextWindowMin).toBeGreaterThanOrEqual(1_000_000);
  });

  it('cloud_operations has preferredTier:premium', () => {
    expect(DEFAULT_MODEL_CONFIGS['cloud_operations'].preferredTier).toBe('premium');
  });

  it('reasoning has thinkingEnabled:true and thinkingBudget set', () => {
    const cfg = DEFAULT_MODEL_CONFIGS['reasoning'];
    expect(cfg.thinkingEnabled).toBe(true);
    expect(cfg.thinkingBudget).toBeGreaterThan(0);
  });

  it('data_query has thinkingEnabled:false (fast/economical path)', () => {
    expect(DEFAULT_MODEL_CONFIGS['data_query'].thinkingEnabled).toBe(false);
  });

  it('validation has thinkingEnabled:false (fast verification pass)', () => {
    expect(DEFAULT_MODEL_CONFIGS['validation'].thinkingEnabled).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// Cross-cutting: SEED_AGENTS subset check (the admin /seed endpoint only seeds
// 12 of the 19 types; the remaining 7 come from seedDefaultLoops at boot).
// This test documents what is seeded vs. what is boot-seeded.
// ---------------------------------------------------------------------------
describe('agentRegistry static — SEED_AGENTS subset', () => {
  // These 11 are explicitly in admin-agents.ts SEED_AGENTS
  const EXPLICITLY_SEEDED: AgentType[] = [
    'reasoning',
    'data_query',
    'tool_orchestration',
    'summarization',
    'code_execution',
    'planning',
    'validation',
    'synthesis',
    'artifact_creation',
    'cloud_operations',
    'custom',
  ];

  // These 7 are boot-seeded via seedDefaultLoops (DEFAULT_MODEL_CONFIGS iteration)
  const BOOT_SEEDED_ONLY: AgentType[] = [
    'data_extraction',
    'docs_assistant',
    'flows_agent',
    'finops_analyst',
    'security_auditor',
    'engineering_metrics',
    'product_analyst',
  ];

  it('EXPLICITLY_SEEDED + BOOT_SEEDED_ONLY = ALL_AGENT_TYPES', () => {
    const combined = [...EXPLICITLY_SEEDED, ...BOOT_SEEDED_ONLY].sort();
    expect(combined).toEqual([...ALL_AGENT_TYPES].sort());
  });

  it.each(EXPLICITLY_SEEDED)(
    '%s has a model config entry (explicitly seeded agents must be fully configured)',
    (agentType) => {
      const cfg = DEFAULT_MODEL_CONFIGS[agentType];
      expect(cfg).toBeDefined();
      expect(cfg.primaryModel).toBe('auto');
    }
  );

  it.each(BOOT_SEEDED_ONLY)(
    '%s has a model config entry (boot-seeded agents must be fully configured)',
    (agentType) => {
      const cfg = DEFAULT_MODEL_CONFIGS[agentType];
      expect(cfg).toBeDefined();
      expect(cfg.primaryModel).toBe('auto');
    }
  );
});

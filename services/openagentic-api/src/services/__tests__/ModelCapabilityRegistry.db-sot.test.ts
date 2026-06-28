/**
 * ModelCapabilityRegistry — DB-as-SoT priority test.
 *
 * Per docs/rules/no-hardcoded-models.md, capability inference must read from
 * the registry (admin.model_role_assignments.capabilities JSONB) before
 * falling back to substring/regex pattern matching. The audit
 * (project_provider_model_sot_audit_2026_05_05.md, item H1) flagged that
 * the registry's loadFromDatabase() reads from a non-existent
 * `modelCapability` table, so the substring inference is the de facto
 * SoT — exactly what the rule forbids.
 *
 * RED behavior: registry.getCapabilities('gpt-5.4') returns the
 * pattern-inferred result (vision: false because 'gpt-5.4' doesn't match
 * any pattern that sets vision=true), even though the live DB has
 * model_role_assignments rows with capabilities.vision=true.
 *
 * GREEN behavior: registry initialized with prisma → reads
 * modelRoleAssignment.findMany({state:'active', enabled:true}) →
 * populates cache from each row's capabilities JSONB →
 * getCapabilities('gpt-5.4') returns the DB row's capabilities, NOT the
 * pattern fallback.
 */

import { describe, it, expect, vi } from 'vitest';
import pino from 'pino';
import { ModelCapabilityRegistry } from '../ModelCapabilityRegistry';

const silentLogger = pino({ level: 'silent' });

function fakePrisma(rows: Array<{ model: string; provider: string; capabilities: Record<string, boolean> }>) {
  return {
    modelRoleAssignment: {
      findMany: vi.fn(async () => rows.map(r => ({
        model: r.model,
        provider: r.provider,
        capabilities: r.capabilities,
        state: 'active',
        enabled: true,
      }))),
    },
  } as any;
}

describe('ModelCapabilityRegistry — DB-as-SoT priority', () => {
  it('uses model_role_assignments.capabilities, not substring patterns, when DB has the row', async () => {
    const prisma = fakePrisma([
      { model: 'custom-internal-vision-model', provider: 'aif', capabilities: {
        chat: true, tools: true, vision: true, thinking: false,
        streaming: true, embeddings: false, imageGeneration: false,
      }},
    ]);
    const registry = new ModelCapabilityRegistry(silentLogger, prisma);
    await registry.initialize();

    const caps = registry.getCapabilities('custom-internal-vision-model');
    expect(caps.vision).toBe(true);
    expect(caps.functionCalling || caps.chat).toBe(true);
    expect(prisma.modelRoleAssignment.findMany).toHaveBeenCalled();
  });

  it('DB row trumps the pattern fallback when both could match', async () => {
    // gpt-5.4 has no built-in MODEL_PATTERNS entry, so without DB it falls
    // through to a generic default. With DB → uses the row's capabilities.
    const prisma = fakePrisma([
      { model: 'gpt-5.4', provider: 'aif', capabilities: {
        chat: true, tools: true, vision: true, thinking: false,
        streaming: true, embeddings: false, imageGeneration: false,
      }},
    ]);
    const registry = new ModelCapabilityRegistry(silentLogger, prisma);
    await registry.initialize();

    const caps = registry.getCapabilities('gpt-5.4');
    expect(caps.vision).toBe(true);
    expect(caps.functionCalling).toBe(true);
  });

  it('falls back to pattern inference for models not in the DB', async () => {
    const prisma = fakePrisma([]);
    const registry = new ModelCapabilityRegistry(silentLogger, prisma);
    await registry.initialize();

    // Pattern fallback is acceptable as a backstop, just must not be the SoT.
    const caps = registry.getCapabilities('gpt-4o-mini');
    expect(caps).toBeDefined();
    expect(caps.modelId).toBe('gpt-4o-mini');
  });
});

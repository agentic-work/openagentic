/**
 * #509 Sev-1 — Seeder/discovery must respect admin disposal.
 *
 * Today, admin DELETEs a registry row → next api restart, LLMProviderSeeder
 * runs upsertDiscoveredModels, which sees the model "missing" from the
 * registry and re-INSERTs it. Admin's intent is silently overwritten.
 *
 * Phase 1 added a `state` column with `disposed` enum value. The fix:
 * planRegistryUpsert must check existing rows' state and skip ANY discovered
 * model whose (role, model, provider) tuple — or even any tuple under that
 * (model, provider) regardless of role — has a `disposed` row. Disposal is
 * a tombstone: discovery cannot re-create.
 *
 * RED→GREEN. Pure-function test against planRegistryUpsert; no DB needed.
 */
import { describe, it, expect } from 'vitest';
import { planRegistryUpsert, type RegistryRow } from '../RegistryUpsertService.js';

const NOW = () => new Date('2026-04-29T18:00:00Z');
const provider = 'aws-bedrock';
const createdBy = 'admin-uuid';

const disposedRow: RegistryRow = {
  id: 'r-disposed',
  role: 'chat',
  model: 'global.anthropic.claude-sonnet-4',
  provider,
  priority: 10,
  enabled: false,
  temperature: 0.7,
  max_tokens: null,
  capabilities: { chat: true },
  options: { auto: true },
  description: 'Sonnet 4',
  created_by: createdBy,
  // Phase 1 lifecycle field
  state: 'disposed',
} as any;

const activeRow: RegistryRow = {
  ...disposedRow,
  id: 'r-active',
  enabled: true,
  state: 'active',
} as any;

describe('planRegistryUpsert — #509 respect admin disposal', () => {
  it('emits NO plan for a discovered model whose existing row is disposed', () => {
    const plans = planRegistryUpsert(
      provider,
      [{ id: disposedRow.model, name: 'Sonnet 4', provider, capabilities: { chat: true } }],
      [disposedRow],
      createdBy,
      NOW,
    );
    expect(plans).toHaveLength(0);
  });

  it('emits NO plan even if a sibling-role row exists for the same model in disposed state', () => {
    const sibling: RegistryRow = { ...disposedRow, id: 'r-sib', role: 'code' } as any;
    const plans = planRegistryUpsert(
      provider,
      [{ id: disposedRow.model, name: 'Sonnet 4', provider, capabilities: { chat: true } }],
      [sibling],
      createdBy,
      NOW,
    );
    // Disposal is per-model tombstone: any disposed row for the model
    // (regardless of role) blocks recreation.
    expect(plans).toHaveLength(0);
  });

  it('still emits an insert plan when the existing row is active (regression guard)', () => {
    const plans = planRegistryUpsert(
      provider,
      [{ id: 'new-model', name: 'New', provider, capabilities: { chat: true } }],
      [activeRow],
      createdBy,
      NOW,
    );
    expect(plans).toHaveLength(1);
    expect(plans[0]).toMatchObject({ action: 'insert' });
  });

  it('still emits an update plan when the existing row is active (regression guard)', () => {
    const plans = planRegistryUpsert(
      provider,
      [{ id: activeRow.model, name: 'Sonnet 4', provider, capabilities: { chat: true, vision: true } }],
      [activeRow],
      createdBy,
      NOW,
    );
    expect(plans).toHaveLength(1);
    expect(plans[0]).toMatchObject({ action: 'update' });
  });

  it('also skips deprecated rows (retention period — same tombstone semantics)', () => {
    const deprecatedRow: RegistryRow = { ...disposedRow, id: 'r-dep', state: 'deprecated' } as any;
    const plans = planRegistryUpsert(
      provider,
      [{ id: deprecatedRow.model, name: 'Sonnet 4', provider, capabilities: { chat: true } }],
      [deprecatedRow],
      createdBy,
      NOW,
    );
    expect(plans).toHaveLength(0);
  });
});

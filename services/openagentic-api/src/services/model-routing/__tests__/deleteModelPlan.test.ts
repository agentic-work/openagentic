import { describe, it, expect } from 'vitest';
import { computeDeletePlan, type RawProviderRow } from '../deleteModelPlan.js';

const provider = (overrides: Partial<RawProviderRow>): RawProviderRow => ({
  id: overrides.id ?? 'p-1',
  name: overrides.name ?? 'bedrock-main',
  model_config: overrides.model_config ?? {},
  provider_config: overrides.provider_config ?? {},
});

describe('computeDeletePlan', () => {
  describe('self-reference auto-clear (was a 409 before)', () => {
    it('allows delete when only the target provider references the model as chatModel', () => {
      const plan = computeDeletePlan({
        targetProviderId: 'p-1',
        modelId: 'us.anthropic.claude-sonnet-4-6',
        targetProvider: provider({
          model_config: { chatModel: 'us.anthropic.claude-sonnet-4-6' },
          provider_config: { models: [{ id: 'us.anthropic.claude-sonnet-4-6' }] },
        }),
        otherEnabledProviders: [],
        roleAssignmentCount: 0,
        recentSessionCount: 0,
        force: false,
      });

      expect(plan.canDelete).toBe(true);
      expect(plan.blockers).toEqual([]);
      expect(plan.selfReferenceFields).toEqual(['model_config.chatModel']);
    });

    it('collects ALL self-reference fields so the caller can clear all of them', () => {
      const plan = computeDeletePlan({
        targetProviderId: 'p-1',
        modelId: 'gpt-5.2',
        targetProvider: provider({
          name: 'azure-ai-foundry',
          model_config: {
            chatModel: 'gpt-5.2',
            defaultModel: 'gpt-5.2',
            toolModel: 'gpt-5.2',
          },
          provider_config: {
            modelId: 'gpt-5.2',
            deploymentName: 'gpt-5.2',
          },
        }),
        otherEnabledProviders: [],
        roleAssignmentCount: 0,
        recentSessionCount: 0,
        force: false,
      });

      expect(plan.canDelete).toBe(true);
      expect(plan.selfReferenceFields).toEqual([
        'model_config.chatModel',
        'model_config.defaultModel',
        'model_config.toolModel',
        'provider_config.modelId',
        'provider_config.deploymentName',
      ]);
    });
  });

  describe('cross-provider blocks (real 409)', () => {
    it('blocks when another enabled provider references this model', () => {
      const plan = computeDeletePlan({
        targetProviderId: 'p-1',
        modelId: 'us.anthropic.claude-sonnet-4-6',
        targetProvider: provider({ model_config: {} }),
        otherEnabledProviders: [
          provider({
            id: 'p-2', name: 'azure-ai-foundry',
            model_config: { chatModel: 'us.anthropic.claude-sonnet-4-6' },
          }),
        ],
        roleAssignmentCount: 0,
        recentSessionCount: 0,
        force: false,
      });

      expect(plan.canDelete).toBe(false);
      expect(plan.blockers).toEqual([
        {
          kind: 'cross_provider_ref',
          description: 'Referenced as model_config.chatModel on provider "azure-ai-foundry"',
        },
      ]);
    });

    it('force=true overrides cross-provider blockers', () => {
      const plan = computeDeletePlan({
        targetProviderId: 'p-1',
        modelId: 'us.anthropic.claude-sonnet-4-6',
        targetProvider: provider({}),
        otherEnabledProviders: [
          provider({
            id: 'p-2', name: 'azure-ai-foundry',
            model_config: { chatModel: 'us.anthropic.claude-sonnet-4-6' },
          }),
        ],
        roleAssignmentCount: 0,
        recentSessionCount: 0,
        force: true,
      });

      expect(plan.canDelete).toBe(true);
      expect(plan.blockers.length).toBe(1); // blockers still surfaced for audit
    });
  });

  describe('role assignment blocks', () => {
    it('blocks when ModelRoleAssignment references this model', () => {
      const plan = computeDeletePlan({
        targetProviderId: 'p-1',
        modelId: 'us.anthropic.claude-sonnet-4-6',
        targetProvider: provider({}),
        otherEnabledProviders: [],
        roleAssignmentCount: 2,
        recentSessionCount: 0,
        force: false,
      });

      expect(plan.canDelete).toBe(false);
      expect(plan.blockers).toEqual([
        {
          kind: 'role_assignment',
          description: '2 active model role assignment(s) reference "us.anthropic.claude-sonnet-4-6"',
        },
      ]);
    });
  });

  describe('session cascade (informational — never blocks)', () => {
    it('reports cascadeSessions=true when sessions reference this model', () => {
      const plan = computeDeletePlan({
        targetProviderId: 'p-1',
        modelId: 'us.anthropic.claude-sonnet-4-6',
        targetProvider: provider({
          model_config: { chatModel: 'us.anthropic.claude-sonnet-4-6' },
        }),
        otherEnabledProviders: [],
        roleAssignmentCount: 0,
        recentSessionCount: 5,
        force: false,
      });

      expect(plan.canDelete).toBe(true);       // sessions never block
      expect(plan.cascadeSessions).toBe(true);
      expect(plan.recentSessionCount).toBe(5);
    });

    it('no cascade when count is zero', () => {
      const plan = computeDeletePlan({
        targetProviderId: 'p-1',
        modelId: 'x',
        targetProvider: provider({}),
        otherEnabledProviders: [],
        roleAssignmentCount: 0,
        recentSessionCount: 0,
        force: false,
      });
      expect(plan.cascadeSessions).toBe(false);
    });
  });

  describe('combined scenarios', () => {
    it('self-ref + session cascade: single-provider delete with stale session cleanup', () => {
      const plan = computeDeletePlan({
        targetProviderId: 'p-1',
        modelId: 'us.anthropic.claude-sonnet-4-6',
        targetProvider: provider({
          name: 'bedrock-main',
          model_config: { chatModel: 'us.anthropic.claude-sonnet-4-6' },
        }),
        otherEnabledProviders: [],
        roleAssignmentCount: 0,
        recentSessionCount: 3,
        force: false,
      });

      expect(plan.canDelete).toBe(true);
      expect(plan.blockers).toEqual([]);
      expect(plan.selfReferenceFields).toEqual(['model_config.chatModel']);
      expect(plan.cascadeSessions).toBe(true);
    });

    it('role-assignment block combined with self-ref — blocked without force', () => {
      const plan = computeDeletePlan({
        targetProviderId: 'p-1',
        modelId: 'us.anthropic.claude-sonnet-4-6',
        targetProvider: provider({
          model_config: { chatModel: 'us.anthropic.claude-sonnet-4-6' },
        }),
        otherEnabledProviders: [],
        roleAssignmentCount: 1,
        recentSessionCount: 0,
        force: false,
      });

      expect(plan.canDelete).toBe(false);
      expect(plan.blockers[0].kind).toBe('role_assignment');
    });
  });
});

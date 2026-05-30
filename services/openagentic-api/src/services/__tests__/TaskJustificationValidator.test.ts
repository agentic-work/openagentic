/**
 * TaskJustificationValidator unit tests — #844 (2026-05-14).
 *
 * Pure validator. Capability-agnostic gate on Task sub-agent dispatch.
 * RED→GREEN cases pinning the three substantive checks + schema shape.
 */

import { describe, it, expect } from 'vitest';
import {
  validateMultiStepJustification,
  MIN_TOOL_COUNT_FOR_TASK,
  type MultiStepJustification,
} from '../TaskJustificationValidator.js';

function valid(over: Partial<MultiStepJustification> = {}): MultiStepJustification {
  return {
    tool_count_estimate: 5,
    requires_dedicated_context: true,
    why: 'This audit requires fanning out across 12 tenants and reconciling drift',
    single_tool_alternative: null,
    ...over,
  };
}

describe('validateMultiStepJustification — #844 contract', () => {
  describe('schema shape rejections', () => {
    it('rejects null / undefined', () => {
      expect(validateMultiStepJustification(null).ok).toBe(false);
      expect(validateMultiStepJustification(undefined).ok).toBe(false);
    });

    it('rejects non-numeric tool_count_estimate', () => {
      const r = validateMultiStepJustification({ ...valid(), tool_count_estimate: 'three' as any });
      expect(r.ok).toBe(false);
      expect(r.error).toMatch(/tool_count_estimate must be a finite number/);
    });

    it('rejects non-boolean requires_dedicated_context', () => {
      const r = validateMultiStepJustification({ ...valid(), requires_dedicated_context: 'yes' as any });
      expect(r.ok).toBe(false);
      expect(r.error).toMatch(/requires_dedicated_context must be a boolean/);
    });

    it('rejects empty/short why field', () => {
      expect(validateMultiStepJustification({ ...valid(), why: '' }).ok).toBe(false);
      expect(validateMultiStepJustification({ ...valid(), why: 'short' }).ok).toBe(false);
    });
  });

  describe('substantive checks', () => {
    it('rejects tool_count_estimate=1 (single-tool query)', () => {
      const r = validateMultiStepJustification(valid({ tool_count_estimate: 1 }));
      expect(r.ok).toBe(false);
      expect(r.error).toMatch(/tool_count_estimate=1 is below the 3-tool minimum/);
    });

    it('rejects tool_count_estimate=2 (still below threshold)', () => {
      const r = validateMultiStepJustification(valid({ tool_count_estimate: 2 }));
      expect(r.ok).toBe(false);
      expect(r.error).toMatch(/below the 3-tool minimum/);
    });

    it('accepts tool_count_estimate=3 exactly', () => {
      const r = validateMultiStepJustification(valid({ tool_count_estimate: 3 }));
      expect(r.ok).toBe(true);
    });

    it('rejects requires_dedicated_context=false', () => {
      const r = validateMultiStepJustification(valid({ requires_dedicated_context: false }));
      expect(r.ok).toBe(false);
      expect(r.error).toMatch(/requires_dedicated_context=false/);
    });

    it('rejects when model names a single_tool_alternative', () => {
      const r = validateMultiStepJustification(
        valid({ single_tool_alternative: 'azure_list_subscriptions' }),
      );
      expect(r.ok).toBe(false);
      expect(r.error).toMatch(/azure_list_subscriptions/);
      expect(r.directToolHint).toBe('azure_list_subscriptions');
    });

    it('treats empty-string single_tool_alternative as null (accept)', () => {
      const r = validateMultiStepJustification(valid({ single_tool_alternative: '' }));
      expect(r.ok).toBe(true);
    });

    it('treats whitespace-only single_tool_alternative as null (accept)', () => {
      const r = validateMultiStepJustification(valid({ single_tool_alternative: '   ' }));
      expect(r.ok).toBe(true);
    });
  });

  describe('happy path', () => {
    it('accepts a genuine multi-step audit justification', () => {
      const r = validateMultiStepJustification(valid());
      expect(r.ok).toBe(true);
      expect(r.error).toBeUndefined();
    });

    it('accepts when tool_count_estimate is well above threshold (e.g. 47-service migration)', () => {
      const r = validateMultiStepJustification(
        valid({
          tool_count_estimate: 47,
          why: 'Fan out across 47 microservices to enumerate their k8s manifests and dependencies',
        }),
      );
      expect(r.ok).toBe(true);
    });
  });

  describe('MIN_TOOL_COUNT_FOR_TASK exported constant', () => {
    it('is 3 — the canonical minimum for a justified sub-agent dispatch', () => {
      expect(MIN_TOOL_COUNT_FOR_TASK).toBe(3);
    });
  });
});

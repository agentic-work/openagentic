/**
 * PromptClassifier — cost-audit task type detection (2026-05-17).
 *
 * Why this exists:
 *   The user wants tri-cloud cost-spike / finops audit prompts to escalate
 *   to T3 frontier-grade models (FCA >= 0.93). The existing
 *   `cost-analysis-agentic` task type sits at FCA 0.90 (T2). Tri-cloud
 *   spend reconciliation deserves the higher-tier floor — these prompts
 *   pull bill JSON from 3 clouds, dispatch a sub-agent, then compose
 *   a sankey + savings_grid across multiple turns. Floor must clear T2.
 *
 * Detection contract:
 *   - cost/spend/billing/invoice/finops noun + multi-cloud OR
 *   - cost noun + spike/audit/breakdown/top-N/MoM shape + multi-cloud
 *   - includes "tri-cloud" / "cross-cloud" cost asks
 *
 * NOT cost-audit:
 *   - "what is the cost of an m5.large?" (info question, no analysis shape)
 *   - "show me my bill" (single-system read)
 *   - "audit my AWS buckets" (security audit, no cost noun)
 *
 * RED -> GREEN: the cost-audit TaskType + its FCA-0.93 CapabilityProfile.
 */
import { describe, it, expect } from 'vitest';
import {
  classifyTaskType,
  getCapabilityProfile,
  type TaskType,
} from '../PromptClassifier.js';

describe('PromptClassifier — cost-audit detection', () => {
  it('Q7 "tri-cloud cost spikes" routes to cost-audit (not generic multi-cloud)', () => {
    const prompt =
      'Our cloud bill is up 40% MoM. Find the top 10 cost spikes across Azure/AWS/GCP and tell me what to cut.';
    expect(classifyTaskType(prompt)).toBe<TaskType>('cost-audit');
  });

  it('"reconcile cross-cloud spend" routes to cost-audit', () => {
    const prompt =
      'Reconcile our cross-cloud spend across Azure, AWS, and GCP for last quarter.';
    expect(classifyTaskType(prompt)).toBe<TaskType>('cost-audit');
  });

  it('"finops audit" multi-cloud routes to cost-audit', () => {
    const prompt =
      'Run a finops audit across Azure and AWS — where can we cut spend?';
    expect(classifyTaskType(prompt)).toBe<TaskType>('cost-audit');
  });

  it('"billing breakdown by service" multi-cloud routes to cost-audit', () => {
    const prompt =
      'Break down the billing spike by service across our Azure and AWS accounts.';
    expect(classifyTaskType(prompt)).toBe<TaskType>('cost-audit');
  });

  it('"what is the cost of an m5.large?" is NOT cost-audit (info question)', () => {
    expect(classifyTaskType('What is the cost of an m5.large?')).not.toBe<TaskType>(
      'cost-audit',
    );
  });

  it('"show me my Azure bill" is NOT cost-audit (single-cloud read)', () => {
    // Single cloud + plain read verb -> single-system-read territory.
    expect(classifyTaskType('Show me my Azure bill')).not.toBe<TaskType>('cost-audit');
  });

  it('"audit my AWS buckets for public exposure" is NOT cost-audit (security)', () => {
    expect(
      classifyTaskType('Audit my AWS buckets for public exposure.'),
    ).not.toBe<TaskType>('cost-audit');
  });

  it('cost-audit capability profile flags high reasoning preference', () => {
    const profile = getCapabilityProfile('cost-audit');
    // FCA + context floors moved to RouterTuning DB (#1049,
    // 2026-05-22). Default tuning has fcaT3Floor=0.93 +
    // capabilityContextFloors['cost-audit']=100_000; coverage for the
    // floors themselves lives at
    // src/services/model-routing/__tests__/SmartModelRouter.t3-capability-gate.test.ts.
    expect(profile.taskType).toBe<TaskType>('cost-audit');
    expect(profile.requiresReasoning).toBe('high');
  });
});

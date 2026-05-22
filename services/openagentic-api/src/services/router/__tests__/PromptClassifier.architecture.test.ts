/**
 * Sev-0 #796 — PromptClassifier must detect architecture-design prompts
 * (datacenter consolidation, monorepo refactor, multi-year migration plans)
 * and apply a frontier-grade FCA floor so Auto-Routing does NOT fall back to
 * gpt-oss:20b for prompts that empirically need Sonnet/GPT-5-class reasoning.
 *
 * Live regression captured during Q-loop verify (2026-05-13):
 *   - Q6 (3-yr datacenter consolidation, 1200 VMs, capex/opex, ReactFlow + synth)
 *     → routed to gpt-oss:20b → tool calls emitted as text JSON literal → no
 *     execution → "Model finished without producing an answer" banner.
 *   - Q7 (TS5 monorepo refactor, 40 packages, 1.2M LOC, build/CI/typecheck
 *     deltas, ROI, 8-phase plan) → same routing miss + same emit-as-text bug.
 *
 * Existing TaskTypes (multi-cloud-agentic / multi-system-agentic /
 * cost-analysis-agentic / security-audit-agentic / file-read /
 * single-system-read / pure-chat) have ZERO detection for these shapes,
 * so the classifier returns 'pure-chat' and the router stays in
 * chat-pool FCA-floor territory where gpt-oss:20b (FCA 0.87) wins on cost.
 *
 * Fix: add 'architecture-design-agentic' TaskType with FCA 0.90 floor (same
 * as other -agentic profiles), detected by the co-occurrence of an
 * architectural noun + a plan/phase verb + a length signal. Single-signal
 * matches must NOT trigger (otherwise "should i refactor?" routes to
 * Sonnet, which is the previously-banned over-escalation).
 */
import { describe, it, expect } from 'vitest';
import {
  classifyTaskType,
  getCapabilityProfile,
  type TaskType,
} from '../PromptClassifier.js';

describe('PromptClassifier — #796 architecture-design-agentic', () => {
  describe('POSITIVE — must classify as architecture-design-agentic', () => {
    it('Q6 datacenter consolidation prompt', () => {
      const prompt =
        'You are an enterprise architect. Plan a 3-year datacenter consolidation: rip 5 physical colo DCs (300 racks, ~$8M/yr) → cloud + 1 retained on-prem (50 racks). Workloads: 1200 VMs, 400 apps, 80 DBs, ~120 TB. ONE response, three required outputs: (1) ONE compose_visual stacked bar chart showing per-year migration counts (Year1/Year2/Year3 × {Lift+Shift, Re-platform, Re-architect, Retire}). (2) synth call computing total capex savings, payback, risk per cohort. (3) Inline summary: business case, milestones, risk register.';
      expect(classifyTaskType(prompt)).toBe<TaskType>('architecture-design-agentic');
    });

    it('Q7 TS5 monorepo refactor prompt', () => {
      const prompt =
        'Plan a TypeScript 5.x monorepo refactor for a fintech with 40 packages, 1.2M LOC, current build time 35 min, CI 18 min, type-check 9 min. Target <8 min build via Turborepo + project references + tsbuild watch + Nx-style affected-only. Required outputs ONE response: bar chart contrasting current vs target metrics across 6 dimensions. synth call computing migration_savings_per_quarter, engineering_hours_reclaimed, risk-weighted ROI. 8-phase migration plan with TS-config diffs and 5 anti-patterns to avoid.';
      expect(classifyTaskType(prompt)).toBe<TaskType>('architecture-design-agentic');
    });

    it('multi-year cloud migration plan with phases', () => {
      const prompt =
        'Design a 2-year migration roadmap for our SaaS platform: lift-and-shift 60% of workloads to AWS in Year 1, re-architect remaining 40% to serverless in Year 2. Provide phased timeline, dependency graph, executive summary, and ROI estimate.';
      expect(classifyTaskType(prompt)).toBe<TaskType>('architecture-design-agentic');
    });

    it('platform re-architecture with executive summary', () => {
      const prompt =
        'We need to re-architect our monolithic .NET platform to microservices. Plan the phases, identify the bounded contexts, give me a 12-month roadmap with quarterly milestones and risk register. End with an executive summary for the board.';
      expect(classifyTaskType(prompt)).toBe<TaskType>('architecture-design-agentic');
    });

    it('Kubernetes platform consolidation with capex/opex', () => {
      const prompt =
        'Consolidation plan: 8 Kubernetes clusters → 3 multi-tenant platform clusters. Compute capex savings, opex delta, deprecation timeline. Multi-phase rollout. Include risk matrix and rollback plan.';
      expect(classifyTaskType(prompt)).toBe<TaskType>('architecture-design-agentic');
    });
  });

  describe('NEGATIVE — must NOT trigger architecture-design-agentic', () => {
    it('short "should i refactor" stays pure-chat', () => {
      expect(classifyTaskType('should i refactor this function?')).toBe<TaskType>('pure-chat');
    });

    it('single-word "migration?" stays pure-chat', () => {
      expect(classifyTaskType('migration?')).toBe<TaskType>('pure-chat');
    });

    it('single-cloud read still wins over architecture trigger', () => {
      // Mentions "plan" but the dominant shape is a single-cloud read.
      const prompt = 'show me my aws ec2 instances. I might use this for capacity planning.';
      const result = classifyTaskType(prompt);
      expect(result).not.toBe<TaskType>('architecture-design-agentic');
    });

    it('short architecture word alone does NOT escalate', () => {
      expect(classifyTaskType('what is microservice architecture?')).toBe<TaskType>('pure-chat');
    });
  });

  describe('capability profile — frontier FCA floor', () => {
    it('architecture-design-agentic profile requires FCA ≥ 0.90 (gates gpt-oss:20b @ 0.87)', () => {
      const profile = getCapabilityProfile('architecture-design-agentic');
      expect(profile.requiresToolUseReliability).toBeGreaterThanOrEqual(0.90);
      expect(profile.requiresReasoning).toBe('high');
      // Long-form output needs context headroom (charts + synth + 8-phase
      // plan + risk register + executive summary).
      expect(profile.requiresContextTokens).toBeGreaterThanOrEqual(30_000);
    });
  });
});

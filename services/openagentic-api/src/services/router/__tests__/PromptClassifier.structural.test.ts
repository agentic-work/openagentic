/**
 * PromptClassifier — STRUCTURAL classification (Q1-fix-12, 2026-05-13).
 *
 * Rips the lexical noun-list approach (looksLikeArchitectureDesign /
 * looksLikeCrossSystemFanOut / looksLikeCostAnalysis / looksLikeSecurityAudit
 * / looksLikeFileRead / looksLikeSingleSystemRead) and replaces it with a
 * complexity-score over STRUCTURAL signals: prompt length, numbered-list
 * count, parallel-intent phrases, synthesis verbs, compose-frame asks, and
 * cloud-presence count.
 *
 * Why: every Q-loop probe surfaces new vocabulary that the noun-list regex
 * doesn't enumerate. A 600-char k8s/terraform/postgres/redis/any-tech audit
 * prompt with 5 numbered compose_app asks must route to
 * `architecture-design-agentic` regardless of WHAT tech it mentions. The
 * structural shape — long, numbered, multi-frame, synthesis-verb — is the
 * real signal, not the domain noun.
 *
 * These tests are RED against the current lexical-noun-list implementation.
 * They go GREEN once `classifyTaskType` is rewritten to score over
 * structural signals.
 *
 * Constraints (per CLAUDE.md):
 *   - NO model literal assertions (we assert TaskType, not model id)
 *   - NO domain noun lists in the assertions themselves (asserting
 *     TaskType for a k8s prompt is fine; the classifier mustn't enumerate
 *     "kubernetes" as a trigger)
 */
import { describe, it, expect } from 'vitest';
import { classifyTaskType, type TaskType } from '../PromptClassifier.js';

describe('PromptClassifier — structural classification (Q1-fix-12)', () => {
  describe('long, numbered, multi-frame asks classify as architecture-design-agentic regardless of tech stack', () => {
    it('k8s namespace audit (500+ chars, 5 numbered items, parallel-call frame asks)', () => {
      const prompt =
        'Audit our production Kubernetes namespaces across every cluster. Parallel-call kubectl tools to enumerate workloads. Required deliverables in ONE response: (1) compose_app KPI grid showing pod count, restart count, memory pressure, and OOM events per namespace. (2) compose_visual sankey of traffic flow between namespaces and external endpoints. (3) compose_app runbook with remediation steps for the top 5 noisy namespaces. (4) compose_visual topology diagram of inter-namespace service dependencies. (5) Inline executive summary: risk register + which workloads to right-size + estimated savings.';
      expect(prompt.length).toBeGreaterThanOrEqual(500);
      expect(classifyTaskType(prompt)).toBe<TaskType>('architecture-design-agentic');
    });

    it('AWS multi-account cost rollup (450+ chars, 4 numbered items, parallel-intent)', () => {
      const prompt =
        'Enumerate every account in our AWS organization in parallel and roll up the last 90 days of spend. Required outputs in ONE response: (1) compose_visual sankey of cost flow from payer → linked accounts → services. (2) compose_app KPI grid with MoM delta, top-3 spike drivers, and forecast for next quarter. (3) compose_app savings_grid with reserved-instance candidates, right-sizing recommendations, and idle-resource cleanup. (4) Inline runbook for the remediation steps with risk + ownership.';
      expect(prompt.length).toBeGreaterThanOrEqual(450);
      expect(classifyTaskType(prompt)).toBe<TaskType>('architecture-design-agentic');
    });

    it('GCP project inventory audit (400+ chars, numbered, multi-cloud-mentioning)', () => {
      const prompt =
        'Audit every GCP project across our org and cross-reference with our Azure tenant. Required outputs in ONE response: (1) compose_visual topology diagram of cross-cloud service dependencies. (2) compose_app KPI grid: project count, active services per project, billing exposure per project. (3) compose_app runbook to consolidate redundant projects and migrate orphaned workloads. (4) Inline summary with consolidation roadmap and architecture review across both clouds.';
      expect(prompt.length).toBeGreaterThanOrEqual(400);
      expect(classifyTaskType(prompt)).toBe<TaskType>('architecture-design-agentic');
    });

    it('Terraform drift survey (450+ chars, numbered, "across all stacks", diagram asks)', () => {
      // This test proves the classifier works on tech terms NOT in any
      // allowlist — "terraform" / "drift" / "stacks" aren't cloud names
      // and aren't in any lexical noun list. The structural shape carries
      // the routing decision.
      const prompt =
        'Survey our Terraform state across all stacks and producible drift between declared and observed infrastructure. Parallel-call the state-inspection tools per stack. Required outputs in ONE response: (1) compose_visual diagram of stack dependency graph with drift annotations. (2) compose_app KPI grid: drift count per stack, blast radius per drift, mean time to remediate. (3) compose_app runbook with terraform apply / import / move steps for each drift. (4) Inline architecture summary.';
      expect(prompt.length).toBeGreaterThanOrEqual(450);
      expect(classifyTaskType(prompt)).toBe<TaskType>('architecture-design-agentic');
    });

    it('Datacenter consolidation plan (existing Q6 prompt still classifies correctly)', () => {
      // Pinned by existing PromptClassifier.architecture.test.ts. Make sure
      // the structural rewrite doesn't regress this case.
      const prompt =
        'You are an enterprise architect. Plan a 3-year datacenter consolidation: rip 5 physical colo DCs (300 racks, ~$8M/yr) → cloud + 1 retained on-prem (50 racks). Workloads: 1200 VMs, 400 apps, 80 DBs, ~120 TB. ONE response, three required outputs: (1) ONE compose_visual stacked bar chart showing per-year migration counts (Year1/Year2/Year3 × {Lift+Shift, Re-platform, Re-architect, Retire}). (2) synth call computing total capex savings, payback, risk per cohort. (3) Inline summary: business case, milestones, risk register.';
      expect(prompt.length).toBeGreaterThanOrEqual(500);
      expect(classifyTaskType(prompt)).toBe<TaskType>('architecture-design-agentic');
    });
  });

  describe('short single-system reads stay cheap', () => {
    it('"show me my Azure subscriptions" → single-system-read', () => {
      expect(classifyTaskType('show me my azure subscriptions')).toBe<TaskType>('single-system-read');
    });
  });

  describe('greetings stay pure-chat', () => {
    it('"Hi" → pure-chat', () => {
      expect(classifyTaskType('Hi')).toBe<TaskType>('pure-chat');
    });
  });

  describe('file-read still detects path-shaped requests via structural path-shape check', () => {
    it('"show me src/foo.ts" → file-read', () => {
      expect(classifyTaskType('show me src/foo.ts')).toBe<TaskType>('file-read');
    });
  });
});

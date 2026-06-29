/**
 * Sub-agent dispatch intent — PromptClassifier extension (T1 follow-up).
 *
 * Why this test file exists:
 *   The T1 verify matrix on 0.7.1-52320805 found the Task meta-tool broken
 *   end-to-end. Two probes that explicitly say "dispatch a sub-agent" /
 *   "Use the Task tool" both failed: one returned the canned "invalid tool
 *   call" text, the other groped via tool_search/agent_search and leaked
 *   JSON args into assistant prose. Root cause: SmartModelRouter sends
 *   those turns to gpt-oss:20b (low cost-tier default), and per #843 the
 *   Task tool is capability-gated — hidden from models that fail
 *   modelTaskGate. The model knows it should dispatch but physically can't.
 *
 * Fix shape:
 *   PromptClassifier learns a new `sub_agent_dispatch` task type that
 *   detects explicit sub-agent / Task / delegate prompts. The CapabilityProfile
 *   for that type demands Task-capable models — SmartModelRouter then
 *   filters candidates by modelTaskGate before scoring.
 *
 * Test scope here (classifier-only):
 *   Assert classifyTaskType() returns 'sub_agent_dispatch' for explicit
 *   dispatch prompts AND does NOT return it for negative cases (e.g.
 *   "what sub-agents are available?" — that's a question about catalog,
 *   not a dispatch). Routing-side assertions live in
 *   SmartModelRouter.subAgentEscalation.test.ts.
 *
 * RED→GREEN per case. No LLM dependency — the classifier is structural.
 */
import { describe, it, expect } from 'vitest';
import {
  classifyTaskType,
  getCapabilityProfile,
  type TaskType,
} from '../router/PromptClassifier.js';

describe('PromptClassifier — sub_agent_dispatch detection', () => {
  it('"Spawn a cloud_operations sub-agent to audit RBAC" → sub_agent_dispatch', () => {
    const prompt = 'Spawn a cloud_operations sub-agent to audit RBAC.';
    expect(classifyTaskType(prompt)).toBe<TaskType>('sub_agent_dispatch');
  });

  it('"Use the Task tool to dispatch a security audit agent" → sub_agent_dispatch', () => {
    const prompt = 'Use the Task tool to dispatch a security audit agent.';
    expect(classifyTaskType(prompt)).toBe<TaskType>('sub_agent_dispatch');
  });

  it('"Have a sub-agent run the EKS upgrade dry-run for me" → sub_agent_dispatch', () => {
    const prompt = 'Have a sub-agent run the EKS upgrade dry-run for me.';
    expect(classifyTaskType(prompt)).toBe<TaskType>('sub_agent_dispatch');
  });

  it('"delegate this to a research agent" → sub_agent_dispatch', () => {
    const prompt = 'delegate this to a research agent';
    expect(classifyTaskType(prompt)).toBe<TaskType>('sub_agent_dispatch');
  });

  it('"dispatch a sub agent to triage incident-42" → sub_agent_dispatch', () => {
    const prompt = 'dispatch a sub agent to triage incident-42';
    expect(classifyTaskType(prompt)).toBe<TaskType>('sub_agent_dispatch');
  });

  it('"What sub-agents are available?" is NOT a dispatch (catalog question)', () => {
    // This is a catalog read, not a dispatch request. Must not route through
    // the high-cost Task-capable floor.
    expect(classifyTaskType('What sub-agents are available?')).not.toBe<TaskType>(
      'sub_agent_dispatch',
    );
  });

  it('"What is the weather in Paris?" is NOT sub_agent_dispatch', () => {
    expect(classifyTaskType('What is the weather in Paris?')).not.toBe<TaskType>(
      'sub_agent_dispatch',
    );
  });

  it('"Show me my Azure subscriptions" is NOT sub_agent_dispatch (single-system-read)', () => {
    expect(classifyTaskType('Show me my Azure subscriptions')).not.toBe<TaskType>(
      'sub_agent_dispatch',
    );
  });

  it('sub_agent_dispatch capability profile demands Task-capable FCA floor', () => {
    const profile = getCapabilityProfile('sub_agent_dispatch');
    // Sub-agent dispatch requires frontier tool-use reliability — gpt-oss
    // (FCA 0.87) must be filtered out before scoring.
    expect(profile.requiresToolUseReliability).toBeGreaterThanOrEqual(0.90);
    expect(profile.requiresReasoning).toBe('high');
    // Sub-agent loops chew context — demand at least 64k headroom (also the
    // modelTaskGate context floor; keeps the two gates aligned).
    expect(profile.requiresContextTokens).toBeGreaterThanOrEqual(64_000);
  });
});

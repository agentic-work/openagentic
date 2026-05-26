/**
 * 10x repeat stability — every parity category runs 10 times with varied
 * prompts + tool arguments to prove the harness is stable across runs
 * and the diff result doesn't flap.
 *
 * User directive (2026-04-22): "10x with the agent". The agent here is
 * the scripted provider driving both emitters — repeatability is the
 * point. If any category ever flaps across 10 runs, the harness itself
 * has hidden non-determinism we need to fix before claiming parity.
 *
 * Prompts + tool inputs are generated from a deterministic seed per run
 * so 10x is reproducible. Random values cycle through a known sequence
 * so failures tell you exactly which sub-prompt triggered the flap.
 */

import { describe, test, expect } from 'vitest';
import { runParity, type ParityScenario } from './parity-harness.js';

// A tiny seeded PRNG so the 10 runs are deterministic. Mulberry32 —
// 4 lines, plenty of period for a 10-iteration loop.
function mulberry32(seed: number): () => number {
  let a = seed;
  return () => {
    a |= 0;
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

const RUN_COUNT = 10;

describe('10x parity stability', () => {
  test('tools parity is stable across 10 runs with varying prompts', () => {
    const rng = mulberry32(42);
    const tools = ['k8s_get_pods', 'docs_search', 'azure_resource_graph_query'];

    for (let i = 0; i < RUN_COUNT; i++) {
      const tool = tools[Math.floor(rng() * tools.length)];
      const ns = `ns-${Math.floor(rng() * 1000)}`;
      const scenario: ParityScenario = {
        name: `run-${i}-${tool}`,
        userPrompt: `Run ${tool} in ${ns} (iteration ${i})`,
        availableTools: [tool],
        script: [
          { kind: 'tool_call', toolName: tool, input: { ns }, toolId: `id-${i}` },
          {
            kind: 'tool_result',
            toolName: tool,
            result: { count: i, ns },
            toolId: `id-${i}`,
          },
          { kind: 'assistant_text', text: `Iteration ${i} done.` },
        ],
      };
      const run = runParity(scenario);
      expect(run.diff.ok, `run ${i} (${tool}) should parity-match`).toBe(true);
    }
  });

  test('subagent parity is stable across 10 runs (#297 closed)', () => {
    const rng = mulberry32(7);
    for (let i = 0; i < RUN_COUNT; i++) {
      const agent = `agent-${Math.floor(rng() * 100)}`;
      const scenario: ParityScenario = {
        name: `run-${i}-subagent`,
        userPrompt: `Delegate iteration ${i} to ${agent}`,
        script: [
          { kind: 'subagent_spawn', agentName: agent, prompt: `task ${i}` },
          { kind: 'subagent_result', agentName: agent, result: { done: i } },
        ],
      };
      const run = runParity(scenario);
      const subagentDivergences = run.diff.divergences.filter(d => {
        const k = d.chat?.kind ?? d.codemode?.kind;
        return k === 'subagent_spawn' || k === 'subagent_result';
      });
      expect(
        subagentDivergences,
        `run ${i} must show no subagent_* divergences`,
      ).toHaveLength(0);
    }
  });

  test('skills parity is stable across 10 runs (#298 closed)', () => {
    const rng = mulberry32(1337);
    const skills = [
      'superpowers:brainstorming',
      'synth',
      'update-config',
      'frontend-design:frontend-design',
    ];
    for (let i = 0; i < RUN_COUNT; i++) {
      const skill = skills[Math.floor(rng() * skills.length)];
      const scenario: ParityScenario = {
        name: `run-${i}-${skill}`,
        userPrompt: `Use ${skill}`,
        script: [{ kind: 'skill_activation', skillName: skill, prompt: `apply ${i}` }],
      };
      const run = runParity(scenario);
      const skillDivergences = run.diff.divergences.filter(
        d => d.chat?.kind === 'skill_activation' || d.codemode?.kind === 'skill_activation',
      );
      expect(
        skillDivergences,
        `run ${i} must show no skill_activation divergence`,
      ).toHaveLength(0);
    }
  });

  test('plugins parity is stable across 10 runs (#299 closed)', () => {
    const rng = mulberry32(9999);
    const plugins = ['playwright', 'figma', 'gmail', 'google-drive'];
    for (let i = 0; i < RUN_COUNT; i++) {
      const plugin = `claude-plugins-official:${plugins[Math.floor(rng() * plugins.length)]}`;
      const scenario: ParityScenario = {
        name: `run-${i}-${plugin}`,
        userPrompt: `Load ${plugin}`,
        script: [{ kind: 'plugin_load', pluginName: plugin }],
      };
      const run = runParity(scenario);
      const pluginDivergences = run.diff.divergences.filter(
        d => d.chat?.kind === 'plugin_load' || d.codemode?.kind === 'plugin_load',
      );
      expect(
        pluginDivergences,
        `run ${i} must show no plugin_load divergence`,
      ).toHaveLength(0);
    }
  });

  test('artifacts gap is stable across 10 runs across all three artifact types', () => {
    const types = ['markdown', 'mermaid', 'code'] as const;
    for (let i = 0; i < RUN_COUNT; i++) {
      const kind = types[i % types.length];
      const scenario: ParityScenario = {
        name: `run-${i}-${kind}`,
        userPrompt: `Produce ${kind} artifact`,
        script: [{ kind: 'artifact', artifactType: kind, content: `content-${i}` }],
      };
      const run = runParity(scenario);
      expect(run.diff.ok, `run ${i} (${kind}) must consistently flag the artifact gap`).toBe(false);
      const gapKinds = run.diff.divergences.map(d => d.chat?.kind);
      expect(gapKinds).toContain('artifact');
    }
  });

  test('harness is stable — running the same scenario 10 times yields identical diff counts', () => {
    const scenario: ParityScenario = {
      name: 'stability',
      userPrompt: 'fixed',
      script: [
        { kind: 'tool_call', toolName: 'k8s_get_pods', input: { ns: 'x' } },
        { kind: 'tool_result', toolName: 'k8s_get_pods', result: 'r' },
      ],
    };
    const divergenceCounts = new Set<number>();
    for (let i = 0; i < RUN_COUNT; i++) {
      const run = runParity(scenario);
      divergenceCounts.add(run.diff.divergences.length);
    }
    // All 10 runs should produce identical divergence counts — if the set has
    // more than one element, the harness has nondeterminism we need to fix.
    expect(divergenceCounts.size).toBe(1);
  });
});

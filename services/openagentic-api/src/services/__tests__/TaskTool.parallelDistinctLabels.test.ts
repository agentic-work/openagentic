/**
 * #1110 — Task tool must guide the model to emit DISTINCT descriptions
 * per parallel Task call. Live evidence (2026-05-25 #1095 redrive on
 * 0.7.1-1ed5fe23): 3-cloud fanout produced 3 sub-agent cards all titled
 * "GCP IAM drift audit" — the model picked the last named example from
 * the prompt and reused it for all 3 Task blocks.
 *
 * Fix: tighten `description` field guidance to be explicit about
 * per-call uniqueness in parallel batches + add input_examples showing
 * 3 distinct Azure/AWS/GCP labels. Examples now reach the wire via
 * AWSBedrockProvider's description inlining (#1112).
 */
import { describe, it, expect } from 'vitest';
import { TASK_TOOL } from '../TaskTool.js';

describe('#1110 — TaskTool parallel distinct labels', () => {
  it('description field guidance names #1110 + warns against repeating labels', () => {
    const desc = (TASK_TOOL.function.parameters.properties as any).description.description as string;
    expect(desc).toContain('#1110');
    expect(desc).toContain('DISTINCT');
    expect(desc.toLowerCase()).toContain('parallel');
    // The warning verbatim names the failure mode
    expect(desc).toContain('NEVER repeat the same description');
  });

  it('description field guidance shows the 3 cloud labels as exemplars', () => {
    const desc = (TASK_TOOL.function.parameters.properties as any).description.description as string;
    expect(desc).toContain('Azure IAM audit');
    expect(desc).toContain('AWS IAM audit');
    expect(desc).toContain('GCP IAM audit');
  });

  it('input_examples shows 3 parallel Task patterns with distinct descriptions', () => {
    const examples = (TASK_TOOL.function as any).input_examples;
    expect(Array.isArray(examples)).toBe(true);
    expect(examples.length).toBeGreaterThanOrEqual(3);
    const labels = examples.map((e: any) => e.description);
    // Exactly the canonical 3 — same as the in-prompt field hint
    expect(labels).toContain('Azure IAM audit');
    expect(labels).toContain('AWS IAM audit');
    expect(labels).toContain('GCP IAM audit');
    // All distinct (no dupes)
    expect(new Set(labels).size).toBe(labels.length);
  });

  it('each input_example carries a valid multi_step_justification (≥3 tool_count_estimate)', () => {
    const examples = (TASK_TOOL.function as any).input_examples;
    for (const ex of examples) {
      expect(ex.multi_step_justification).toBeDefined();
      expect(ex.multi_step_justification.tool_count_estimate).toBeGreaterThanOrEqual(3);
      expect(typeof ex.multi_step_justification.requires_dedicated_context).toBe('boolean');
      expect(typeof ex.multi_step_justification.why).toBe('string');
      expect(ex.multi_step_justification.why.length).toBeGreaterThan(10);
      expect(typeof ex.multi_step_justification.single_tool_alternative).toBe('string');
    }
  });

  it('each input_example carries a non-empty prompt and the cloud_operations subagent_type', () => {
    const examples = (TASK_TOOL.function as any).input_examples;
    for (const ex of examples) {
      expect(typeof ex.prompt).toBe('string');
      expect(ex.prompt.length).toBeGreaterThan(30);
      expect(ex.subagent_type).toBe('cloud_operations');
    }
  });
});

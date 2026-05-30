/**
 * Architecture gate: chatmode system prompts + synth tool description
 * must keep the "real-data tools beat synth" bias intact.
 *
 * Round 18 regression (2026-05-12): tool_search ranked
 * `openagentic_aws.aws_cost_by_service` at 0.876 but the model still picked
 * `synth` and hallucinated AWS cost data, because the system prompt
 * treated synth and cloud tools equivalently AND the synth tool
 * description was vague ("any data task") which the model treated
 * as covering cloud fetches.
 *
 * Two layered defenses, gated here:
 *   1. chat-system-{admin,member}.md contain an explicit "real-data
 *      tools beat synth" rule that mentions the cloud-tool prefixes.
 *   2. SynthTool.ts DESCRIPTION explicitly narrows synth to
 *      transform/aggregate work and steers retrieval to typed tools.
 */

import { describe, it, expect } from 'vitest';
import { readFileSync, existsSync } from 'fs';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
const SVC_ROOT = join(__dirname, '../..');
const ADMIN_PROMPT = join(SVC_ROOT, '../prompts/chat-system-admin.md');
const MEMBER_PROMPT = join(SVC_ROOT, '../prompts/chat-system-member.md');
const SYNTH_TOOL = join(SVC_ROOT, 'services/SynthTool.ts');

describe('Architecture: real-data tools beat synth (B5 round 18 regression)', () => {
  it('admin + member prompt files exist on disk', () => {
    expect(existsSync(ADMIN_PROMPT)).toBe(true);
    expect(existsSync(MEMBER_PROMPT)).toBe(true);
  });

  it('SynthTool.ts source exists', () => {
    expect(existsSync(SYNTH_TOOL)).toBe(true);
  });

  for (const [role, path] of [['admin', ADMIN_PROMPT], ['member', MEMBER_PROMPT]] as const) {
    describe(`chat-system-${role}.md`, () => {
      const body = readFileSync(path, 'utf8');

      it('contains the explicit "real-data tools beat synth" contract anchor', () => {
        expect(body.toLowerCase()).toContain('real-data tools beat synth');
      });

      it('names every cloud-tool prefix the rule covers', () => {
        for (const prefix of ['openagentic_', 'aws_', 'azure_', 'gcp_', 'k8s_']) {
          expect(body, `${role} prompt missing prefix ${prefix}`).toContain(prefix);
        }
      });

      it('tells the model synth is for transform, not fetch', () => {
        // Either the word transform / aggregate / derive must appear,
        // AND the prompt must call out that synth is NOT for fetching.
        expect(body.toLowerCase()).toMatch(/transform|aggregate|derive/);
        expect(body.toLowerCase()).toMatch(/not for .*fetch|never call .*synth|leads to fabricated/);
      });
    });
  }

  describe('SynthTool.ts DESCRIPTION', () => {
    const src = readFileSync(SYNTH_TOOL, 'utf8');

    it('narrows synth to transform / aggregate / compute on existing data', () => {
      expect(src).toMatch(/TRANSFORM|AGGREGATE|COMPUTE/);
      expect(src.toLowerCase()).toMatch(/already in the conversation|already retrieved/);
    });

    it('explicitly steers cloud fetches to typed tools', () => {
      // The description must call out that synth is NOT the right
      // tool for cloud retrieval, and must reference at least one of
      // the cloud-tool prefix groups by name.
      expect(src.toLowerCase()).toMatch(/do not call synth to retrieve|not for .*fetch|fabricated/);
      // At least one of the canonical typed-tool prefixes
      expect(src).toMatch(/openagentic_aws|openagentic_azure|openagentic_gcp|aws_\*|azure_\*|gcp_\*/);
    });

    it('still preserves the OBO + capability declaration discipline', () => {
      // Regression guard: while sharpening synth, we must not lose
      // the OBO note or the capabilities-array discipline that
      // existing dispatch code relies on the model to understand.
      expect(src).toMatch(/On-Behalf-Of|OBO/);
      expect(src.toLowerCase()).toContain('capability');
    });
  });
});

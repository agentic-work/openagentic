/**
 * Skills Parity — chat ↔ codemode for skill activation.
 *
 * Chat pipeline: when the model wants to activate a skill (e.g.
 * `superpowers:brainstorming`, `synth`, `update-config`), it emits a
 * `skill_invoked` NDJSON frame carrying the skill name + skill payload.
 *
 * Codemode pipeline: openagentic's `print.ts` registers a
 * boundary-event handler when `--output-format stream-json` is set
 * (cli/print.ts:668). `SkillTool.call()` and the experimental remote
 * skill path both fire `emitSkillInvoked()` (boundaryEvents.ts:171),
 * which the handler relays as `{ type:'system', subtype:'skill_invoked',
 * data:{ skillId, version?, rule? } }`. The codemode UI's
 * `streamReducer.ts` already consumes that envelope to render a
 * `BoundaryPart` of subtype `'skill'` (#298 closed 2026-05-07).
 *
 * Covered skills (representative sample from the available-skills list):
 *   - superpowers:brainstorming
 *   - superpowers:test-driven-development
 *   - superpowers:verification-before-completion
 *   - synth
 *   - update-config
 *   - frontend-design:frontend-design
 */

import { describe, test, expect } from 'vitest';
import { runParity, type ParityScenario } from './parity-harness.js';

const REPRESENTATIVE_SKILLS = [
  'superpowers:brainstorming',
  'superpowers:test-driven-development',
  'superpowers:verification-before-completion',
  'synth',
  'update-config',
  'frontend-design:frontend-design',
];

describe('Skills parity — chat ↔ codemode', () => {
  for (const skill of REPRESENTATIVE_SKILLS) {
    test(`${skill}: chat AND codemode both emit skill_invoked (parity)`, () => {
      const scenario: ParityScenario = {
        name: `skill-${skill}`,
        userPrompt: `Please use ${skill} to help me.`,
        script: [
          { kind: 'skill_activation', skillName: skill, prompt: 'apply this skill' },
          { kind: 'assistant_text', text: `Using ${skill}...` },
        ],
      };

      const run = runParity(scenario);

      // chat emits a top-level `skill_invoked` NDJSON frame
      const chatSkillFrame = run.chat.parsed.find(
        f => f.type === 'skill_invoked' && (f as any).skillName === skill,
      );
      expect(chatSkillFrame).toBeTruthy();

      // codemode emits a `system/skill_invoked` envelope with the same skillId
      // (matches print.ts:668-702 wire shape)
      const codemodeSkillFrame = run.codemode.parsed.find(
        f =>
          (f as any).type === 'system' &&
          (f as any).subtype === 'skill_invoked' &&
          (f as any).data?.skillId === skill,
      );
      expect(codemodeSkillFrame).toBeTruthy();

      // No skill_activation divergence in the normalized diff anymore
      const skillDivergences = run.diff.divergences.filter(
        d => d.chat?.kind === 'skill_activation' || d.codemode?.kind === 'skill_activation',
      );
      expect(skillDivergences).toHaveLength(0);
    });
  }

  test('skill activation carries the prompt payload through both surfaces', () => {
    const scenario: ParityScenario = {
      name: 'skill-payload',
      userPrompt: 'Brainstorm features.',
      script: [
        {
          kind: 'skill_activation',
          skillName: 'superpowers:brainstorming',
          prompt: 'Generate 5 feature ideas for the chat UI.',
        },
      ],
    };
    const run = runParity(scenario);
    const chatFrame = run.chat.parsed.find(f => f.type === 'skill_invoked') as any;
    expect(chatFrame.skillName).toBe('superpowers:brainstorming');
    expect(chatFrame.prompt).toBe('Generate 5 feature ideas for the chat UI.');

    const codemodeFrame = run.codemode.parsed.find(
      f => (f as any).type === 'system' && (f as any).subtype === 'skill_invoked',
    ) as any;
    expect(codemodeFrame.data.skillId).toBe('superpowers:brainstorming');
    expect(codemodeFrame.data.prompt).toBe('Generate 5 feature ideas for the chat UI.');
  });
});

/**
 * Phase A.2 — RED test for imperative description shape on the 3 artifact
 * tools (compose_visual / compose_app / render_artifact).
 *
 * Plan ref: <internal-plan> Track A Phase A.2
 *
 * Anthropic best-practice example in tool-use docs leads with imperative
 * verbs ("Retrieves the current stock price for a given ticker
 * symbol..."). Our current artifact tools lead with refusal primers
 * ("**Use ONLY when the user explicitly requested..."). Defensive
 * descriptions lower dispatch confidence — Haiku 4.5 reads them and
 * falls back to markdown rather than dispatching the tool. This phase
 * flips the lead.
 *
 * RED contract:
 *   - First non-empty paragraph of the description MUST start with an
 *     imperative verb from a known allow-list (Render / Compose / Embed /
 *     Draw / Plot). The model-facing lead is what shapes selection
 *     confidence.
 *   - Description MUST NOT contain the literal string "**Use ONLY when"
 *     anywhere — this is the refusal primer we're ripping. Per
 *     `Phase A.4` (server-side `tool_choice` forcing) + Phase A.1
 *     (`input_examples`), the "don't over-emit" job moves out of the
 *     tool description and into structured enforcement, where it's
 *     unambiguous and not in conflict with the dispatch incentive.
 *   - Description is bounded to ≤ 8000 chars — descriptions are added to
 *     the tools-prompt at the top of every request; runaway growth eats
 *     into the model's working context.
 *
 * GREEN expectation: Phase A.2 commit which rewrites the lead paragraph
 * of all 3 tool descriptions to imperative form.
 */
import { describe, it, expect } from 'vitest';
import { COMPOSE_VISUAL_TOOL } from '../ComposeVisualTool.js';
import { COMPOSE_APP_TOOL } from '../ComposeAppTool.js';
import { RENDER_ARTIFACT_TOOL } from '../RenderArtifactTool.js';

type ToolDefn = {
  type: 'function';
  function: { name: string; description: string };
};

const IMPERATIVE_VERBS = [
  'render',
  'compose',
  'embed',
  'draw',
  'plot',
  'build',
];

function firstParagraph(desc: string): string {
  // Take everything up to the first double-newline (paragraph break) or
  // first 240 chars, whichever is shorter — this is the LEAD that shapes
  // the model's "should I pick this tool?" gut-check.
  const para = desc.split(/\n\n/)[0] ?? desc;
  return para.slice(0, 240);
}

function startsWithImperative(text: string): { ok: boolean; firstWord: string } {
  // Strip markdown bold markers and leading whitespace, take the first
  // alphabetic word.
  const cleaned = text.replace(/^\*+/, '').trimStart();
  const match = cleaned.match(/^([A-Za-z]+)/);
  const firstWord = match ? match[1].toLowerCase() : '';
  return { ok: IMPERATIVE_VERBS.includes(firstWord), firstWord };
}

describe('Phase A.2 — imperative description shape on artifact tools', () => {
  for (const [name, tool] of [
    ['compose_visual', COMPOSE_VISUAL_TOOL],
    ['compose_app', COMPOSE_APP_TOOL],
    ['render_artifact', RENDER_ARTIFACT_TOOL],
  ] as const) {
    const desc = (tool as ToolDefn).function.description;

    describe(name, () => {
      it('lead paragraph starts with an imperative verb (Render/Compose/Embed/Draw/Plot/Build)', () => {
        const lead = firstParagraph(desc);
        const result = startsWithImperative(lead);
        expect(
          result.ok,
          `${name} lead paragraph starts with "${result.firstWord}" (must be one of ${IMPERATIVE_VERBS.join(', ')}). Lead: ${JSON.stringify(lead.slice(0, 160))}`,
        ).toBe(true);
      });

      it('does NOT contain refusal primer "**Use ONLY when"', () => {
        expect(
          desc.includes('**Use ONLY when'),
          `${name} description still contains the "**Use ONLY when..." refusal primer. The dispatch-discipline job moves into Phase A.1 (input_examples) and Phase A.4 (server-side tool_choice forcing), not the tool prose.`,
        ).toBe(false);
      });

      it('description size is bounded (≤ 8000 chars)', () => {
        expect(
          desc.length,
          `${name} description is ${desc.length} chars — must be ≤ 8000 to keep the tools-prompt context-efficient.`,
        ).toBeLessThanOrEqual(8000);
      });
    });
  }
});

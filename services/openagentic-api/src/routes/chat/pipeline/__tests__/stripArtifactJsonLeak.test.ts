/**
 * Sev-0 regression: gpt-oss:20b (and occasionally other models) leak the
 * `compose_visual` / `compose_app` tool_use JSON args verbatim into the
 * assistant prose body even though the tool actually dispatched and the
 * iframe mounted correctly. The user sees raw JSON in their chat bubble.
 *
 * Class of bug: same family as #492 / #807 / #880. The legacy server-side
 * scrubber `response.stripArtifactProseTokens.ts` was deleted in the v3
 * pipeline rip — `dist/` still has the old copy but `src/` doesn't, so the
 * scrub never runs. This test pins the replacement helper.
 *
 * Live evidence (2026-05-21): user asked "Render a compose_visual chord
 * diagram of cross-account IAM trust" → iframe mounted, AND the body was:
 *
 *   Chord diagram of cross-account/tenant trust relationships ...
 *
 *   JSON
 *   {
 *     "template":"sankey",
 *     "title":"OpenAgenticOBORole Trust Flow",
 *     "data":{ "flows":[ ... ] },
 *     "group_id":"openagentic-obo-trust"
 *   }
 *
 *   Explanation:
 *   The trust policy contains two statements...
 *
 * The "JSON\n{...}" preamble + transition word ("Explanation:") is the
 * distinctive gpt-oss leak shape. Sonnet 4.6 occasionally emits ` ```json `
 * fenced blocks with the same shape.
 */
import { describe, it, expect } from 'vitest';
import { stripArtifactJsonLeak } from '../stripArtifactJsonLeak.js';

describe('stripArtifactJsonLeak', () => {
  it('strips a bare `JSON\\n{...}` block following an artifact-name preamble and before an "Explanation:" transition (gpt-oss live shape)', () => {
    const input = [
      'Chord diagram of cross-account/tenant trust relationships for OpenAgenticOBORole',
      '',
      'JSON',
      '{',
      '  "template":"sankey",',
      '  "title":"OpenAgenticOBORole Trust Flow",',
      '  "data":{',
      '    "flows":[',
      '      {"from":"Azure AD tenant ee3d15bb-...","to":"AWS account 312347353495","value":1}',
      '    ]',
      '  },',
      '  "group_id":"openagentic-obo-trust"',
      '}',
      '',
      'Explanation:',
      'The trust policy contains two statements...',
    ].join('\n');

    const out = stripArtifactJsonLeak(input);

    expect(out).not.toContain('"template":"sankey"');
    expect(out).not.toContain('"group_id":"openagentic-obo-trust"');
    expect(out).not.toMatch(/^JSON\s*$/m);
    // Preserve the preamble (caption) AND the explanation body.
    expect(out).toContain('Chord diagram of cross-account/tenant trust relationships');
    expect(out).toContain('Explanation:');
    expect(out).toContain('The trust policy contains two statements');
  });

  it('strips ```json fenced code blocks containing "template" field (Sonnet 4.6 occasional shape)', () => {
    const input = [
      'Here is your bar chart.',
      '',
      '```json',
      '{',
      '  "template": "bar_chart",',
      '  "data": { "x": [1,2,3], "y": [4,5,6] }',
      '}',
      '```',
      '',
      'The data shows ...',
    ].join('\n');

    const out = stripArtifactJsonLeak(input);

    expect(out).not.toContain('"template": "bar_chart"');
    expect(out).not.toContain('```json');
    expect(out).toContain('Here is your bar chart');
    expect(out).toContain('The data shows');
  });

  it('strips a bare `{...}` JSON object with "template" + "data" fields immediately after an "artifact rendered" caption', () => {
    const input = [
      'Sankey chart rendered above.',
      '',
      '{',
      '  "template": "sankey",',
      '  "title": "Trust",',
      '  "data": { "flows": [] }',
      '}',
      '',
      'Notes:',
      'See iframe.',
    ].join('\n');

    const out = stripArtifactJsonLeak(input);

    expect(out).not.toContain('"template": "sankey"');
    expect(out).not.toMatch(/"data"\s*:\s*\{\s*"flows"/);
    expect(out).toContain('Sankey chart rendered above');
    expect(out).toContain('See iframe');
  });

  it('preserves legitimate JSON in conversational context (no template/data artifact shape)', () => {
    const input =
      'The user\'s settings are `{"theme": "dark"}` and that is fine.';
    const out = stripArtifactJsonLeak(input);
    expect(out).toBe(input);
  });

  it('preserves an inline `{...}` object that has neither "template" nor "data" + "flows"/"x"/"y" payload', () => {
    const input = [
      'Configuration loaded.',
      '',
      '```json',
      '{ "debug": true, "level": "info" }',
      '```',
      '',
      'Continuing.',
    ].join('\n');
    const out = stripArtifactJsonLeak(input);
    // Plain config JSON is NOT an artifact leak.
    expect(out).toContain('"debug": true');
  });

  it('returns input unchanged when no leak present', () => {
    const input = 'Plain prose answer with no JSON anywhere.';
    expect(stripArtifactJsonLeak(input)).toBe(input);
  });

  it('returns empty string unchanged', () => {
    expect(stripArtifactJsonLeak('')).toBe('');
  });

  it('handles multiple JSON leaks in the same body', () => {
    const input = [
      'First chart:',
      '',
      'JSON',
      '{ "template": "bar_chart", "data": { "x":[1], "y":[2] } }',
      '',
      'Second chart:',
      '',
      'JSON',
      '{ "template": "line_chart", "data": { "series":[] } }',
      '',
      'Done.',
    ].join('\n');

    const out = stripArtifactJsonLeak(input);
    expect(out).not.toContain('bar_chart');
    expect(out).not.toContain('line_chart');
    expect(out).toContain('First chart');
    expect(out).toContain('Second chart');
    expect(out).toContain('Done');
  });

  it('collapses 3+ newlines down to a single blank-line separator after stripping', () => {
    const input = [
      'Caption.',
      '',
      'JSON',
      '{ "template": "x", "data": {} }',
      '',
      '',
      '',
      'Body.',
    ].join('\n');
    const out = stripArtifactJsonLeak(input);
    expect(out).not.toMatch(/\n{3,}/);
  });
});

describe('chatLoop wiring — stripArtifactJsonLeak is called on the persistence path', () => {
  it('stream.handler.ts persistence site references stripArtifactJsonLeak', async () => {
    const { readFileSync } = await import('node:fs');
    const { join } = await import('node:path');
    const handler = readFileSync(
      join(
        process.cwd(),
        'src/routes/chat/handlers/stream.handler.ts',
      ),
      'utf8',
    );
    expect(handler).toMatch(/stripArtifactJsonLeak/);
  });
});

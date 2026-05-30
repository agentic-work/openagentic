/**
 * Artifacts Parity — chat ↔ codemode for markdown / mermaid / code blocks.
 *
 * Chat pipeline emits explicit artifact_* NDJSON frames when the model
 * produces a streaming artifact (markdown table, mermaid diagram, code
 * block over a threshold length). The UI renders a collapsible artifact
 * card with the streamed content.
 *
 * Codemode: artifacts arrive inline as text_delta inside the assistant
 * content block; the UI is expected to pattern-match fenced markdown to
 * render a block. No explicit artifact_start/delta/complete envelope.
 *
 * The gap here is different from skills/plugins: artifacts *do* appear
 * on codemode, just without the envelope frames. So:
 *   - The tool_call-level parity holds.
 *   - The artifact-envelope parity does NOT hold today.
 *
 * We assert both.
 */

import { describe, test, expect } from 'vitest';
import { runParity, type ParityScenario } from './parity-harness.js';

const ARTIFACT_FIXTURES = [
  {
    kind: 'markdown' as const,
    content: '# Cloud Audit\n\n| Resource | Status |\n|----------|--------|\n| vm-01 | idle |\n',
  },
  {
    kind: 'mermaid' as const,
    content: 'sequenceDiagram\n  UI->>API: /api/chat/stream\n  API-->>UI: NDJSON\n',
  },
  {
    kind: 'code' as const,
    content:
      '```typescript\nexport function hello() {\n  return "world";\n}\n```\n',
  },
];

describe('Artifacts parity — chat ↔ codemode', () => {
  for (const fx of ARTIFACT_FIXTURES) {
    test(`${fx.kind} artifact: chat emits artifact_* frames; codemode does not (gap)`, () => {
      const scenario: ParityScenario = {
        name: `artifact-${fx.kind}`,
        userPrompt: `Please produce a ${fx.kind} artifact.`,
        script: [
          { kind: 'artifact', artifactType: fx.kind, content: fx.content },
          { kind: 'assistant_text', text: `Here is the ${fx.kind}.` },
        ],
      };

      const run = runParity(scenario);

      const chatArtifactStart = run.chat.parsed.find(f => f.type === 'artifact_start');
      const chatArtifactDelta = run.chat.parsed.find(f => f.type === 'artifact_delta');
      const chatArtifactComplete = run.chat.parsed.find(f => f.type === 'artifact_complete');
      expect(chatArtifactStart).toBeTruthy();
      expect(chatArtifactDelta).toBeTruthy();
      expect(chatArtifactComplete).toBeTruthy();

      const codemodeArtifactFrame = run.codemode.parsed.find(
        f => (f as any).type === 'artifact_start' || (f as any).type === 'artifact_delta',
      );
      expect(codemodeArtifactFrame).toBeFalsy();

      expect(run.diff.ok).toBe(false);
      const gapKinds = run.diff.divergences.map(d => d.chat?.kind);
      expect(gapKinds).toContain('artifact');
    });
  }

  test('markdown artifact preserves full content byte-for-byte in chat delta', () => {
    // If an artifact ever gets truncated in the emit path, users see a
    // broken table / diagram. Lock down the exact-match requirement.
    const scenario: ParityScenario = {
      name: 'artifact-full-content',
      userPrompt: 'Produce a table.',
      script: [
        { kind: 'artifact', artifactType: 'markdown', content: ARTIFACT_FIXTURES[0].content },
      ],
    };
    const run = runParity(scenario);
    const delta = run.chat.parsed.find(f => f.type === 'artifact_delta') as any;
    expect(delta.content).toBe(ARTIFACT_FIXTURES[0].content);
  });

  test('assistant_text after an artifact is still observable on both surfaces', () => {
    // Even though the artifact envelope is missing on codemode, the
    // narrative text that follows should parity-match. Verify.
    const scenario: ParityScenario = {
      name: 'artifact-then-text',
      userPrompt: 'Produce a chart, then explain it.',
      script: [
        { kind: 'artifact', artifactType: 'mermaid', content: 'sequenceDiagram\n  A->>B: x' },
        { kind: 'assistant_text', text: 'This diagram shows the flow.' },
      ],
    };
    const run = runParity(scenario);

    // Both surfaces emit the assistant text.
    const chatText = run.chat.parsed.find(
      f => f.type === 'content_delta' && (f as any).content === 'This diagram shows the flow.',
    );
    expect(chatText).toBeTruthy();
    const codeTextDelta = run.codemode.parsed.find(f => {
      const ev = (f as any).event;
      return (
        ev?.type === 'content_block_delta' &&
        ev?.delta?.type === 'text_delta' &&
        ev?.delta?.text === 'This diagram shows the flow.'
      );
    });
    expect(codeTextDelta).toBeTruthy();
  });
});

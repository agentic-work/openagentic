/**
 * #971 — duplicate inline artifacts re-render at bottom of finished replies.
 *
 * The bug: EnhancedMessageContent.tsx + MessageContent/index.tsx parse
 * `message.visualizations[]` and push `{type:'visualization'}` items, which
 * then render as `<DataVisualization>` — a SECOND iframe mount of the same
 * artifact that AAS already rendered inline at the tool_use position.
 *
 * The contract: EnhancedMessageContent + MessageContent render MARKDOWN PROSE
 * ONLY. visualizations[] is consumed by:
 *   - AAS (via tool_use ContentBlock → InlineVizBadge / InlineAppBadge) — inline render
 *   - ArtifactSlideOutLauncher — click-to-open SlideOut buttons
 *
 * EnhancedMessageContent / MessageContent must NOT push visualizations[] items
 * into their `parsed` array. Source-regression arch grep enforces this.
 */
import { describe, it, expect } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';

const REPO_ROOT = path.resolve(__dirname, '../../../../../../..');
const ENHANCED = path.join(
  REPO_ROOT,
  'services/openagentic-ui/src/features/chat/components/MessageContent/EnhancedMessageContent.tsx',
);
const PLAIN = path.join(
  REPO_ROOT,
  'services/openagentic-ui/src/features/chat/components/MessageContent/index.tsx',
);

describe("#971 — MessageContent must not push visualizations[] into parsed array", () => {
  it("EnhancedMessageContent.tsx does NOT iterate message.visualizations to push type:'visualization'", () => {
    const src = fs.readFileSync(ENHANCED, 'utf8');
    // Forbidden pattern: parsed.push({ type: 'visualization', content: viz })
    // inside a message.visualizations.forEach(...) block.
    expect(src).not.toMatch(/message\.visualizations\.forEach\(/);
    // Belt-and-suspenders: no push of `{ type: 'visualization', ...` anywhere.
    expect(src).not.toMatch(/parsed\.push\(\s*\{\s*type:\s*['"]visualization['"]/);
  });

  it("MessageContent/index.tsx does NOT iterate message.visualizations to push type:'visualization'", () => {
    const src = fs.readFileSync(PLAIN, 'utf8');
    expect(src).not.toMatch(/message\.visualizations\.forEach\(/);
    expect(src).not.toMatch(/parsed\.push\(\s*\{\s*type:\s*['"]visualization['"]/);
  });

  it("(sanity) extractArtifacts.ts STILL reads message.visualizations (for SlideOut launcher)", () => {
    const extract = path.join(
      REPO_ROOT,
      'services/openagentic-ui/src/features/chat/components/artifacts/extractArtifacts.ts',
    );
    const src = fs.readFileSync(extract, 'utf8');
    expect(src).toMatch(/message\.visualizations/);
  });
});

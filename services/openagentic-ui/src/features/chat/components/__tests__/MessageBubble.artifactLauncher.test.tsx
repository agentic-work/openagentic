/**
 * #781 Phase D.3 — MessageBubble artifact-launcher wire-in (source-content test).
 *
 * MessageBubble is 1300+ LOC with a complex props surface; the existing
 * cm-msg-asst test (cm-msg-asst.test.tsx) source-greps the file rather than
 * rendering it. Same pattern here — assert that Phase D's launcher wire-in
 * is present:
 *
 *   1. ArtifactSlideOutLauncher imported
 *   2. extractArtifacts imported
 *   3. The `extractArtifacts(message)` call exists
 *   4. The launcher list renders with the canonical test-id
 *   5. Render appears ABOVE EnhancedMessageContent (Phase D contract:
 *      slide-outs supersede inline content for new-pipeline artifacts)
 */
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, it, expect } from 'vitest';

const SRC = join(__dirname, '..', 'MessageBubble.tsx');

describe('MessageBubble Phase D artifact-launcher wire-in (#781)', () => {
  it('imports ArtifactSlideOutLauncher from artifacts/', () => {
    const src = readFileSync(SRC, 'utf8');
    expect(src).toMatch(
      /import \{ ArtifactSlideOutLauncher \} from ['"]\.\/artifacts\/ArtifactSlideOutLauncher['"]/,
    );
  });

  it('imports extractArtifacts from artifacts/', () => {
    const src = readFileSync(SRC, 'utf8');
    expect(src).toMatch(
      /import \{ extractArtifacts \} from ['"]\.\/artifacts\/extractArtifacts['"]/,
    );
  });

  it('calls extractArtifacts(message) inside the message render path', () => {
    const src = readFileSync(SRC, 'utf8');
    expect(src).toMatch(/extractArtifacts\(message\)/);
  });

  it('renders ArtifactSlideOutLauncher with kind/title/payload/status props', () => {
    const src = readFileSync(SRC, 'utf8');
    expect(src).toMatch(
      /<ArtifactSlideOutLauncher[\s\S]{0,400}?kind=\{[^}]+\}[\s\S]{0,400}?title=\{[^}]+\}[\s\S]{0,400}?payload=\{[^}]+\}[\s\S]{0,400}?status=\{[^}]+\}/,
    );
  });

  it('uses the canonical artifact-launcher-list test-id on the launcher container', () => {
    const src = readFileSync(SRC, 'utf8');
    expect(src).toMatch(/data-testid="artifact-launcher-list"/);
  });

  it('renders launchers ABOVE EnhancedMessageContent (slide-outs supersede inline)', () => {
    const src = readFileSync(SRC, 'utf8');
    const launcherIdx = src.indexOf('artifact-launcher-list');
    const enhancedIdx = src.indexOf('<EnhancedMessageContent');
    expect(launcherIdx).toBeGreaterThan(-1);
    expect(enhancedIdx).toBeGreaterThan(-1);
    expect(launcherIdx).toBeLessThan(enhancedIdx);
  });
});

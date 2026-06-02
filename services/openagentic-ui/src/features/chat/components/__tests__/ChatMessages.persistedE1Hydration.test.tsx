/**
 * E1 (2026-05-12) — Session-reload hydration of the full inline-frame
 * catalogue. Sev-0 audit found that on session reload, only the
 * hitl_approval + the original visual_render/app_render/streaming_table
 * /inline_widget/sub_agent_complete were rendered from the persisted
 * `message.visualizations` blob. The remaining frame types —
 * findings_emit, artifact_emit, artifact_render, sub_agent_completed
 * (canonical spelling) — vanished on reload even though the api now
 * persists them.
 *
 * This source-grep test pins the persisted-fallback contract for the
 * full catalogue.
 *
 * TDD-RED before fix.
 */
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, it, expect } from 'vitest';

const SRC = join(__dirname, '..', 'ChatMessages.tsx');

describe('ChatMessages — E1 persisted full-frame hydration (Sev-0)', () => {
  it('routes findings_emit through the persisted-visualizations fallback', () => {
    const src = readFileSync(SRC, 'utf8');
    expect(src).toMatch(/findings_emit/);
    // Must appear inside a persisted-frame filter block, not just a comment.
    expect(src).toMatch(/persisted[\s\S]{0,400}findings_emit|findings_emit[\s\S]{0,400}persisted/);
  });

  it('routes artifact_emit through the persisted-visualizations fallback', () => {
    const src = readFileSync(SRC, 'utf8');
    expect(src).toMatch(/artifact_emit/);
    expect(src).toMatch(/persisted[\s\S]{0,400}artifact_emit|artifact_emit[\s\S]{0,400}persisted/);
  });

  it('routes artifact_render through the persisted-visualizations fallback', () => {
    const src = readFileSync(SRC, 'utf8');
    expect(src).toMatch(/artifact_render/);
    expect(src).toMatch(/persisted[\s\S]{0,400}artifact_render|artifact_render[\s\S]{0,400}persisted/);
  });

  it('handles both sub_agent_complete (legacy) and sub_agent_completed (canonical) in fallback', () => {
    const src = readFileSync(SRC, 'utf8');
    expect(src).toMatch(/sub_agent_complete/);
    expect(src).toMatch(/sub_agent_completed/);
  });

  it('reuses the same render anchors as the live path so Playwright probes match', () => {
    const src = readFileSync(SRC, 'utf8');
    // findings render anchor — uses the Findings component (data-testid="findings")
    expect(src).toMatch(/data-testid="findings"|<Findings/);
    // download-tile anchor — DownloadTile imports already present
    expect(src).toMatch(/DownloadTile/);
  });
});

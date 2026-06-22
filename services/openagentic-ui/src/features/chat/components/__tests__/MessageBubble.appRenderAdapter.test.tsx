/**
 * MessageBubble — streamingContentBlocks → AAS-shape adapter must preserve
 * the `html` field for `app_render` blocks and `nonce` / `pyodideRequired` /
 * `title` so the downstream InlineAppBadge → AppRenderer mounts an iframe.
 *
 * Pre-fix repro (live 2026-05-19 dev environment `0.7.1-30bfb8ab`):
 *   - Wire frame `app_render` carries `html` (9355 bytes, validated, nonce-
 *     attached) and `title: "cloud_run_health_dashboard"` per WIRE-CAPTURE.
 *   - applyCanonicalFrame.foldAppRenderFrame folds it into a ContentBlock
 *     with `type:'app_render'`, `html`, `title`, `nonce` — correct.
 *   - The adapter in MessageBubble.tsx then maps that block to AAS's
 *     ContentBlock shape but drops every field except `type/content/
 *     timestamp/isComplete/toolId/toolName/startTime/duration/input/result/
 *     metadata`. `html` is NOT passed.
 *   - InlineAppBadge reads `block.html` → undefined → AppRenderer's empty-
 *     html guard returns null → no iframe mounts. The user sees a stub
 *     labeled "📦 compose_app · Mini app" with NO body.
 *
 * Source-grep pin so a future refactor that drops these fields fails CI
 * before re-shipping the empty-mini-app regression.
 */
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, it, expect } from 'vitest';

const SRC = join(__dirname, '..', 'MessageBubble.tsx');

describe('MessageBubble — adapter preserves app_render render-critical fields', () => {
  const src = readFileSync(SRC, 'utf8');

  it('passes `html` through the adapter (otherwise compose_app renders an empty Mini app shell)', () => {
    // The adapter maps streamingContentBlocks → AAS-shape blocks. The
    // resulting object must include the `html` key (sourced from
    // `block.html`) so InlineAppBadge → AppRenderer can mount the iframe.
    //
    // The check searches the file for at least one occurrence of an
    // `html:` key in the map() body next to the existing
    // `id: `stream-${block.index}`` pattern. We accept either
    // `html: block.html` or `html: (block as any).html` — both are valid
    // ways to thread the field through.
    expect(src).toMatch(/html:\s*(\(block as any\)\.html|block\.html)/);
  });

  it('passes `title` through the adapter (block.title default is "Mini app" when absent)', () => {
    expect(src).toMatch(/title:\s*(\(block as any\)\.title|block\.title)/);
  });

  it('passes `nonce` through the adapter (#487 — CSP drops unsafe-inline when present)', () => {
    expect(src).toMatch(/nonce:\s*(\(block as any\)\.nonce|block\.nonce)/);
  });

  it('passes `pyodideRequired` through the adapter (Python-in-Worker bootstrap toggle)', () => {
    // Source may name it `pyodideRequired` (camel) or `pyodide_required`
    // (snake — wire field). Accept either; both stay consumable.
    expect(src).toMatch(/pyodide[_R]equired:/);
  });

  it('passes `groupId` through the adapter (hot-swap-by-group preserves scroll position)', () => {
    expect(src).toMatch(/groupId:\s*(\(block as any\)\.groupId|block\.groupId)/);
  });
});

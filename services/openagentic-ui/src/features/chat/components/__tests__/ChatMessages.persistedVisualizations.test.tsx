/**
 * Persistence Sev-1: ChatMessages must render saved
 * `message.visualizations` frames as a fallback when the live per-message
 * reducer maps are empty — i.e. on session reload after a refresh.
 *
 * Without this, every inline widget (visual_render / app_render /
 * streaming_table / inline_widget / sub_agent_complete) emitted during
 * streaming silently vanishes when the user navigates back to the
 * session, even though the API has saved it on chat_messages.visualizations.
 *
 * Source-grep test — mirrors ChatMessages.inlineWidgetStrip.test.tsx in
 * style. Pins the wire so future refactors don't drop the fallback.
 */
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, it, expect } from 'vitest';

const SRC = join(__dirname, '..', 'ChatMessages.tsx');

describe('ChatMessages persisted visualizations fallback (Sev-1)', () => {
  it('reads message.visualizations and renders when present', () => {
    const src = readFileSync(SRC, 'utf8');
    // The render path must look up the saved frames off the message.
    expect(src).toMatch(/message\.visualizations/);
  });

  it('groups persisted frames by type before rendering', () => {
    const src = readFileSync(SRC, 'utf8');
    // The fallback must be aware of the persisted frame shape so it can
    // route visual_render/app_render/streaming_table/inline_widget to the
    // matching component.
    expect(src).toMatch(/visual_render/);
    expect(src).toMatch(/app_render/);
    expect(src).toMatch(/streaming_table/);
    expect(src).toMatch(/inline_widget/);
  });

  it('uses a data-testid to anchor the fallback strip', () => {
    const src = readFileSync(SRC, 'utf8');
    expect(src).toMatch(/persisted-visualizations|persisted-widgets/);
  });
});

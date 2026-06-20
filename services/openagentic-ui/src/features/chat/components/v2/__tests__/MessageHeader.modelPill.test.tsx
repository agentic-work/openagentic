/**
 * P0-2 of chatmode UX parity — MessageHeader assistant model pill.
 *
 * Plan refs:
 *   - the design notes
 *   - mocks/UX/01-cloud-ops.html lines 184-214 (.msg-asst, .msg-head, .cm-model)
 *
 * Mock pill anatomy:
 *   <span class="cm-model">
 *     <span class="cm-tag">claude</span>opus-4-7
 *   </span>
 *
 * Header receives `modelTag` + `modelId` as separate props (already split
 * upstream by `splitModelIdentifier` / `attachModelIdentifier` in the
 * useChatStream hook — see useChatStream.modelPropagation.test.ts).
 *
 * This file freezes that contract: given props, the DOM matches the mock
 * exactly. If anyone re-introduces a regex split inside the component or
 * drops the `cm-tag` wrapper, this test fails and the model pill silently
 * stops rendering family colors in chatmode.
 */

import React from 'react';
import { describe, it, expect } from 'vitest';
import { render } from '@testing-library/react';
import '@testing-library/jest-dom';
import { MessageHeader } from '../MessageHeader';

describe('MessageHeader — assistant model pill (mocks/UX/01:206-212)', () => {
  it('renders <span class="cm-tag">claude</span> followed by `opus-4-7` when both props present', () => {
    const { container } = render(
      <MessageHeader name="Assistant" variant="asst" modelTag="claude" modelId="opus-4-7" />
    );
    const pill = container.querySelector('.cm-model');
    expect(pill).not.toBeNull();
    const tag = pill!.querySelector('.cm-tag');
    expect(tag).not.toBeNull();
    expect(tag!.textContent).toBe('claude');
    // The id half is rendered directly inside `.cm-model` (no inner span)
    // — the mock keeps it as a bare text node so the family tag pops in
    // accent color while the id sits in the surrounding token color.
    expect(pill!.textContent).toBe('claudeopus-4-7');
  });

  it('renders only the cm-tag span when modelId is empty (single-token models like "qwen")', () => {
    const { container } = render(
      <MessageHeader name="Assistant" variant="asst" modelTag="qwen" modelId={undefined} />
    );
    const pill = container.querySelector('.cm-model');
    expect(pill).not.toBeNull();
    const tag = pill!.querySelector('.cm-tag');
    expect(tag).not.toBeNull();
    expect(tag!.textContent).toBe('qwen');
    expect(pill!.textContent).toBe('qwen');
  });

  it('does NOT render the .cm-model wrapper when neither modelTag nor modelId is set', () => {
    // Loading/before-message-received state — the pill must not flash an
    // empty box. mocks/UX/01 keeps the header timestamp+spacer aligned even
    // when there is no model yet.
    const { container } = render(
      <MessageHeader name="Assistant" variant="asst" />
    );
    expect(container.querySelector('.cm-model')).toBeNull();
  });

  it('renders the modelId without a wrapper span when only modelId is set (defensive)', () => {
    // Defensive: if a wire frame produced a malformed model and only id
    // survived, render at least the id half. The cm-tag span must NOT
    // appear (otherwise the family color paints whatever is in the id slot).
    const { container } = render(
      <MessageHeader name="Assistant" variant="asst" modelId="opus-4-7" />
    );
    const pill = container.querySelector('.cm-model');
    expect(pill).not.toBeNull();
    expect(pill!.querySelector('.cm-tag')).toBeNull();
    expect(pill!.textContent).toBe('opus-4-7');
  });
});

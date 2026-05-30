/**
 * Phase 3 of cm-v2 mock-parity migration — MessageHeader noAvatar prop.
 *
 * When the parent uses cm-msg-asst grid layout, the avatar lives in
 * col-1 OUTSIDE the header. MessageHeader must support omitting its
 * inline avatar so the col-1 + cm-msg-head row don't double up.
 *
 * Mock anatomy: mocks/UX/01-cloud-ops.html lines 184-214
 *   <div class="cm-msg-asst">
 *     <div class="cm-avatar cm-av-asst" />     <!-- col-1 -->
 *     <div class="cm-msg-body">                <!-- col-2 -->
 *       <div class="cm-msg-head">              <!-- name + model + time -->
 *         <span class="cm-name">...</span>
 *         <span class="cm-model">...</span>
 *         <span class="cm-spacer" />
 *         <span class="cm-time">...</span>
 *       </div>
 *     </div>
 *   </div>
 */

import React from 'react';
import { describe, it, expect } from 'vitest';
import { render } from '@testing-library/react';
import '@testing-library/jest-dom';
import { MessageHeader } from '../MessageHeader';

describe('MessageHeader noAvatar (mock 01:184-214 cm-msg-asst grid context)', () => {
  it('renders the avatar div by default (legacy callers)', () => {
    const { container } = render(<MessageHeader name="Sub agent" variant="c" />);
    expect(container.querySelector('.cm-avatar')).not.toBeNull();
  });

  it('omits the avatar div when noAvatar is true', () => {
    const { container } = render(
      <MessageHeader name="Assistant" variant="asst" noAvatar />,
    );
    expect(container.querySelector('.cm-avatar')).toBeNull();
  });

  it('still renders cm-msg-head with model + time when noAvatar', () => {
    const { container } = render(
      <MessageHeader
        name="Assistant"
        variant="asst"
        modelTag="claude"
        modelId="opus-4-7"
        timestamp="5:11 PM"
        noAvatar
      />,
    );
    expect(container.querySelector('.cm-msg-head')).not.toBeNull();
    expect(container.querySelector('.cm-model')).not.toBeNull();
    expect(container.querySelector('.cm-time')).not.toBeNull();
  });
});

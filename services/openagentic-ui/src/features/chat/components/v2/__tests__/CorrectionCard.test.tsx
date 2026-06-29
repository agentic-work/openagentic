/**
 * Phase 15 — CorrectionCard primitive (mocks 04, 05, 06).
 *
 * Mock 04 anatomy:
 *   <div class="cm-correction-card">
 *     <div class="cm-ico"><svg /></div>
 *     <div class="cm-cc-body">
 *       <div class="cm-title">Self-correction · Milvus RPO breaches budget</div>
 *       <div class="cm-sub">Milvus async replication gives 8min RPO ...</div>
 *     </div>
 *   </div>
 */

import React from 'react';
import { describe, it, expect } from 'vitest';
import { render } from '@testing-library/react';
import '@testing-library/jest-dom';
import { CorrectionCard } from '../CorrectionCard';

describe('CorrectionCard (mocks 04, 05, 06)', () => {
  it('renders cm-correction-card with cm-title + cm-sub', () => {
    const { container } = render(
      <CorrectionCard
        title="Self-correction · Milvus RPO breaches budget"
        body="Milvus async replication gives 8min RPO but requirement is ≤5min."
      />,
    );
    const card = container.querySelector('.cm-correction-card');
    expect(card).not.toBeNull();
    expect(card!.querySelector('.cm-title')).toHaveTextContent('Self-correction');
    expect(card!.querySelector('.cm-sub')).toHaveTextContent('8min RPO');
  });

  it('renders cm-ico holder for the warning icon slot', () => {
    const { container } = render(<CorrectionCard title="t" body="b" />);
    expect(container.querySelector('.cm-correction-card .cm-ico')).not.toBeNull();
  });

  it('omits cm-sub when body missing', () => {
    const { container } = render(<CorrectionCard title="just title" />);
    expect(container.querySelector('.cm-sub')).toBeNull();
  });

  it('marks cm-resolved when resolved=true (faded variant)', () => {
    const { container } = render(<CorrectionCard title="t" body="b" resolved />);
    expect(container.querySelector('.cm-correction-card.cm-resolved')).not.toBeNull();
  });
});

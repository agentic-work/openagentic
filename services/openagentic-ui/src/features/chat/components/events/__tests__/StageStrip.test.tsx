/**
 * StageStrip — Phase G render test.
 *
 * Asserts the 5-dot strip labels each stage correctly, marks done /
 * active / pending via data-state, and handles `null` current stage.
 */

import React from 'react';
import { describe, it, expect } from 'vitest';
import { render, screen } from '@testing-library/react';
import '@testing-library/jest-dom';
import { StageStrip, STAGE_ORDER } from '../StageStrip';

describe('StageStrip', () => {
  it('renders all five stages', () => {
    render(<StageStrip currentStage="analyze" />);
    for (const stage of STAGE_ORDER) {
      expect(screen.getByTestId(`stage-${stage}`)).toBeInTheDocument();
    }
  });

  it('marks stages before current as done and current as active', () => {
    render(<StageStrip currentStage="analyze" />);
    expect(screen.getByTestId('stage-discover').getAttribute('data-state')).toBe('done');
    expect(screen.getByTestId('stage-query').getAttribute('data-state')).toBe('done');
    expect(screen.getByTestId('stage-analyze').getAttribute('data-state')).toBe('active');
    expect(screen.getByTestId('stage-generate').getAttribute('data-state')).toBe('pending');
    expect(screen.getByTestId('stage-verify').getAttribute('data-state')).toBe('pending');
  });

  it('renders nothing active for a null current stage', () => {
    render(<StageStrip currentStage={null} />);
    for (const stage of STAGE_ORDER) {
      expect(screen.getByTestId(`stage-${stage}`).getAttribute('data-state')).toBe(
        'pending'
      );
    }
  });

  it('surfaces timing via title attribute', () => {
    render(
      <StageStrip
        currentStage="generate"
        timings={{ discover: 120, query: 340 }}
      />
    );
    expect(screen.getByTestId('stage-discover').getAttribute('title')).toMatch(
      /0\.1s/
    );
  });
});

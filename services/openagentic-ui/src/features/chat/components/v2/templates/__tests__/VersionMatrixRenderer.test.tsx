import React from 'react';
import { describe, it, expect, vi } from 'vitest';
import { render } from '@testing-library/react';
import '@testing-library/jest-dom';
import { VersionMatrixRenderer } from '../VersionMatrixRenderer';

const example = {
  title: 'npm drift',
  packages: ['typescript', 'vitest'],
  environments: ['dev', 'prod'],
  entries: [
    { package: 'typescript', environment: 'dev', installed: '5.4.5', latest: '5.6.2' },
    { package: 'typescript', environment: 'prod', installed: '5.3.3', latest: '5.6.2' },
    { package: 'vitest', environment: 'dev', installed: '1.6.0', latest: '2.1.3' },
    { package: 'vitest', environment: 'prod', installed: '1.6.0', latest: '2.1.3' },
  ],
};

describe('VersionMatrixRenderer', () => {
  it('renders the package×env grid', () => {
    const errSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
    const { container } = render(<VersionMatrixRenderer {...example} />);
    expect(container.querySelector('[data-testid="version-matrix-renderer"]')).not.toBeNull();
    const cells = container.querySelectorAll('td[data-package][data-env]');
    expect(cells.length).toBe(4);
    expect(errSpy).not.toHaveBeenCalled();
    errSpy.mockRestore();
  });

  it('placeholder when empty', () => {
    const { container } = render(<VersionMatrixRenderer />);
    expect(container.textContent).toMatch(/no version data/);
  });
});

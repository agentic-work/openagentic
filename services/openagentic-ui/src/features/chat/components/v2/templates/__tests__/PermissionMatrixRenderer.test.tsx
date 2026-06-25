import React from 'react';
import { describe, it, expect, vi } from 'vitest';
import { render } from '@testing-library/react';
import '@testing-library/jest-dom';
import { PermissionMatrixRenderer } from '../PermissionMatrixRenderer';

const example = {
  title: 'IAM perms',
  principals: ['sa:api', 'sa:executor'],
  actions: ['s3:GetObject', 's3:PutObject', 'kms:Decrypt'],
  cells: [
    { principal: 'sa:api', action: 's3:GetObject', effect: 'allow' as const },
    { principal: 'sa:api', action: 's3:PutObject', effect: 'conditional' as const, condition: 'tag match' },
    { principal: 'sa:api', action: 'kms:Decrypt', effect: 'allow' as const },
    { principal: 'sa:executor', action: 's3:GetObject', effect: 'allow' as const },
    { principal: 'sa:executor', action: 's3:PutObject', effect: 'allow' as const },
    { principal: 'sa:executor', action: 'kms:Decrypt', effect: 'deny' as const },
  ],
};

describe('PermissionMatrixRenderer', () => {
  it('renders a 2×3 grid', () => {
    const errSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
    const { container } = render(<PermissionMatrixRenderer {...example} />);
    expect(container.querySelector('[data-testid="permission-matrix-renderer"]')).not.toBeNull();
    const cells = container.querySelectorAll('td[data-principal][data-action]');
    expect(cells.length).toBe(6);
    expect(errSpy).not.toHaveBeenCalled();
    errSpy.mockRestore();
  });

  it('placeholder when empty', () => {
    const { container } = render(<PermissionMatrixRenderer />);
    expect(container.textContent).toMatch(/no permission data/);
  });
});

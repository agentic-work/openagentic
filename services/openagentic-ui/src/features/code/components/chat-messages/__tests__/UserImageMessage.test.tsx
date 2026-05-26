import React from 'react';
import { describe, it, expect, afterEach } from 'vitest';
import { render, screen, cleanup } from '@testing-library/react';
import '@testing-library/jest-dom';

import { UserImageMessage } from '../UserImageMessage';

afterEach(() => {
  cleanup();
});

describe('UserImageMessage', () => {
  it('renders a label with the image id', () => {
    render(<UserImageMessage imageId={42} />);
    expect(screen.getByText('[Image #42]')).toBeInTheDocument();
  });

  it('renders a generic [Image] label when imageId is missing', () => {
    render(<UserImageMessage />);
    expect(screen.getByText('[Image]')).toBeInTheDocument();
  });

  it('emits data-part="user_image"', () => {
    const { container } = render(<UserImageMessage imageId={1} />);
    expect(container.querySelector('[data-part="user_image"]')).not.toBeNull();
  });
});

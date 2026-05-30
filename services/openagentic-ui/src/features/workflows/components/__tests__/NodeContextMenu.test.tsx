/**
 * NodeContextMenu — TDD-driven right-click context menu for canvas nodes.
 *
 * Iron-law discipline: failing test first, watched fail, minimal impl,
 * watch pass. Pure presentation — receives an array of menu items + an
 * (x, y) anchor and renders a positioned floating menu.
 */

import React from 'react';
import { describe, it, expect, afterEach, vi } from 'vitest';
import { render, screen, cleanup, fireEvent } from '@testing-library/react';
import '@testing-library/jest-dom';

vi.mock('framer-motion', () => ({
  motion: {
    div: ({ children, ...p }: any) => <div {...p}>{children}</div>,
    button: ({ children, ...p }: any) => <button {...p}>{children}</button>,
  },
  AnimatePresence: ({ children }: any) => <>{children}</>,
}));

afterEach(() => cleanup());

import { NodeContextMenu } from '../NodeContextMenu';

const baseItems = [
  { id: 'configure', label: 'Configure', onSelect: vi.fn() },
  { id: 'duplicate', label: 'Duplicate', onSelect: vi.fn() },
  { id: 'delete', label: 'Delete', onSelect: vi.fn(), danger: true },
];

describe('NodeContextMenu — TDD', () => {
  it('RED 1: renders nothing when isOpen is false', () => {
    const { container } = render(
      <NodeContextMenu isOpen={false} x={0} y={0} items={baseItems} onClose={vi.fn()} />,
    );
    expect(container.firstChild).toBeNull();
  });

  it('RED 2: renders one button per item when open + invokes onSelect on click', () => {
    const onClose = vi.fn();
    const items = [
      { id: 'configure', label: 'Configure', onSelect: vi.fn() },
      { id: 'duplicate', label: 'Duplicate', onSelect: vi.fn() },
      { id: 'delete', label: 'Delete', onSelect: vi.fn(), danger: true },
    ];
    render(<NodeContextMenu isOpen={true} x={100} y={50} items={items} onClose={onClose} />);
    expect(screen.getByText('Configure')).toBeInTheDocument();
    expect(screen.getByText('Duplicate')).toBeInTheDocument();
    expect(screen.getByText('Delete')).toBeInTheDocument();

    fireEvent.click(screen.getByText('Duplicate'));
    expect(items[1].onSelect).toHaveBeenCalledOnce();
    expect(onClose).toHaveBeenCalled();
  });

  it('RED 3: positions the menu at (x, y) via inline styles', () => {
    render(<NodeContextMenu isOpen={true} x={123} y={456} items={baseItems} onClose={vi.fn()} />);
    const menu = screen.getByTestId('node-context-menu');
    expect(menu).toHaveStyle({ left: '123px', top: '456px' });
  });

  it('RED 4: pressing Escape closes the menu', () => {
    const onClose = vi.fn();
    render(<NodeContextMenu isOpen={true} x={0} y={0} items={baseItems} onClose={onClose} />);
    fireEvent.keyDown(window, { key: 'Escape' });
    expect(onClose).toHaveBeenCalled();
  });

  it('RED 5: disabled items are not clickable + do not call onSelect', () => {
    const onSelect = vi.fn();
    const onClose = vi.fn();
    const items = [{ id: 'frozen', label: 'Frozen', onSelect, disabled: true }];
    render(<NodeContextMenu isOpen={true} x={0} y={0} items={items} onClose={onClose} />);
    fireEvent.click(screen.getByText('Frozen'));
    expect(onSelect).not.toHaveBeenCalled();
    expect(onClose).not.toHaveBeenCalled();
  });

  it('RED 6: mousedown outside the menu closes it', () => {
    const onClose = vi.fn();
    render(<NodeContextMenu isOpen={true} x={10} y={10} items={baseItems} onClose={onClose} />);
    // Click on the document body (outside the menu).
    fireEvent.mouseDown(document.body);
    expect(onClose).toHaveBeenCalled();
  });

  it('RED 7: mousedown INSIDE the menu does NOT close it (lets item click resolve normally)', () => {
    const onClose = vi.fn();
    render(<NodeContextMenu isOpen={true} x={10} y={10} items={baseItems} onClose={onClose} />);
    fireEvent.mouseDown(screen.getByTestId('node-context-menu'));
    expect(onClose).not.toHaveBeenCalled();
  });
});

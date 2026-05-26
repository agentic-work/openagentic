import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { FileContextMenu, type FileContextMenuProps } from '../FileContextMenu';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

const defaultItems = [
  { label: 'Open', onClick: vi.fn() },
  { label: 'Copy path', shortcut: '⌘C', onClick: vi.fn() },
  { label: 'Download', onClick: vi.fn() },
  { label: 'Disabled item', onClick: vi.fn(), disabled: true },
];

function makeProps(overrides: Partial<FileContextMenuProps> = {}): FileContextMenuProps {
  return {
    x: 100,
    y: 200,
    items: defaultItems,
    onClose: vi.fn(),
    ...overrides,
  };
}

beforeEach(() => {
  vi.clearAllMocks();
  // Reset viewport size to standard 1280x720
  Object.defineProperty(window, 'innerWidth', { writable: true, configurable: true, value: 1280 });
  Object.defineProperty(window, 'innerHeight', { writable: true, configurable: true, value: 720 });
});

// ---------------------------------------------------------------------------
// 1. Renders with given items at given coords
// ---------------------------------------------------------------------------
describe('FileContextMenu — rendering', () => {
  it('1. Renders all items at given coordinates', () => {
    const { container } = render(<FileContextMenu {...makeProps()} />);
    const menu = container.querySelector('.fp-ctx-menu') as HTMLElement;
    expect(menu).not.toBeNull();
    expect(menu.style.left).toBe('100px');
    expect(menu.style.top).toBe('200px');
    expect(screen.getByText('Open')).toBeTruthy();
    expect(screen.getByText('Copy path')).toBeTruthy();
    expect(screen.getByText('Download')).toBeTruthy();
  });

  it('2. Renders shortcut text in a separate cell when present', () => {
    const { container } = render(<FileContextMenu {...makeProps()} />);
    const shortcutEl = container.querySelector('.fp-ctx-shortcut');
    expect(shortcutEl).not.toBeNull();
    expect(shortcutEl?.textContent).toBe('⌘C');
  });

  it('3. ARIA roles correct — menu role and menuitem roles', () => {
    const { container } = render(<FileContextMenu {...makeProps()} />);
    const menu = container.querySelector('[role="menu"]');
    expect(menu).not.toBeNull();
    const menuItems = container.querySelectorAll('[role="menuitem"]');
    expect(menuItems.length).toBe(defaultItems.length);
  });

  it('4. Disabled item has muted class and does not call onClick on click', () => {
    const disabledOnClick = vi.fn();
    const items = [
      { label: 'Disabled', onClick: disabledOnClick, disabled: true },
    ];
    const { container } = render(<FileContextMenu {...makeProps({ items })} />);
    const disabledItem = container.querySelector('[role="menuitem"].disabled');
    expect(disabledItem).not.toBeNull();
    fireEvent.click(disabledItem as HTMLElement);
    expect(disabledOnClick).not.toHaveBeenCalled();
  });
});

// ---------------------------------------------------------------------------
// 5. Keyboard navigation
// ---------------------------------------------------------------------------
describe('FileContextMenu — keyboard navigation', () => {
  it('5. ArrowDown navigates to next item', () => {
    const { container } = render(<FileContextMenu {...makeProps()} />);
    const menu = container.querySelector('[role="menu"]') as HTMLElement;
    fireEvent.keyDown(menu, { key: 'ArrowDown' });
    const items = container.querySelectorAll('[role="menuitem"]:not(.disabled)');
    // First enabled item gets focus
    expect(document.activeElement).toBe(items[0]);
  });

  it('6. ArrowUp from first wraps or stays', () => {
    const { container } = render(<FileContextMenu {...makeProps()} />);
    const menu = container.querySelector('[role="menu"]') as HTMLElement;
    // Navigate down twice then up
    fireEvent.keyDown(menu, { key: 'ArrowDown' });
    fireEvent.keyDown(menu, { key: 'ArrowDown' });
    fireEvent.keyDown(menu, { key: 'ArrowUp' });
    const items = container.querySelectorAll('[role="menuitem"]:not(.disabled)');
    expect(document.activeElement).toBe(items[0]);
  });

  it('7. Enter on focused item calls onClick and closes', () => {
    const onClick = vi.fn();
    const onClose = vi.fn();
    const items = [{ label: 'Action', onClick }];
    const { container } = render(<FileContextMenu {...makeProps({ items, onClose })} />);
    const menu = container.querySelector('[role="menu"]') as HTMLElement;
    fireEvent.keyDown(menu, { key: 'ArrowDown' });
    const menuItem = container.querySelector('[role="menuitem"]') as HTMLElement;
    fireEvent.keyDown(menuItem, { key: 'Enter' });
    expect(onClick).toHaveBeenCalledOnce();
    expect(onClose).toHaveBeenCalledOnce();
  });

  it('8. Esc key closes the menu', () => {
    const onClose = vi.fn();
    const { container } = render(<FileContextMenu {...makeProps({ onClose })} />);
    const menu = container.querySelector('[role="menu"]') as HTMLElement;
    fireEvent.keyDown(menu, { key: 'Escape' });
    expect(onClose).toHaveBeenCalledOnce();
  });
});

// ---------------------------------------------------------------------------
// 9. Click outside closes
// ---------------------------------------------------------------------------
describe('FileContextMenu — click outside', () => {
  it('9. Click outside the menu triggers onClose', () => {
    const onClose = vi.fn();
    render(
      <div>
        <FileContextMenu {...makeProps({ onClose })} />
        <button data-testid="outside">outside</button>
      </div>
    );
    // Simulate a capture-phase mousedown outside the menu
    fireEvent.mouseDown(screen.getByTestId('outside'));
    expect(onClose).toHaveBeenCalledOnce();
  });
});

// ---------------------------------------------------------------------------
// 10. Auto-flip at viewport edges
// ---------------------------------------------------------------------------
describe('FileContextMenu — auto-flip', () => {
  it('10. Auto-flips right when x is within 200px of right edge (1280 - 1100 = 180 < 200)', () => {
    const { container } = render(<FileContextMenu {...makeProps({ x: 1100, y: 200 })} />);
    const menu = container.querySelector('.fp-ctx-menu') as HTMLElement;
    // Should have been flipped: position uses "right" offset style or the left is adjusted
    // We check that the menu has the flip class or the style is flipped
    expect(menu.classList.contains('flip-x') || parseFloat(menu.style.left) < 1100).toBe(true);
  });

  it('11. Auto-flips vertically when y is within 200px of bottom edge (720 - 560 = 160 < 200)', () => {
    const { container } = render(<FileContextMenu {...makeProps({ x: 100, y: 560 })} />);
    const menu = container.querySelector('.fp-ctx-menu') as HTMLElement;
    expect(menu.classList.contains('flip-y') || parseFloat(menu.style.top) < 560).toBe(true);
  });
});

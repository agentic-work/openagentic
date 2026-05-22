import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { FileTabs, type FileTabsProps } from '../FileTabs';
import type { OpenTab } from '../../state/fileStatusStore';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function makeTab(path: string, lastActivatedMs = 1000): OpenTab {
  return { path, lastActivatedMs };
}

function defaultProps(overrides: Partial<FileTabsProps> = {}): FileTabsProps {
  return {
    tabs: [],
    activePath: null,
    dirtyPaths: new Set(),
    onSelect: vi.fn(),
    onClose: vi.fn(),
    ...overrides,
  };
}

// ---------------------------------------------------------------------------
// Structure tests
// ---------------------------------------------------------------------------

describe('FileTabs — structure', () => {
  it('1. Empty tabs → renders .fp-tabs-empty with "No file open", no spacer or +', () => {
    const { container } = render(<FileTabs {...defaultProps()} />);
    const empty = container.querySelector('.fp-tabs-empty');
    expect(empty).not.toBeNull();
    expect(empty?.textContent).toBe('No file open');
    expect(container.querySelector('.fp-tabs-spacer')).toBeNull();
    expect(container.querySelector('.fp-tabs-action')).toBeNull();
  });

  it('2. Single tab + activePath matches → .fp-tab.active with id tab-mainpy, icon "icon py", name main.py, close ×', () => {
    const props = defaultProps({
      tabs: [makeTab('/src/main.py')],
      activePath: '/src/main.py',
    });
    const { container } = render(<FileTabs {...props} />);
    const tab = container.querySelector('.fp-tab.active');
    expect(tab).not.toBeNull();
    expect(tab?.id).toBe('tab-mainpy');
    expect(tab?.querySelector('.icon.py')).not.toBeNull();
    expect(tab?.querySelector('span:nth-child(2)')?.textContent).toBe('main.py');
    const closeEl = tab?.querySelector('.close');
    expect(closeEl?.textContent).toBe('×');
  });

  it('3. Three tabs in MRU order → exactly 3 .fp-tab elements in given order', () => {
    const props = defaultProps({
      tabs: [
        makeTab('/a/main.py', 3000),
        makeTab('/b/auth.py', 2000),
        makeTab('/c/App.tsx', 1000),
      ],
      activePath: '/a/main.py',
    });
    const { container } = render(<FileTabs {...props} />);
    const tabs = container.querySelectorAll('.fp-tab');
    expect(tabs).toHaveLength(3);
    expect(tabs[0].textContent).toContain('main.py');
    expect(tabs[1].textContent).toContain('auth.py');
    expect(tabs[2].textContent).toContain('App.tsx');
  });

  it('4. aria-selected="true" on active, "false" on others', () => {
    const props = defaultProps({
      tabs: [makeTab('/a/main.py', 2000), makeTab('/b/other.ts', 1000)],
      activePath: '/a/main.py',
    });
    const { container } = render(<FileTabs {...props} />);
    const tabs = Array.from(container.querySelectorAll('.fp-tab'));
    expect(tabs[0].getAttribute('aria-selected')).toBe('true');
    expect(tabs[1].getAttribute('aria-selected')).toBe('false');
  });

  it('5. role="tablist" on wrapper, role="tab" on each tab', () => {
    const props = defaultProps({
      tabs: [makeTab('/a/main.py')],
      activePath: '/a/main.py',
    });
    const { container } = render(<FileTabs {...props} />);
    const wrapper = container.querySelector('.fp-tabs');
    expect(wrapper?.getAttribute('role')).toBe('tablist');
    const tab = container.querySelector('.fp-tab');
    expect(tab?.getAttribute('role')).toBe('tab');
  });
});

// ---------------------------------------------------------------------------
// Icon tests
// ---------------------------------------------------------------------------

describe('FileTabs — icons', () => {
  it('6. App.tsx → icon class "icon tsx"', () => {
    const props = defaultProps({
      tabs: [makeTab('/src/App.tsx')],
      activePath: '/src/App.tsx',
    });
    const { container } = render(<FileTabs {...props} />);
    expect(container.querySelector('.icon.tsx')).not.toBeNull();
  });

  it('7. package.json → icon class "icon json"', () => {
    const props = defaultProps({
      tabs: [makeTab('/pkg/package.json')],
      activePath: '/pkg/package.json',
    });
    const { container } = render(<FileTabs {...props} />);
    expect(container.querySelector('.icon.json')).not.toBeNull();
  });

  it('8. Dockerfile → icon class "icon yaml"', () => {
    const props = defaultProps({
      tabs: [makeTab('/app/Dockerfile')],
      activePath: '/app/Dockerfile',
    });
    const { container } = render(<FileTabs {...props} />);
    expect(container.querySelector('.icon.yaml')).not.toBeNull();
  });

  it('9. README.md → icon class "icon md"', () => {
    const props = defaultProps({
      tabs: [makeTab('/README.md')],
      activePath: '/README.md',
    });
    const { container } = render(<FileTabs {...props} />);
    expect(container.querySelector('.icon.md')).not.toBeNull();
  });
});

// ---------------------------------------------------------------------------
// Dirty state tests
// ---------------------------------------------------------------------------

describe('FileTabs — dirty state', () => {
  it('10. Tab in dirtyPaths → close span has class "close dirty" and text ●', () => {
    const path = '/src/main.py';
    const props = defaultProps({
      tabs: [makeTab(path)],
      activePath: path,
      dirtyPaths: new Set([path]),
    });
    const { container } = render(<FileTabs {...props} />);
    const close = container.querySelector('.close.dirty');
    expect(close).not.toBeNull();
    expect(close?.textContent).toBe('●');
  });

  it('11. Non-dirty tab → close span has class "close" only and text ×', () => {
    const path = '/src/main.py';
    const props = defaultProps({
      tabs: [makeTab(path)],
      activePath: path,
      dirtyPaths: new Set(),
    });
    const { container } = render(<FileTabs {...props} />);
    const close = container.querySelector('.close');
    expect(close).not.toBeNull();
    expect(close?.classList.contains('dirty')).toBe(false);
    expect(close?.textContent).toBe('×');
  });
});

// ---------------------------------------------------------------------------
// Click handler tests
// ---------------------------------------------------------------------------

describe('FileTabs — click handlers', () => {
  it('12. Click on tab body → onSelect(path) called', () => {
    const onSelect = vi.fn();
    const path = '/src/main.py';
    const props = defaultProps({
      tabs: [makeTab(path)],
      activePath: null,
      onSelect,
    });
    const { container } = render(<FileTabs {...props} />);
    const tab = container.querySelector('.fp-tab') as HTMLElement;
    fireEvent.click(tab);
    expect(onSelect).toHaveBeenCalledOnce();
    expect(onSelect).toHaveBeenCalledWith(path);
  });

  it('13. Click on tab body when already active → onSelect NOT called', () => {
    const onSelect = vi.fn();
    const path = '/src/main.py';
    const props = defaultProps({
      tabs: [makeTab(path)],
      activePath: path,
      onSelect,
    });
    const { container } = render(<FileTabs {...props} />);
    const tab = container.querySelector('.fp-tab') as HTMLElement;
    fireEvent.click(tab);
    expect(onSelect).not.toHaveBeenCalled();
  });

  it('14. Click on .close → onClose(path) called once, onSelect NOT called', () => {
    const onSelect = vi.fn();
    const onClose = vi.fn();
    const path = '/src/main.py';
    const props = defaultProps({
      tabs: [makeTab(path)],
      activePath: null,
      onSelect,
      onClose,
    });
    const { container } = render(<FileTabs {...props} />);
    const closeEl = container.querySelector('.close') as HTMLElement;
    fireEvent.click(closeEl);
    expect(onClose).toHaveBeenCalledOnce();
    expect(onClose).toHaveBeenCalledWith(path);
    expect(onSelect).not.toHaveBeenCalled();
  });

  it('15. Click on .close.dirty → onClose called, no select', () => {
    const onSelect = vi.fn();
    const onClose = vi.fn();
    const path = '/src/main.py';
    const props = defaultProps({
      tabs: [makeTab(path)],
      activePath: null,
      dirtyPaths: new Set([path]),
      onSelect,
      onClose,
    });
    const { container } = render(<FileTabs {...props} />);
    const closeEl = container.querySelector('.close.dirty') as HTMLElement;
    fireEvent.click(closeEl);
    expect(onClose).toHaveBeenCalledOnce();
    expect(onClose).toHaveBeenCalledWith(path);
    expect(onSelect).not.toHaveBeenCalled();
  });
});

// ---------------------------------------------------------------------------
// Add button tests
// ---------------------------------------------------------------------------

describe('FileTabs — add button', () => {
  it('16. With onAddTab provided → .fp-tabs-action rendered with text +', () => {
    const props = defaultProps({
      tabs: [makeTab('/a/main.py')],
      activePath: '/a/main.py',
      onAddTab: vi.fn(),
    });
    const { container } = render(<FileTabs {...props} />);
    const action = container.querySelector('.fp-tabs-action');
    expect(action).not.toBeNull();
    expect(action?.textContent).toBe('+');
  });

  it('17. Click + → onAddTab() called', () => {
    const onAddTab = vi.fn();
    const props = defaultProps({
      tabs: [makeTab('/a/main.py')],
      activePath: '/a/main.py',
      onAddTab,
    });
    const { container } = render(<FileTabs {...props} />);
    const action = container.querySelector('.fp-tabs-action') as HTMLElement;
    fireEvent.click(action);
    expect(onAddTab).toHaveBeenCalledOnce();
  });

  it('18. Without onAddTab → .fp-tabs-action NOT rendered', () => {
    const props = defaultProps({
      tabs: [makeTab('/a/main.py')],
      activePath: '/a/main.py',
    });
    const { container } = render(<FileTabs {...props} />);
    expect(container.querySelector('.fp-tabs-action')).toBeNull();
  });
});

// ---------------------------------------------------------------------------
// Keyboard tests
// ---------------------------------------------------------------------------

describe('FileTabs — keyboard', () => {
  it('19. Enter on focused tab → onSelect called', () => {
    const onSelect = vi.fn();
    const path = '/src/main.py';
    const props = defaultProps({
      tabs: [makeTab(path)],
      activePath: null,
      onSelect,
    });
    const { container } = render(<FileTabs {...props} />);
    const tab = container.querySelector('.fp-tab') as HTMLElement;
    fireEvent.keyDown(tab, { key: 'Enter' });
    expect(onSelect).toHaveBeenCalledWith(path);
  });

  it('20. Space on focused tab → onSelect called', () => {
    const onSelect = vi.fn();
    const path = '/src/main.py';
    const props = defaultProps({
      tabs: [makeTab(path)],
      activePath: null,
      onSelect,
    });
    const { container } = render(<FileTabs {...props} />);
    const tab = container.querySelector('.fp-tab') as HTMLElement;
    fireEvent.keyDown(tab, { key: ' ' });
    expect(onSelect).toHaveBeenCalledWith(path);
  });

  it('21. Cmd+W on focused tab → onClose for THAT tab', () => {
    const onClose = vi.fn();
    const path = '/src/main.py';
    const props = defaultProps({
      tabs: [makeTab(path)],
      activePath: path,
      onClose,
    });
    const { container } = render(<FileTabs {...props} />);
    const tab = container.querySelector('.fp-tab') as HTMLElement;
    fireEvent.keyDown(tab, { key: 'w', metaKey: true });
    expect(onClose).toHaveBeenCalledOnce();
    expect(onClose).toHaveBeenCalledWith(path);
  });

  it('22. ArrowRight on focused tab moves DOM focus to next tab', async () => {
    const user = userEvent.setup();
    const props = defaultProps({
      tabs: [makeTab('/a/main.py', 2000), makeTab('/b/other.ts', 1000)],
      activePath: '/a/main.py',
    });
    const { container } = render(<FileTabs {...props} />);
    const tabs = container.querySelectorAll('.fp-tab');
    const firstTab = tabs[0] as HTMLElement;
    firstTab.focus();
    fireEvent.keyDown(firstTab, { key: 'ArrowRight' });
    expect(document.activeElement).toBe(tabs[1]);
  });
});

// ---------------------------------------------------------------------------
// ID slugification tests
// ---------------------------------------------------------------------------

describe('FileTabs — ID slugification', () => {
  it('23. path "/x/main.py" → tab id "tab-mainpy"', () => {
    const props = defaultProps({
      tabs: [makeTab('/x/main.py')],
      activePath: '/x/main.py',
    });
    const { container } = render(<FileTabs {...props} />);
    const tab = container.querySelector('.fp-tab');
    expect(tab?.id).toBe('tab-mainpy');
  });

  it('24. path "/x/App.tsx" → tab id "tab-apptsx"', () => {
    const props = defaultProps({
      tabs: [makeTab('/x/App.tsx')],
      activePath: '/x/App.tsx',
    });
    const { container } = render(<FileTabs {...props} />);
    const tab = container.querySelector('.fp-tab');
    expect(tab?.id).toBe('tab-apptsx');
  });
});

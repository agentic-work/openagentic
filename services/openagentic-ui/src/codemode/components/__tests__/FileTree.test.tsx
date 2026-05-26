import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { FileTree, fileIconKind, type FileTreeProps, type ListDirEntry } from '../FileTree';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function makeFile(name: string, overrides: Partial<ListDirEntry> = {}): ListDirEntry {
  return {
    name,
    type: 'file',
    size: 100,
    mtimeMs: Date.now(),
    mode: 0o644,
    isReadable: true,
    ...overrides,
  };
}

function makeDir(name: string, overrides: Partial<ListDirEntry> = {}): ListDirEntry {
  return {
    name,
    type: 'dir',
    size: 0,
    mtimeMs: Date.now(),
    mode: 0o755,
    isReadable: true,
    ...overrides,
  };
}

const ROOT = '/workspaces/u';

function defaultProps(overrides: Partial<FileTreeProps> = {}): FileTreeProps {
  return {
    rootPath: ROOT,
    childrenByPath: new Map(),
    expandedPaths: new Set(),
    activePath: null,
    editingPath: null,
    dirtyPaths: new Set(),
    recentlyModifiedPaths: new Set(),
    onOpenFile: vi.fn(),
    onToggleExpand: vi.fn(),
    ...overrides,
  };
}

// ---------------------------------------------------------------------------
// Structure tests
// ---------------------------------------------------------------------------

describe('FileTree — structure', () => {
  it('1. Empty childrenByPath → renders fp-tree with no child nodes', () => {
    const { container } = render(<FileTree {...defaultProps()} />);
    const tree = container.querySelector('.fp-tree');
    expect(tree).not.toBeNull();
    expect(container.querySelectorAll('.fp-node')).toHaveLength(0);
  });

  it('2. Single file at root → lvl-0 node with twisty.empty, icon.file-py, name', () => {
    const props = defaultProps({
      childrenByPath: new Map([[ROOT, [makeFile('main.py')]]]),
    });
    const { container } = render(<FileTree {...props} />);
    const nodes = container.querySelectorAll('.fp-node');
    expect(nodes).toHaveLength(1);
    expect(nodes[0].classList.contains('lvl-0')).toBe(true);
    expect(nodes[0].querySelector('.twisty.empty')).not.toBeNull();
    expect(nodes[0].querySelector('.icon.file-py')).not.toBeNull();
    expect(nodes[0].querySelector('.name')?.textContent).toBe('main.py');
  });

  it('3. Single dir collapsed → twisty without .empty showing ▸, icon.folder', () => {
    const props = defaultProps({
      childrenByPath: new Map([[ROOT, [makeDir('backend')]]]),
    });
    const { container } = render(<FileTree {...props} />);
    const nodes = container.querySelectorAll('.fp-node');
    expect(nodes).toHaveLength(1);
    const twisty = nodes[0].querySelector('.twisty');
    expect(twisty?.classList.contains('empty')).toBe(false);
    expect(twisty?.textContent).toBe('▸');
    expect(nodes[0].querySelector('.icon.folder')).not.toBeNull();
  });

  it('4. Single dir expanded with one child file → 2 sibling fp-nodes: dir lvl-0 (▾), file lvl-1', () => {
    const backendPath = `${ROOT}/backend`;
    const props = defaultProps({
      childrenByPath: new Map([
        [ROOT, [makeDir('backend')]],
        [backendPath, [makeFile('server.py')]],
      ]),
      expandedPaths: new Set([backendPath]),
    });
    const { container } = render(<FileTree {...props} />);
    const nodes = container.querySelectorAll('.fp-node');
    expect(nodes).toHaveLength(2);
    expect(nodes[0].classList.contains('lvl-0')).toBe(true);
    expect(nodes[0].querySelector('.twisty')?.textContent).toBe('▾');
    expect(nodes[1].classList.contains('lvl-1')).toBe(true);
  });

  it('5. Three-level nesting all expanded → 3 sibling rows lvl-0, lvl-1, lvl-2', () => {
    const backendPath = `${ROOT}/backend`;
    const appPath = `${backendPath}/app`;
    const props = defaultProps({
      childrenByPath: new Map([
        [ROOT, [makeDir('backend')]],
        [backendPath, [makeDir('app')]],
        [appPath, [makeFile('main.py')]],
      ]),
      expandedPaths: new Set([backendPath, appPath]),
    });
    const { container } = render(<FileTree {...props} />);
    const nodes = container.querySelectorAll('.fp-node');
    expect(nodes).toHaveLength(3);
    expect(nodes[0].classList.contains('lvl-0')).toBe(true);
    expect(nodes[1].classList.contains('lvl-1')).toBe(true);
    expect(nodes[2].classList.contains('lvl-2')).toBe(true);
    // Verify flat siblings under fp-tree, not nested
    const treeDiv = container.querySelector('.fp-tree');
    expect(treeDiv?.children).toHaveLength(3);
  });
});

// ---------------------------------------------------------------------------
// Indicator tests
// ---------------------------------------------------------------------------

describe('FileTree — indicators (priority order)', () => {
  const filePath = `${ROOT}/main.py`;
  const baseMap = new Map([[ROOT, [makeFile('main.py')]]]);

  it('6. editingPath → .ind.editing (no inner text), parent node has "editing" class', () => {
    const props = defaultProps({
      childrenByPath: baseMap,
      editingPath: filePath,
    });
    const { container } = render(<FileTree {...props} />);
    const node = container.querySelector('.fp-node');
    expect(node?.classList.contains('editing')).toBe(true);
    const ind = container.querySelector('.ind.editing');
    expect(ind).not.toBeNull();
    expect(ind?.textContent).toBe('');
  });

  it('7. editingPath + dirtyPaths both set → only .ind.editing renders', () => {
    const props = defaultProps({
      childrenByPath: baseMap,
      editingPath: filePath,
      dirtyPaths: new Set([filePath]),
    });
    const { container } = render(<FileTree {...props} />);
    expect(container.querySelector('.ind.editing')).not.toBeNull();
    expect(container.querySelector('.ind.dirty')).toBeNull();
  });

  it('8. dirtyPaths only → .ind.dirty renders with text ●', () => {
    const props = defaultProps({
      childrenByPath: baseMap,
      dirtyPaths: new Set([filePath]),
    });
    const { container } = render(<FileTree {...props} />);
    const ind = container.querySelector('.ind.dirty');
    expect(ind).not.toBeNull();
    expect(ind?.textContent).toBe('●');
    expect(container.querySelector('.ind.editing')).toBeNull();
  });

  it('9. recentlyModifiedPaths only → .ind.recent renders, parent has flash class', () => {
    const props = defaultProps({
      childrenByPath: baseMap,
      recentlyModifiedPaths: new Set([filePath]),
    });
    const { container } = render(<FileTree {...props} />);
    const node = container.querySelector('.fp-node');
    expect(node?.classList.contains('flash')).toBe(true);
    expect(container.querySelector('.ind.recent')).not.toBeNull();
  });

  it('10. No indicator state → no .ind span', () => {
    const props = defaultProps({ childrenByPath: baseMap });
    const { container } = render(<FileTree {...props} />);
    expect(container.querySelector('.ind')).toBeNull();
  });
});

// ---------------------------------------------------------------------------
// Icon tests
// ---------------------------------------------------------------------------

describe('fileIconKind', () => {
  it('11. main.py → py', () => expect(fileIconKind('main.py')).toBe('py'));
  it('12. App.tsx → tsx', () => expect(fileIconKind('App.tsx')).toBe('tsx'));
  it('13. package.json → json', () => expect(fileIconKind('package.json')).toBe('json'));
  it('14. Dockerfile → yaml (per mock)', () => expect(fileIconKind('Dockerfile')).toBe('yaml'));
  it('15. README.md → md', () => expect(fileIconKind('README.md')).toBe('md'));
});

describe('FileTree — icon classes', () => {
  it('16. Folder → .icon.folder', () => {
    const props = defaultProps({
      childrenByPath: new Map([[ROOT, [makeDir('src')]]]),
    });
    const { container } = render(<FileTree {...props} />);
    expect(container.querySelector('.icon.folder')).not.toBeNull();
  });
});

// ---------------------------------------------------------------------------
// Click handler tests
// ---------------------------------------------------------------------------

describe('FileTree — click handlers', () => {
  const filePath = `${ROOT}/main.py`;

  it('17. Click file row → onOpenFile(path); onToggleExpand NOT called', () => {
    const onOpenFile = vi.fn();
    const onToggleExpand = vi.fn();
    const props = defaultProps({
      childrenByPath: new Map([[ROOT, [makeFile('main.py')]]]),
      onOpenFile,
      onToggleExpand,
    });
    const { container } = render(<FileTree {...props} />);
    const node = container.querySelector('.fp-node') as HTMLElement;
    fireEvent.click(node);
    expect(onOpenFile).toHaveBeenCalledOnce();
    expect(onOpenFile).toHaveBeenCalledWith(filePath);
    expect(onToggleExpand).not.toHaveBeenCalled();
  });

  it('18. Click dir row → onToggleExpand(path); onOpenFile NOT called', () => {
    const onOpenFile = vi.fn();
    const onToggleExpand = vi.fn();
    const dirPath = `${ROOT}/backend`;
    const props = defaultProps({
      childrenByPath: new Map([[ROOT, [makeDir('backend')]]]),
      onOpenFile,
      onToggleExpand,
    });
    const { container } = render(<FileTree {...props} />);
    const node = container.querySelector('.fp-node') as HTMLElement;
    fireEvent.click(node);
    expect(onToggleExpand).toHaveBeenCalledOnce();
    expect(onToggleExpand).toHaveBeenCalledWith(dirPath);
    expect(onOpenFile).not.toHaveBeenCalled();
  });

  it('19. Click twisty inside dir → onToggleExpand called once (propagation stopped)', () => {
    const onToggleExpand = vi.fn();
    const dirPath = `${ROOT}/backend`;
    const props = defaultProps({
      childrenByPath: new Map([[ROOT, [makeDir('backend')]]]),
      onToggleExpand,
    });
    const { container } = render(<FileTree {...props} />);
    const twisty = container.querySelector('.twisty') as HTMLElement;
    fireEvent.click(twisty);
    expect(onToggleExpand).toHaveBeenCalledOnce();
    expect(onToggleExpand).toHaveBeenCalledWith(dirPath);
  });

  it('20. Keyboard Enter on focused file node → onOpenFile called', () => {
    const onOpenFile = vi.fn();
    const props = defaultProps({
      childrenByPath: new Map([[ROOT, [makeFile('main.py')]]]),
      onOpenFile,
    });
    const { container } = render(<FileTree {...props} />);
    const node = container.querySelector('.fp-node') as HTMLElement;
    fireEvent.keyDown(node, { key: 'Enter' });
    expect(onOpenFile).toHaveBeenCalledWith(filePath);
  });

  it('21. Keyboard Space on focused dir node → onToggleExpand called', () => {
    const onToggleExpand = vi.fn();
    const dirPath = `${ROOT}/backend`;
    const props = defaultProps({
      childrenByPath: new Map([[ROOT, [makeDir('backend')]]]),
      onToggleExpand,
    });
    const { container } = render(<FileTree {...props} />);
    const node = container.querySelector('.fp-node') as HTMLElement;
    fireEvent.keyDown(node, { key: ' ' });
    expect(onToggleExpand).toHaveBeenCalledWith(dirPath);
  });
});

// ---------------------------------------------------------------------------
// Active state tests
// ---------------------------------------------------------------------------

describe('FileTree — active state', () => {
  const filePath = `${ROOT}/main.py`;
  const baseMap = new Map([[ROOT, [makeFile('main.py'), makeFile('other.ts')]]]);

  it('22. activePath === filePath → node has .active and aria-current="page"', () => {
    const props = defaultProps({
      childrenByPath: baseMap,
      activePath: filePath,
    });
    const { container } = render(<FileTree {...props} />);
    const activeNode = container.querySelector('.fp-node.active') as HTMLElement;
    expect(activeNode).not.toBeNull();
    expect(activeNode.getAttribute('aria-current')).toBe('page');
  });

  it('23. Other nodes do NOT have .active', () => {
    const props = defaultProps({
      childrenByPath: baseMap,
      activePath: filePath,
    });
    const { container } = render(<FileTree {...props} />);
    const allNodes = container.querySelectorAll('.fp-node');
    const activeNodes = container.querySelectorAll('.fp-node.active');
    expect(allNodes.length).toBeGreaterThan(1);
    expect(activeNodes).toHaveLength(1);
  });
});

// ---------------------------------------------------------------------------
// Symlink test
// ---------------------------------------------------------------------------

describe('FileTree — symlink', () => {
  it('24. symlink with isReadable:false → opacity:0.5 style and title with "symlink"', () => {
    const props = defaultProps({
      childrenByPath: new Map([
        [ROOT, [makeFile('link-to-outside', { type: 'symlink', isReadable: false })]],
      ]),
    });
    const { container } = render(<FileTree {...props} />);
    const node = container.querySelector('.fp-node') as HTMLElement;
    expect(node.style.opacity).toBe('0.5');
    expect(node.title.toLowerCase()).toContain('symlink');
  });
});

// ---------------------------------------------------------------------------
// Sort-order test
// ---------------------------------------------------------------------------

describe('FileTree — sort order', () => {
  it('25. Entries [z, a] render in that exact order (parent decides sort)', () => {
    const props = defaultProps({
      childrenByPath: new Map([
        [ROOT, [makeFile('z.py'), makeFile('a.py')]],
      ]),
    });
    const { container } = render(<FileTree {...props} />);
    const names = Array.from(container.querySelectorAll('.name')).map(n => n.textContent);
    expect(names).toEqual(['z.py', 'a.py']);
  });
});

// ---------------------------------------------------------------------------
// onContextMenu prop (A.6 addition)
// ---------------------------------------------------------------------------

describe('FileTree — onContextMenu', () => {
  it('26. Right-click on file node calls onContextMenu with correct path and kind="file"', () => {
    const onContextMenu = vi.fn();
    const filePath = `${ROOT}/main.py`;
    const props = defaultProps({
      childrenByPath: new Map([[ROOT, [makeFile('main.py')]]]),
      onContextMenu,
    });
    const { container } = render(<FileTree {...props} />);
    const node = container.querySelector('.fp-node') as HTMLElement;
    fireEvent.contextMenu(node, { clientX: 100, clientY: 200 });
    expect(onContextMenu).toHaveBeenCalledOnce();
    const [, path, kind] = onContextMenu.mock.calls[0];
    expect(path).toBe(filePath);
    expect(kind).toBe('file');
  });

  it('27. Right-click on dir node calls onContextMenu with kind="dir"', () => {
    const onContextMenu = vi.fn();
    const dirPath = `${ROOT}/src`;
    const props = defaultProps({
      childrenByPath: new Map([[ROOT, [makeDir('src')]]]),
      onContextMenu,
    });
    const { container } = render(<FileTree {...props} />);
    const node = container.querySelector('.fp-node') as HTMLElement;
    fireEvent.contextMenu(node, { clientX: 100, clientY: 200 });
    expect(onContextMenu).toHaveBeenCalledOnce();
    const [, path, kind] = onContextMenu.mock.calls[0];
    expect(path).toBe(dirPath);
    expect(kind).toBe('dir');
  });
});

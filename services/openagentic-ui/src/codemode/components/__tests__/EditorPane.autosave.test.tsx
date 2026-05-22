/**
 * EditorPane autosave / editable tests.
 *
 * - Text files mount Monaco with readOnly=false
 * - Image / PDF stay view-only (no Monaco at all)
 * - Typing fires onContentChange(path, content)
 * - Cmd/Ctrl+S calls onSave(path, content)
 * - Blur on a dirty path triggers save after debounce window
 * - Blur on a clean path does NOT trigger save
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, act } from '@testing-library/react';
import type { ReadFileResult, EditorPaneProps } from '../EditorPane';

// ---------------------------------------------------------------------------
// Capture Monaco editor & change handler
// ---------------------------------------------------------------------------
type MockEditor = {
  onDidChangeModelContent: (cb: () => void) => { dispose: () => void };
  onDidBlurEditorWidget: (cb: () => void) => { dispose: () => void };
  onDidChangeCursorPosition: (cb: (e: any) => void) => { dispose: () => void };
  addCommand: (keybinding: number, handler: () => void) => void;
  getValue: () => string;
  __setValue: (v: string) => void;
  updateOptions: (opts: any) => void;
  __triggerChange: () => void;
  __triggerBlur: () => void;
  __triggerSave: () => void;
};

let lastEditor: MockEditor | null = null;
let lastOnMount: ((editor: MockEditor, monaco: any) => void) | null = null;
let lastOptions: Record<string, unknown> | null = null;
let lastOnChange: ((value: string) => void) | null = null;

function makeMockEditor(initialValue: string): MockEditor {
  let value = initialValue;
  let blurCb: (() => void) | null = null;
  let saveHandler: (() => void) | null = null;
  return {
    onDidChangeModelContent(cb) {
      // The component's onChange flows through @monaco-editor/react's onChange,
      // not this — but Monaco has both. Keep both wired for completeness.
      return { dispose: () => {} };
    },
    onDidBlurEditorWidget(cb) {
      blurCb = cb;
      return { dispose: () => {} };
    },
    onDidChangeCursorPosition(_cb) {
      return { dispose: () => {} };
    },
    addCommand(_keybinding, handler) {
      saveHandler = handler;
    },
    getValue() {
      return value;
    },
    __setValue(v) {
      value = v;
    },
    updateOptions(_opts) {},
    __triggerChange() {
      lastOnChange?.(value);
    },
    __triggerBlur() {
      blurCb?.();
    },
    __triggerSave() {
      saveHandler?.();
    },
  };
}

// ---------------------------------------------------------------------------
// Mock @monaco-editor/react — capture onMount + onChange
// ---------------------------------------------------------------------------
vi.mock('@monaco-editor/react', () => ({
  Editor: (props: any) => {
    lastOptions = props.options;
    lastOnChange = props.onChange ?? null;
    // Fire onMount once in a microtask so React has applied state.
    if (props.onMount && !lastEditor) {
      const ed = makeMockEditor(props.value ?? '');
      lastEditor = ed;
      // Synchronous mount is fine — monaco-editor/react does it after first
      // render, but for the test we just call it.
      queueMicrotask(() => props.onMount(ed, { KeyMod: { CtrlCmd: 1 }, KeyCode: { KeyS: 2 } }));
    }
    return (
      <div
        data-testid="mock-monaco"
        data-language={props.language}
        data-theme={props.theme}
        data-readonly={String(props.options?.readOnly ?? false)}
      >
        {props.value}
      </div>
    );
  },
  loader: { config: () => {} },
}));

// Stub monaco loader so EditorPane initialization resolves with KeyMod/KeyCode
vi.mock('../../monaco/monacoLoader', () => ({
  getMonaco: vi.fn().mockResolvedValue({
    editor: {
      defineTheme: vi.fn(),
      setTheme: vi.fn(),
    },
    KeyMod: { CtrlCmd: 1 },
    KeyCode: { KeyS: 2 },
  }),
  registerCmThemes: vi.fn(),
}));

// Stub URL.createObjectURL for image branches.
vi.stubGlobal('URL', {
  createObjectURL: vi.fn().mockReturnValue('blob:test'),
  revokeObjectURL: vi.fn(),
});

vi.mock('pdfjs-dist/legacy/build/pdf.mjs', () => ({
  getDocument: vi.fn().mockReturnValue({ promise: Promise.resolve({ numPages: 1, getPage: vi.fn(), destroy: vi.fn() }) }),
  GlobalWorkerOptions: { workerSrc: '' },
  version: '5.0.0-test',
}));

// Import AFTER mocks
const { EditorPane } = await import('../EditorPane');

function makeContent(overrides: Partial<ReadFileResult> = {}): ReadFileResult {
  return {
    content: 'console.log("hi")',
    contentType: 'text/plain',
    size: 10,
    mtimeMs: Date.now(),
    sha256: 'abc',
    isBinary: false,
    ...overrides,
  };
}

function defaultProps(overrides: Partial<EditorPaneProps> = {}): EditorPaneProps {
  return {
    activePath: null,
    fileContent: null,
    error: null,
    cursorPosition: null,
    ...overrides,
  };
}

async function flushMonacoMount() {
  // Wait for getMonaco promise + onMount microtask
  await act(async () => {
    await new Promise((r) => setTimeout(r, 50));
  });
}

beforeEach(() => {
  document.documentElement.removeAttribute('data-cm-theme');
  lastEditor = null;
  lastOnMount = null;
  lastOptions = null;
  lastOnChange = null;
});

afterEach(() => {
  vi.useRealTimers();
});

describe('EditorPane — editable mode', () => {
  it('1. Mounts in editable mode (readOnly=false) for a .ts file', async () => {
    render(
      <EditorPane
        {...defaultProps({
          activePath: '/ws/util.ts',
          fileContent: makeContent({ content: 'export const x = 1;' }),
        })}
      />,
    );
    await flushMonacoMount();
    expect(lastOptions).not.toBeNull();
    expect(lastOptions?.readOnly).toBe(false);
  });

  it('2. PNG path does NOT mount Monaco at all (image viewer instead)', async () => {
    const png = btoa('PNGSTUB');
    render(
      <EditorPane
        {...defaultProps({
          activePath: '/ws/logo.png',
          fileContent: makeContent({
            isBinary: true,
            content: png,
            contentType: 'image/png',
            // @ts-expect-error
            encoding: 'base64',
          }),
        })}
      />,
    );
    await flushMonacoMount();
    // Monaco was never rendered → no options captured
    expect(lastOptions).toBeNull();
  });
});

describe('EditorPane — onContentChange', () => {
  it('3. Typing fires onContentChange(path, newContent)', async () => {
    const onContentChange = vi.fn();
    render(
      <EditorPane
        {...defaultProps({
          activePath: '/ws/util.ts',
          fileContent: makeContent({ content: 'a' }),
          onContentChange,
        })}
      />,
    );
    await flushMonacoMount();
    // Drive @monaco-editor/react's onChange directly.
    expect(lastOnChange).not.toBeNull();
    act(() => {
      lastOnChange?.('a/* edited */');
    });
    expect(onContentChange).toHaveBeenCalledWith('/ws/util.ts', 'a/* edited */');
  });
});

describe('EditorPane — Cmd+S save', () => {
  it('4. Cmd+S triggers onSave(path, content)', async () => {
    const onSave = vi.fn().mockResolvedValue(undefined);
    render(
      <EditorPane
        {...defaultProps({
          activePath: '/ws/util.ts',
          fileContent: makeContent({ content: 'hello' }),
          onSave,
        })}
      />,
    );
    await flushMonacoMount();
    // Simulate edit so editor has the latest buffer
    act(() => {
      lastEditor?.__setValue('hello world');
      lastOnChange?.('hello world');
    });
    act(() => {
      lastEditor?.__triggerSave();
    });
    expect(onSave).toHaveBeenCalledWith('/ws/util.ts', 'hello world');
  });
});

describe('EditorPane — blur autosave', () => {
  it('5. Blur on dirty path triggers onSave after debounce window', async () => {
    vi.useFakeTimers();
    const onSave = vi.fn().mockResolvedValue(undefined);
    render(
      <EditorPane
        {...defaultProps({
          activePath: '/ws/util.ts',
          fileContent: makeContent({ content: 'hello' }),
          onSave,
          isDirty: true,
        })}
      />,
    );
    // flushMonacoMount uses real timers; with fake timers we step through
    await act(async () => {
      vi.advanceTimersByTime(100);
      await Promise.resolve();
    });
    act(() => {
      lastEditor?.__setValue('hello world');
      lastOnChange?.('hello world');
    });
    // Blur immediately after typing (within debounce) → should still fire
    // since save flushes the pending dirty buffer. But spec says debounce
    // 500ms after last keystroke before considering blur a trigger. So we
    // wait the debounce, then blur.
    await act(async () => {
      vi.advanceTimersByTime(500);
    });
    act(() => {
      lastEditor?.__triggerBlur();
    });
    expect(onSave).toHaveBeenCalledWith('/ws/util.ts', 'hello world');
  });

  it('6. Blur on clean path does NOT trigger onSave', async () => {
    const onSave = vi.fn().mockResolvedValue(undefined);
    render(
      <EditorPane
        {...defaultProps({
          activePath: '/ws/util.ts',
          fileContent: makeContent({ content: 'hello' }),
          onSave,
          isDirty: false,
        })}
      />,
    );
    await flushMonacoMount();
    act(() => {
      lastEditor?.__triggerBlur();
    });
    expect(onSave).not.toHaveBeenCalled();
  });
});

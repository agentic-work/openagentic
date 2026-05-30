import '@testing-library/jest-dom';

// Mock CSS.supports for color-mix testing
Object.defineProperty(window, 'CSS', {
  value: {
    supports: (property: string, value?: string): boolean => {
      // Simulate modern browser support for color-mix
      if (value?.includes('color-mix')) {
        return true;
      }
      return true;
    },
  },
  writable: true,
});

// Mock matchMedia for responsive tests
Object.defineProperty(window, 'matchMedia', {
  value: (query: string) => ({
    matches: false,
    media: query,
    onchange: null,
    addListener: () => {},
    removeListener: () => {},
    addEventListener: () => {},
    removeEventListener: () => {},
    dispatchEvent: () => false,
  }),
  writable: true,
});

// jsdom doesn't ship ResizeObserver / DOMMatrix; ReactFlow (@xyflow/react)
// uses both during fitView/Background measurement. Polyfill with a no-op
// stub so widgets can mount in unit tests without crashing.
if (typeof globalThis.ResizeObserver === 'undefined') {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  (globalThis as any).ResizeObserver = class {
    observe() {}
    unobserve() {}
    disconnect() {}
  };
}
if (typeof globalThis.DOMMatrixReadOnly === 'undefined') {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  (globalThis as any).DOMMatrixReadOnly = class {
    m22 = 1;
    constructor(_init?: unknown) {}
  };
}

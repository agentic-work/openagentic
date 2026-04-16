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

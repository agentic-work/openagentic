// Global type augmentations and compatibility fixes
// Note: We don't redefine JSX namespace as React already provides it

// Extend existing window interface if needed
declare global {
  // Build-time platform version baked in by vite.config.ts `define`
  const __APP_VERSION__: string;

  interface Window {
    // Add any custom window properties here if needed
  }
}

// The lucide-react package already has type definitions
// We don't need to declare them here as they conflict

export {};
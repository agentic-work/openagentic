// Global type augmentations and compatibility fixes
// Note: We don't redefine JSX namespace as React already provides it

// Legacy chat-artifact accumulator. The agent-orchestration artifact_start /
// artifact_delta / artifact_end stream events accumulate HTML/React artifact
// content on `window.__pendingArtifact` (see useChatStream's artifact_* arms),
// then dispatch an `openagentic:open-canvas` CustomEvent on artifact_end.
// Narrowly typed here so the hook no longer launders it through `any`.
export interface PendingArtifact {
  /** Artifact kind — `html` | `react` | a raw language/type string. */
  type: string;
  /** Display title shown on the canvas tab. */
  title: string;
  /** Accumulated artifact body (grows across artifact_delta events). */
  content: string;
}

// Extend existing window interface if needed
declare global {
  // Build-time platform version baked in by vite.config.ts `define`
  const __APP_VERSION__: string;

  interface Window {
    /** In-flight legacy chat artifact; `null`/absent when none is streaming. */
    __pendingArtifact?: PendingArtifact | null;
  }
}

// The lucide-react package already has type definitions
// We don't need to declare them here as they conflict

export {};
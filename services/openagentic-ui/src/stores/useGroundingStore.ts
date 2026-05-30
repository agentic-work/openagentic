/**
 * Grounding Toggle Store (#940 P1, 2026-05-18)
 *
 * User-facing per-session toggle for the T1 grounding tool. When ON, the
 * chat pipeline appends a `grounding_check` tool invocation after the
 * model's final assistant text so the response is verified against fresh
 * web sources via the existing web_search MCP tool.
 *
 * State is persisted to localStorage so the toggle survives reload —
 * users who turn grounding on stay grounded. ON by default? NO — keep
 * default OFF so latency-sensitive turns aren't penalized; users opt-in
 * once and the choice persists.
 */
import { create } from 'zustand';
import { persist } from 'zustand/middleware';

interface GroundingState {
  /** When true, the next chat turn appends a grounding verification check. */
  enabled: boolean;
  toggle: () => void;
  setEnabled: (next: boolean) => void;
}

export const useGroundingStore = create<GroundingState>()(
  persist(
    (set) => ({
      enabled: false,
      toggle: () => set((s) => ({ enabled: !s.enabled })),
      setEnabled: (next: boolean) => set({ enabled: next }),
    }),
    {
      name: 'awp.grounding.v1',
      version: 1,
    },
  ),
);

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

// Persisted-key namespace. The original key carried the pre-rename `awp.`
// prefix; the canonical namespace is now `openagentic:`. We can't just rename
// it — existing users have their opt-in choice stored under the old key.
const STORAGE_KEY = 'openagentic:grounding.v1';
const LEGACY_STORAGE_KEY = 'awp.grounding.v1';

// One-time read-fallback migration: if a user previously toggled grounding,
// their choice lives under LEGACY_STORAGE_KEY. Seed the new key from it (once)
// so the preference survives the rename, then drop the stale entry. Runs at
// module load, before the store hydrates from STORAGE_KEY.
if (typeof localStorage !== 'undefined') {
  try {
    if (localStorage.getItem(STORAGE_KEY) === null) {
      const legacy = localStorage.getItem(LEGACY_STORAGE_KEY);
      if (legacy !== null) localStorage.setItem(STORAGE_KEY, legacy);
    }
    localStorage.removeItem(LEGACY_STORAGE_KEY);
  } catch {
    /* private-mode / quota — fall through to default-OFF */
  }
}

export const useGroundingStore = create<GroundingState>()(
  persist(
    (set) => ({
      enabled: false,
      toggle: () => set((s) => ({ enabled: !s.enabled })),
      setEnabled: (next: boolean) => set({ enabled: next }),
    }),
    {
      name: STORAGE_KEY,
      version: 1,
    },
  ),
);

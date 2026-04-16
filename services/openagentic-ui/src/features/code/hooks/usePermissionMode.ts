/**
 * usePermissionMode — the Shift+Tab-cycling permission mode state for
 * a CodeMode session. Persists the current mode to localStorage scoped
 * to a sessionId so a reload preserves the user's choice.
 *
 * Matches openagentic's permission mode system 1:1 (see ../permissionMode.ts).
 * The mode is sent to the backend on each prompt and translated to
 * `--permission-mode <mode>` / `--permissive` flags by the exec daemon.
 */

import { useCallback, useEffect, useState } from 'react';
import {
  getNextPermissionMode,
  PERMISSION_MODE_CONFIG,
  type PermissionMode,
  type PermissionModeConfig,
} from '../permissionMode';

const STORAGE_KEY_PREFIX = 'codemode:permissionMode:';

/**
 * Default mode for a fresh session. The exec daemon currently defaults
 * to --permissive for backwards compat, so we mirror that here to avoid
 * a silent UX shift when the user hasn't touched the pill yet.
 */
const DEFAULT_MODE: PermissionMode = 'bypassPermissions';

function readStored(sessionId: string | null): PermissionMode {
  if (!sessionId || typeof localStorage === 'undefined') return DEFAULT_MODE;
  try {
    const raw = localStorage.getItem(STORAGE_KEY_PREFIX + sessionId);
    if (raw && raw in PERMISSION_MODE_CONFIG) {
      return raw as PermissionMode;
    }
  } catch {
    /* ignore */
  }
  return DEFAULT_MODE;
}

export interface UsePermissionModeReturn {
  mode: PermissionMode;
  config: PermissionModeConfig;
  cycle: () => void;
  setMode: (m: PermissionMode) => void;
}

export function usePermissionMode(sessionId: string | null): UsePermissionModeReturn {
  const [mode, setModeState] = useState<PermissionMode>(() => readStored(sessionId));

  // Re-read storage when sessionId changes (e.g. after reconnect).
  useEffect(() => {
    setModeState(readStored(sessionId));
  }, [sessionId]);

  const persist = useCallback(
    (next: PermissionMode) => {
      if (!sessionId || typeof localStorage === 'undefined') return;
      try {
        localStorage.setItem(STORAGE_KEY_PREFIX + sessionId, next);
      } catch {
        /* ignore */
      }
    },
    [sessionId],
  );

  const cycle = useCallback(() => {
    setModeState((cur) => {
      const next = getNextPermissionMode(cur);
      persist(next);
      return next;
    });
  }, [persist]);

  const setMode = useCallback(
    (next: PermissionMode) => {
      setModeState(next);
      persist(next);
    },
    [persist],
  );

  return {
    mode,
    config: PERMISSION_MODE_CONFIG[mode],
    cycle,
    setMode,
  };
}

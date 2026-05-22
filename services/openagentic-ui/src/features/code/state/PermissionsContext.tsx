import React, { createContext, useContext } from 'react';
import type { PermissionMode } from '../permissionMode';

export interface PermissionsContextValue {
  mode: PermissionMode;
  setMode: (next: PermissionMode) => void;
}

const PermissionsContext = createContext<PermissionsContextValue | null>(null);

export const PermissionsProvider: React.FC<{
  value: PermissionsContextValue;
  children: React.ReactNode;
}> = ({ value, children }) => (
  <PermissionsContext.Provider value={value}>{children}</PermissionsContext.Provider>
);

/**
 * Returns the current permissions context, or `null` when no provider
 * is mounted (test harness / standalone Part rendering). Renderers
 * MUST be defensive — when the context is missing, just skip the
 * affordance rather than throw.
 */
export function usePermissionsContext(): PermissionsContextValue | null {
  return useContext(PermissionsContext);
}

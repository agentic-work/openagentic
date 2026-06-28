import React from 'react';
import AdminConsoleHost from '../../console/AdminConsoleHost';

/**
 * AdminPortalHost — the v4 admin console is the OSS admin surface now.
 *
 * The entry renders the ground-up `console/` rewrite (AdminConsoleHost →
 * AdminConsole). The shell-v3 host (AdminPortalHostV3) is left in the tree
 * but is no longer routed to, minimizing blast radius. The v4 console
 * sources its theme from the global token SoT ([data-theme] / [data-accent]
 * CSS vars), its auth from the OSS AuthContext via AdminConsoleHost, and its
 * data from the existing /api/admin/* endpoints via useAdminQuery.
 */
/**
 * Props are accepted for back-compat with callers (e.g. ChatContainer) that
 * still pass `theme` / `embedded` / `onClose`. The console sources its theme
 * from the global tokens and drives its own close via the UI store, so these
 * are intentionally ignored here — typing them keeps the call sites correct
 * without changing runtime behavior.
 */
export interface AdminPortalHostProps {
  theme?: 'dark' | 'light';
  embedded?: boolean;
  onClose?: () => void;
}

export default function AdminPortalHost({ onClose }: AdminPortalHostProps = {}) {
  return <AdminConsoleHost onClose={onClose} />;
}

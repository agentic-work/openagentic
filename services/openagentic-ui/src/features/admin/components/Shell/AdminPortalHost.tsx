import React from 'react';
import AdminPortalHostV3 from './AdminPortalHostV3';

/**
 * AdminPortalHost — v3 is the only admin shell now (cutover 2026-05-14).
 *
 * The v2 fallback (`?v3=0` + `aw-admin-v3=0` localStorage opt-out) was
 * removed because the legacy v1/v2 admin components (~23 files) imported
 * recharts and prevented it from being tree-shaken out of the bundle.
 * Removing the AdminShellV2 import lets Rollup eliminate the whole legacy
 * tree from the chunk graph.
 */
export default function AdminPortalHost() {
  return <AdminPortalHostV3 />;
}

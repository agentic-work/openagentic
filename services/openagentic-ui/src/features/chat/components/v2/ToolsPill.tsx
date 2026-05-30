/**
 * ToolsPill — topbar pill summarising tool-loadout.
 *
 * Mock anatomy: mocks/UX/01-cloud-ops.html:146-152 + 10-inline-visualizer-tool.html:205
 *
 *   <span class="cm-tools-pill">
 *     <span class="cm-dot" />
 *     11 internal · 158 connected
 *   </span>
 *
 * - "internal" = tier-1 tools always loaded (the v2/ToolArray T1 chips count)
 * - "connected" = tier-2/3 MCP tools available via tool_search
 *
 * Renders nothing when both counts are 0.
 */

import React from 'react';

export interface ToolsPillProps {
  internal: number;
  connected: number;
}

export function ToolsPill({ internal, connected }: ToolsPillProps) {
  if (!internal && !connected) return null;
  return (
    <span className="cm-tools-pill" data-testid="tools-pill">
      <span className="cm-dot" aria-hidden />
      <span className="cm-tools-pill-text">
        {internal > 0 && <span>{internal} internal</span>}
        {internal > 0 && connected > 0 && <span className="cm-sep" aria-hidden> · </span>}
        {connected > 0 && <span>{connected} connected</span>}
      </span>
    </span>
  );
}

/**
 * ToolArray — tool hint pill row above the assistant prose.
 *
 * Mock anatomy: mocks/UX/10-inline-visualizer-tool.html:227-241.
 *
 *   <div class="cm-tool-array">
 *     <span class="cm-label">Tools</span>
 *     <span class="cm-tool-chip cm-tier-1">
 *       <span class="cm-tier">T1</span>
 *       <span class="cm-name">visualize.show_widget</span>
 *     </span>
 *     <span class="cm-tool-chip cm-tier-2">
 *       <span class="cm-tier">T2</span>
 *       <span class="cm-name">tool_search</span>
 *       <span class="cm-count">azure (46)</span>
 *     </span>
 *   </div>
 *
 * Tier semantics (matches the chatmode-v2 design memo):
 *   - T1 = always-loaded internal tool (e.g. visualize, code_execute, web_*)
 *   - T2 = MCP tool hydrated via tool_search
 *   - T3 = skill-loaded tool
 */

import React from 'react';

export type ToolTier = 1 | 2 | 3;

export interface ToolArrayItem {
  name: string;
  tier: ToolTier;
  /** Optional count badge — used for tool_search T2 chips ("azure (46)"). */
  count?: string;
}

export interface ToolArrayProps {
  tools: ReadonlyArray<ToolArrayItem>;
  /** Override the leading label. Defaults to "Tools". */
  label?: string;
}

export function ToolArray({ tools, label = 'Tools' }: ToolArrayProps) {
  if (!tools || tools.length === 0) return null;
  return (
    <div className="cm-tool-array" data-testid="tool-array">
      <span className="cm-label">{label}</span>
      {tools.map((t, idx) => (
        <span
          key={`${t.name}-${idx}`}
          className={`cm-tool-chip cm-tier-${t.tier}`}
        >
          <span className="cm-tier">T{t.tier}</span>
          <span className="cm-name">{t.name}</span>
          {t.count && <span className="cm-count">{t.count}</span>}
        </span>
      ))}
    </div>
  );
}

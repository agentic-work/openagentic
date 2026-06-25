/**
 * StackGrid — tech-stack grid (mock 09 full-stack SaaS scaffold).
 *
 *   <div class="cm-stack-grid">
 *     <div class="cm-s">
 *       <div class="cm-role">Frontend</div>
 *       <div class="cm-t">React 18 + Vite 5</div>
 *       <div class="cm-meta">TanStack Query · Tailwind · Zustand</div>
 *     </div>
 *     ...
 *   </div>
 *
 * Auto-fills 3 columns; each cell shows the layer role / primary tech /
 * supporting libs. Used when an agent proposes a green-field architecture
 * stack and wants to summarize the choices.
 */

import React from 'react';

export interface StackLayer {
  role: string;
  tech: string;
  meta?: string;
}

export interface StackGridProps {
  layers: ReadonlyArray<StackLayer>;
}

export function StackGrid({ layers }: StackGridProps) {
  if (!layers || layers.length === 0) return null;
  return (
    <div className="cm-stack-grid" data-testid="stack-grid">
      {layers.map((l, idx) => (
        <div key={`${l.role}-${idx}`} className="cm-s">
          <div className="cm-role">{l.role}</div>
          <div className="cm-t">{l.tech}</div>
          {l.meta && <div className="cm-meta">{l.meta}</div>}
        </div>
      ))}
    </div>
  );
}

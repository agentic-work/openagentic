/**
 * PlaygroundContent — lazy-loaded agent playground.
 */

import React from 'react';

const LazyAgentPlayground = React.lazy(() =>
  import('@/features/agents/components/AgentPlayground').then(mod => ({ default: mod.AgentPlayground }))
);

export const PlaygroundContent: React.FC = () => (
  <React.Suspense
    fallback={
      <div className="py-12 text-center text-sm" style={{ color: 'var(--color-text-tertiary)' }}>
        Loading Agent Playground...
      </div>
    }
  >
    <LazyAgentPlayground />
  </React.Suspense>
);

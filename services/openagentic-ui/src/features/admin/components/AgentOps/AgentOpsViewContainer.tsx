/**
 * AgentOpsViewContainer — wraps the pure AgentOpsView with the
 * fleet-metrics fetch hook so the admin shell can render it without
 * thread the data manually. Keeps AgentOpsView unit-testable in
 * isolation (no fetch dependency).
 */
import React from 'react';
import { AgentOpsView } from './AgentOpsView';
import { useAgentOpsMetrics } from './useAgentOpsMetrics';

export const AgentOpsViewContainer: React.FC = () => {
  const { agents, runs, loading } = useAgentOpsMetrics();

  // No-op selection handlers for now — agent + run drill-downs are a
  // follow-up. Both will deep-link into AgentObservability or the
  // signed-trace viewer once those land.
  const onSelectAgent = (_agentId: string) => {};
  const onSelectRun   = (_runId: string)   => {};

  return (
    <AgentOpsView
      agents={agents}
      runs={runs}
      loading={loading}
      onSelectAgent={onSelectAgent}
      onSelectRun={onSelectRun}
    />
  );
};

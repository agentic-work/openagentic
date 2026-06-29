/**
 * Stub AgentRegistry for workflow service.
 * Matches the interface the WorkflowExecutionEngine expects.
 */

export class AgentRegistry {
  executionId: string = '';

  startExecution(..._args: any[]): any { return this; }
  recordNodeExecution(..._args: any[]): void {}
  completeExecution(..._args: any[]): void {}
  recordToolCall(..._args: any[]): void {}
  [key: string]: any;
}

const noopRegistry = new AgentRegistry();

export function getAgentRegistry(): AgentRegistry {
  return noopRegistry;
}

/**
 * Copyright 2026 Gnomus.ai
 *
 * Licensed under the Apache License, Version 2.0 (the "License");
 * you may not use this file except in compliance with the License.
 * You may obtain a copy of the License at
 *
 *     http://www.apache.org/licenses/LICENSE-2.0
 *
 * Unless required by applicable law or agreed to in writing, software
 * distributed under the License is distributed on an "AS IS" BASIS,
 * WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
 * See the License for the specific language governing permissions and
 * limitations under the License.
 */

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

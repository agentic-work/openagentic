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

import { v4 as uuidv4 } from 'uuid';
import { AgentRunner, type AgentResult, type RunContext } from './AgentRunner';
import { CostTracker } from './CostTracker';
import { MCPBridge } from '../tools/MCPBridge';
import { logger } from '../utils/logger';

interface BackgroundAgentConfig {
  type: string;       // 'artifact' | 'diagram' | 'fact_check' | 'grounding'
  model: string;
  systemPrompt: string;
  tools: string[];
  maxTurns: number;
  timeout: number;
  costBudget: number;
}

interface BackgroundResult {
  id: string;
  sessionId: string;
  userId: string;
  agentType: string;
  triggerMessageId?: string;
  resultType: string;
  resultData: any;
  confidence?: number;
  status: string;
}

// model: 'auto' → SmartModelRouter selects based on intelligence slider + available providers
// Background agents are lightweight tasks — SmartRouter will pick a fast/cheap model automatically
const BACKGROUND_AGENTS: Record<string, BackgroundAgentConfig> = {
  artifact: {
    type: 'artifact',
    model: 'auto',
    systemPrompt: 'You are an artifact generator. When given code blocks, validate syntax, suggest improvements, and format as clean code artifacts.',
    tools: [],
    maxTurns: 1,
    timeout: 15000,
    costBudget: 5, // 5 cents max
  },
  diagram: {
    type: 'diagram',
    model: 'auto',
    systemPrompt: 'You are a diagram agent. When given a discussion about architecture or flows, generate a Mermaid diagram that visualizes the described system.',
    tools: [],
    maxTurns: 1,
    timeout: 15000,
    costBudget: 5,
  },
  fact_check: {
    type: 'fact_check',
    model: 'auto',
    systemPrompt: 'You are a fact-checker. Analyze the given claims for accuracy. Return a JSON array of { claim, confidence, source } objects.',
    tools: ['web_search'],
    maxTurns: 2,
    timeout: 30000,
    costBudget: 10,
  },
};

export class BackgroundAgentManager {
  private mcpBridge: MCPBridge;
  private apiUrl: string;
  private activeAgents: Map<string, { sessionId: string; type: string }> = new Map();

  constructor(mcpBridge: MCPBridge, apiUrl: string) {
    this.mcpBridge = mcpBridge;
    this.apiUrl = apiUrl;
  }

  async runBackground(
    agentType: string,
    input: string,
    sessionId: string,
    userId: string,
    ctx: RunContext,
    triggerMessageId?: string
  ): Promise<BackgroundResult | null> {
    const config = BACKGROUND_AGENTS[agentType];
    if (!config) {
      logger.warn({ agentType }, 'Unknown background agent type');
      return null;
    }

    // Rate limit: one per agent type per session
    const key = `${sessionId}:${agentType}`;
    if (this.activeAgents.has(key)) {
      logger.debug({ key }, 'Background agent already running for this session');
      return null;
    }
    this.activeAgents.set(key, { sessionId, type: agentType });

    const costTracker = new CostTracker(config.costBudget);
    const runner = new AgentRunner(this.mcpBridge, costTracker, this.apiUrl);
    const agentId = `bg_${agentType}_${uuidv4().substring(0, 8)}`;

    try {
      costTracker.setAgentBudget(agentId, config.costBudget);

      const result = await runner.run(
        {
          agentId,
          role: 'custom',
          task: input,
          model: config.model,
          tools: config.tools,
          maxTurns: config.maxTurns,
          timeout: config.timeout,
          systemPrompt: config.systemPrompt,
        },
        // Background agents don't emit to SSE
        (_event: string, _data: any) => {},
        ctx
      );

      const bgResult: BackgroundResult = {
        id: uuidv4(),
        sessionId,
        userId,
        agentType,
        triggerMessageId,
        resultType: this.getResultType(agentType),
        resultData: { output: result.output, metrics: result.metrics },
        confidence: agentType === 'fact_check' ? this.parseConfidence(result.output) : undefined,
        status: result.status === 'success' ? 'completed' : 'failed',
      };

      return bgResult;
    } catch (error: any) {
      logger.error({ agentType, error: error.message }, 'Background agent failed');
      return null;
    } finally {
      this.activeAgents.delete(key);
    }
  }

  private getResultType(agentType: string): string {
    switch (agentType) {
      case 'artifact': return 'code_artifact';
      case 'diagram': return 'mermaid_diagram';
      case 'fact_check': return 'confidence_map';
      case 'grounding': return 'context';
      default: return 'generic';
    }
  }

  private parseConfidence(output: string): number | undefined {
    try {
      const parsed = JSON.parse(output);
      if (Array.isArray(parsed)) {
        const confidences = parsed.map((p: any) => p.confidence || 0);
        return confidences.reduce((s: number, c: number) => s + c, 0) / confidences.length;
      }
    } catch {}
    return undefined;
  }

  getActiveAgents(): Array<{ sessionId: string; type: string }> {
    return Array.from(this.activeAgents.values());
  }
}

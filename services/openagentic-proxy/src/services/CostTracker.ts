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

import { logger } from '../utils/logger';

// Approximate costs per 1K tokens (in cents) — kept simple, production should use provider-specific pricing
const MODEL_COSTS: Record<string, { input: number; output: number }> = {
  // Claude
  'claude-opus-4-6': { input: 1.5, output: 7.5 },
  'claude-sonnet-4-6': { input: 0.3, output: 1.5 },
  'claude-haiku-4-5': { input: 0.08, output: 0.4 },
  // GPT
  'gpt-4o': { input: 0.25, output: 1.0 },
  'gpt-4o-mini': { input: 0.015, output: 0.06 },
  // Defaults
  'default': { input: 0.3, output: 1.5 },
};

interface CostEntry {
  agentId: string;
  model: string;
  inputTokens: number;
  outputTokens: number;
  costCents: number;
  timestamp: number;
}

export class CostTracker {
  private entries: CostEntry[] = [];
  private totalBudgetCents: number;
  private perAgentBudgets: Map<string, number> = new Map();

  constructor(totalBudgetCents?: number) {
    this.totalBudgetCents = totalBudgetCents || Infinity;
  }

  setAgentBudget(agentId: string, budgetCents: number): void {
    this.perAgentBudgets.set(agentId, budgetCents);
  }

  track(agentId: string, model: string, inputTokens: number, outputTokens: number): CostEntry {
    const pricing = this.getModelPricing(model);
    const costCents = (inputTokens / 1000) * pricing.input + (outputTokens / 1000) * pricing.output;

    const entry: CostEntry = {
      agentId,
      model,
      inputTokens,
      outputTokens,
      costCents,
      timestamp: Date.now(),
    };
    this.entries.push(entry);
    return entry;
  }

  getTotalCost(): number {
    return this.entries.reduce((sum, e) => sum + e.costCents, 0);
  }

  getAgentCost(agentId: string): number {
    return this.entries.filter(e => e.agentId === agentId).reduce((sum, e) => sum + e.costCents, 0);
  }

  isBudgetExceeded(): boolean {
    return this.getTotalCost() >= this.totalBudgetCents;
  }

  isAgentBudgetExceeded(agentId: string): boolean {
    const budget = this.perAgentBudgets.get(agentId);
    if (budget === undefined) return false;
    return this.getAgentCost(agentId) >= budget;
  }

  getMetrics(): {
    totalCostCents: number;
    totalInputTokens: number;
    totalOutputTokens: number;
    perAgent: Record<string, { costCents: number; inputTokens: number; outputTokens: number }>;
  } {
    const perAgent: Record<string, { costCents: number; inputTokens: number; outputTokens: number }> = {};
    for (const entry of this.entries) {
      if (!perAgent[entry.agentId]) {
        perAgent[entry.agentId] = { costCents: 0, inputTokens: 0, outputTokens: 0 };
      }
      perAgent[entry.agentId].costCents += entry.costCents;
      perAgent[entry.agentId].inputTokens += entry.inputTokens;
      perAgent[entry.agentId].outputTokens += entry.outputTokens;
    }

    return {
      totalCostCents: this.getTotalCost(),
      totalInputTokens: this.entries.reduce((s, e) => s + e.inputTokens, 0),
      totalOutputTokens: this.entries.reduce((s, e) => s + e.outputTokens, 0),
      perAgent,
    };
  }

  private getModelPricing(model: string): { input: number; output: number } {
    // Try exact match first
    if (MODEL_COSTS[model]) return MODEL_COSTS[model];
    // Try prefix match
    for (const [key, pricing] of Object.entries(MODEL_COSTS)) {
      if (model.includes(key)) return pricing;
    }
    return MODEL_COSTS['default'];
  }
}

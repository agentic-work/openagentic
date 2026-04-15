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
 * Agent Orchestration Documentation Generator
 *
 * Parses AgentOrchestrator.ts from the openagentic-proxy service to extract:
 * - Orchestration patterns (parallel, sequential, supervisor, hierarchical)
 * - Aggregation strategies (merge, synthesize, first, vote)
 * - ExecuteRequest and ExecutionState interfaces
 * - Default models and system prompts per role
 * - Class methods and lifecycle management
 */

import type { DocManifest, DocItem, DocSection } from './types.js';
import { readFileIfExists, svcPath, relativePath, regexMatchAll, getLineNumber } from './utils.js';

export async function generateAgentOrchestration(basePath: string): Promise<DocManifest | null> {
  const filePath = svcPath(basePath, 'openagentic-proxy', 'src', 'services', 'AgentOrchestrator.ts');
  const content = await readFileIfExists(filePath);
  if (!content) return null;

  const sourceFiles = [relativePath(filePath, basePath)];
  const sections: DocSection[] = [];

  // --- Section 1: Orchestration Patterns ---
  const orchestrationItems: DocItem[] = [];
  const orchMatch = content.match(/orchestration:\s*([^;]+);/);
  if (orchMatch) {
    const patterns = orchMatch[1].match(/'([^']+)'/g);
    if (patterns) {
      const descriptions: Record<string, string> = {
        'parallel': 'All agents run concurrently, results aggregated after all complete',
        'sequential': 'Agents run one after another, each receiving prior results',
        'supervisor': 'A supervisor agent dynamically selects and delegates to worker agents',
        'hierarchical': 'Multi-level agent tree with planning, execution, and validation layers',
      };
      for (const p of patterns) {
        const name = p.replace(/'/g, '');
        orchestrationItems.push({
          id: `orch-${name}`,
          name,
          description: descriptions[name] || `Orchestration pattern: ${name}`,
          type: 'orchestration-pattern',
        });
      }
    }
  }

  sections.push({
    id: 'orchestration-patterns',
    title: 'Orchestration Patterns',
    description: 'Multi-agent execution patterns supported by the AgentOrchestrator.',
    adminOnly: false,
    items: orchestrationItems,
  });

  // --- Section 2: Aggregation Strategies ---
  const aggregationItems: DocItem[] = [];
  const aggMatch = content.match(/aggregation:\s*([^;]+);/);
  if (aggMatch) {
    const strategies = aggMatch[1].match(/'([^']+)'/g);
    if (strategies) {
      const descriptions: Record<string, string> = {
        'merge': 'Concatenate all agent outputs into a single response',
        'synthesize': 'Use an LLM to synthesize a unified response from all outputs',
        'first': 'Return the first successful agent result',
        'vote': 'Use consensus voting across agent outputs',
      };
      for (const s of strategies) {
        const name = s.replace(/'/g, '');
        aggregationItems.push({
          id: `agg-${name}`,
          name,
          description: descriptions[name] || `Aggregation strategy: ${name}`,
          type: 'aggregation-strategy',
        });
      }
    }
  }

  sections.push({
    id: 'aggregation-strategies',
    title: 'Aggregation Strategies',
    description: 'How multi-agent results are combined into a final output.',
    adminOnly: false,
    items: aggregationItems,
  });

  // --- Section 3: ExecuteRequest Interface ---
  const requestFields: DocItem[] = [];
  const requestBlock = content.match(/export interface ExecuteRequest\s*\{([\s\S]*?)\}/);
  if (requestBlock) {
    const fieldPattern = /(\w+)(\?)?:\s*([^;]+);\s*(?:\/\/\s*(.+))?/g;
    for (const match of regexMatchAll(requestBlock[1], fieldPattern)) {
      requestFields.push({
        id: `req-${match[1]}`,
        name: match[1],
        description: match[4]?.trim() || `${match[3].trim()} field`,
        type: 'interface-field',
        properties: { type: match[3].trim(), optional: !!match[2] },
      });
    }
  }

  sections.push({
    id: 'execute-request',
    title: 'Execute Request Schema',
    description: 'The ExecuteRequest interface for triggering multi-agent execution.',
    adminOnly: false,
    items: requestFields,
  });

  // --- Section 4: ExecutionState ---
  const stateFields: DocItem[] = [];
  const stateBlock = content.match(/export interface ExecutionState\s*\{([\s\S]*?)\}/);
  if (stateBlock) {
    const fieldPattern = /(\w+)(\?)?:\s*([^;]+);\s*$/gm;
    for (const match of regexMatchAll(stateBlock[1], fieldPattern)) {
      stateFields.push({
        id: `state-${match[1]}`,
        name: match[1],
        description: match[3].trim(),
        type: 'interface-field',
      });
    }
  }

  sections.push({
    id: 'execution-state',
    title: 'Execution State',
    description: 'Runtime state tracked for each multi-agent execution.',
    adminOnly: false,
    items: stateFields,
  });

  // --- Section 5: Default Models per Role ---
  const modelItems: DocItem[] = [];
  const modelsBlock = content.match(/const DEFAULT_MODELS[\s\S]*?\{([\s\S]*?)\}/);
  if (modelsBlock) {
    const modelPattern = /(\w+):\s*(\w+)/g;
    for (const match of regexMatchAll(modelsBlock[1], modelPattern)) {
      modelItems.push({
        id: `model-${match[1]}`,
        name: match[1],
        description: `Default model variable: ${match[2]}`,
        type: 'role-model',
        properties: { variable: match[2] },
      });
    }
  }

  sections.push({
    id: 'default-models',
    title: 'Default Models per Role',
    description: 'Model assignments for each agent role, configurable via AGENT_DEFAULT_MODEL env var.',
    adminOnly: true,
    items: modelItems,
  });

  // --- Section 6: Default System Prompts ---
  const promptItems: DocItem[] = [];
  const promptsBlock = content.match(/const DEFAULT_PROMPTS[\s\S]*?\{([\s\S]*?)\n\};/);
  if (promptsBlock) {
    const promptPattern = /(\w+):\s*['"`]/g;
    for (const match of regexMatchAll(promptsBlock[1], promptPattern)) {
      promptItems.push({
        id: `prompt-${match[1]}`,
        name: match[1],
        description: `System prompt template for ${match[1].replace(/_/g, ' ')} role`,
        type: 'system-prompt',
        sourceLine: getLineNumber(content, match.index),
        sourceFile: sourceFiles[0],
      });
    }
  }

  sections.push({
    id: 'default-prompts',
    title: 'Default System Prompts',
    description: 'Built-in system prompts for each agent role, used when no custom prompt is configured.',
    adminOnly: true,
    items: promptItems,
  });

  // --- Section 7: Adaptive Turn Limits ---
  const turnItems: DocItem[] = [];
  const turnsBlock = content.match(/const ADAPTIVE_TURNS[\s\S]*?\{([\s\S]*?)\}/);
  if (turnsBlock) {
    const turnPattern = /(\w+):\s*(\d+),?\s*(?:\/\/\s*(.+))?/g;
    for (const match of regexMatchAll(turnsBlock[1], turnPattern)) {
      turnItems.push({
        id: `turns-${match[1]}`,
        name: match[1],
        description: match[3]?.trim() || `Max ${match[2]} turns`,
        type: 'turn-limit',
        properties: { maxTurns: parseInt(match[2], 10) },
      });
    }
  }

  if (turnItems.length > 0) {
    sections.push({
      id: 'adaptive-turns',
      title: 'Adaptive Turn Limits',
      description: 'Per-role maximum tool call rounds before forcing synthesis.',
      adminOnly: true,
      items: turnItems,
    });
  }

  // --- Section 8: Class Methods ---
  const methodItems: DocItem[] = [];
  const methodPattern = /(?:private|public|protected)?\s*(?:async\s+)?(\w+)\s*\([^)]*\)\s*(?::\s*[^{]+)?\s*\{/g;
  const classBlock = content.match(/export class AgentOrchestrator[\s\S]*/);
  if (classBlock) {
    const seenMethods = new Set<string>();
    for (const match of regexMatchAll(classBlock[0], methodPattern)) {
      const methodName = match[1];
      if (methodName === 'constructor' || seenMethods.has(methodName)) continue;
      seenMethods.add(methodName);
      methodItems.push({
        id: `method-${methodName}`,
        name: methodName,
        description: `AgentOrchestrator method`,
        type: 'method',
      });
    }
  }

  if (methodItems.length > 0) {
    sections.push({
      id: 'orchestrator-methods',
      title: 'Orchestrator Methods',
      description: 'Public and private methods on the AgentOrchestrator class.',
      adminOnly: true,
      items: methodItems,
    });
  }

  return {
    domain: 'agent-orchestration',
    title: 'Agent Orchestration',
    description: `Multi-agent orchestration with ${orchestrationItems.length} execution patterns, ${aggregationItems.length} aggregation strategies, and adaptive turn limits per role.`,
    icon: 'agent',
    category: 'agents',
    generatedAt: new Date().toISOString(),
    sourceFiles,
    sections,
  };
}

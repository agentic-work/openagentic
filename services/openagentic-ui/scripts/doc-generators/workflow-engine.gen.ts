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
 * Workflow Engine Documentation Generator
 *
 * Parses WorkflowExecutionEngine.ts and nodeConfigs.ts to extract:
 * - All workflow node types with labels, descriptions, categories
 * - Engine interfaces (WorkflowNode, WorkflowEdge, ExecutionContext, etc.)
 * - Error recovery, retry, and fallback configuration
 * - Approval configuration
 */

import type { DocManifest, DocItem, DocSection } from './types.js';
import { readFileIfExists, svcPath, relativePath, regexMatchAll, getLineNumber } from './utils.js';

export async function generateWorkflowEngine(basePath: string): Promise<DocManifest | null> {
  const enginePath = svcPath(basePath, 'openagentic-workflows', 'src', 'services', 'WorkflowExecutionEngine.ts');
  const engineContent = await readFileIfExists(enginePath);
  if (!engineContent) return null;

  const nodeConfigPath = svcPath(basePath, 'openagentic-ui', 'src', 'features', 'workflows', 'utils', 'nodeConfigs.ts');
  const nodeConfigContent = await readFileIfExists(nodeConfigPath);

  const sourceFiles = [relativePath(enginePath, basePath)];
  if (nodeConfigContent) sourceFiles.push(relativePath(nodeConfigPath, basePath));

  const sections: DocSection[] = [];

  // --- Section 1-N: Node Types by Category (from nodeConfigs.ts) ---
  if (nodeConfigContent) {
    // Parse all node type entries
    const nodePattern = /(\w+):\s*\{[^}]*type:\s*'([^']+)'[^}]*label:\s*'([^']+)'[^}]*description:\s*'([^']+)'[^}]*category:\s*'([^']+)'/g;
    const nodesByCategory = new Map<string, DocItem[]>();

    for (const match of regexMatchAll(nodeConfigContent, nodePattern)) {
      const nodeKey = match[1];
      const nodeType = match[2];
      const label = match[3];
      const description = match[4];
      const category = match[5];

      if (!nodesByCategory.has(category)) {
        nodesByCategory.set(category, []);
      }

      nodesByCategory.get(category)!.push({
        id: `node-${nodeType}`,
        name: label,
        description,
        type: 'workflow-node',
        properties: { nodeType, category },
        sourceFile: sourceFiles[1],
      });
    }

    const categoryLabels: Record<string, string> = {
      trigger: 'Trigger Nodes',
      ai: 'AI / LLM Nodes',
      action: 'Action Nodes',
      logic: 'Logic Nodes',
      data: 'Data Nodes',
      approval: 'Approval Nodes',
      agents: 'Agent Framework Nodes',
      integration: 'Integration Nodes',
    };

    const categoryDescriptions: Record<string, string> = {
      trigger: 'Entry points that start workflow execution.',
      ai: 'Nodes that invoke language models for completion, reasoning, and multi-agent orchestration.',
      action: 'Nodes that execute external actions: MCP tools, code, HTTP requests.',
      logic: 'Control flow: conditions, loops, switches, waits, parallel branches.',
      data: 'Data manipulation: transforms, merges, RAG queries, embeddings, vector store operations.',
      approval: 'Human-in-the-loop gates that pause execution pending approval.',
      agents: 'Multi-agent orchestration nodes: agent pools, supervisors, and delegation.',
      integration: 'Third-party integrations: Slack, Teams, Email, PagerDuty, ServiceNow, Jira, Discord.',
    };

    const categoryOrder = ['trigger', 'ai', 'action', 'logic', 'data', 'approval', 'agents', 'integration'];
    for (const cat of categoryOrder) {
      const items = nodesByCategory.get(cat);
      if (items && items.length > 0) {
        sections.push({
          id: `nodes-${cat}`,
          title: categoryLabels[cat] || cat,
          description: `${categoryDescriptions[cat] || ''} (${items.length} nodes)`,
          adminOnly: false,
          items,
        });
      }
    }

    // Catch any categories not in our predefined order
    for (const [cat, items] of nodesByCategory) {
      if (!categoryOrder.includes(cat) && items.length > 0) {
        sections.push({
          id: `nodes-${cat}`,
          title: `${cat.charAt(0).toUpperCase() + cat.slice(1)} Nodes`,
          description: `${items.length} node(s) in the ${cat} category.`,
          adminOnly: false,
          items,
        });
      }
    }
  }

  // --- Section: Engine Interfaces ---
  const interfaceNames = [
    'WorkflowNode', 'WorkflowEdge', 'WorkflowDefinition',
    'ExecutionContext', 'NodeExecutionResult', 'ExecutionEvent',
  ];

  for (const ifName of interfaceNames) {
    const ifBlock = engineContent.match(new RegExp(`export interface ${ifName}\\s*\\{([\\s\\S]*?)\\}`));
    if (ifBlock) {
      const fields: DocItem[] = [];
      const fieldPattern = /(\w+)(\?)?:\s*([^;]+);\s*(?:\/\/\s*(.+))?/g;
      for (const match of regexMatchAll(ifBlock[1], fieldPattern)) {
        fields.push({
          id: `${ifName.toLowerCase()}-${match[1]}`,
          name: match[1],
          description: match[4]?.trim() || match[3].trim(),
          type: 'interface-field',
          properties: { type: match[3].trim(), optional: !!match[2] },
        });
      }
      if (fields.length > 0) {
        sections.push({
          id: `interface-${ifName.toLowerCase()}`,
          title: ifName,
          description: `Engine interface: ${ifName}`,
          adminOnly: false,
          items: fields,
        });
      }
    }
  }

  // --- Section: Error Recovery Config ---
  const retryFields: DocItem[] = [];
  const retryBlock = engineContent.match(/export interface RetryConfig\s*\{([\s\S]*?)\}/);
  if (retryBlock) {
    const fieldPattern = /(\w+)(\?)?:\s*([^;]+);\s*(?:\/\/\s*(.+))?/g;
    for (const match of regexMatchAll(retryBlock[1], fieldPattern)) {
      retryFields.push({
        id: `retry-${match[1]}`,
        name: match[1],
        description: match[4]?.trim() || match[3].trim(),
        type: 'config-field',
        properties: { type: match[3].trim() },
      });
    }
  }

  const fallbackFields: DocItem[] = [];
  const fallbackBlock = engineContent.match(/export interface FallbackConfig\s*\{([\s\S]*?)\}/);
  if (fallbackBlock) {
    const fieldPattern = /(\w+)(\?)?:\s*([^;]+);\s*(?:\/\/\s*(.+))?/g;
    for (const match of regexMatchAll(fallbackBlock[1], fieldPattern)) {
      fallbackFields.push({
        id: `fallback-${match[1]}`,
        name: match[1],
        description: match[4]?.trim() || match[3].trim(),
        type: 'config-field',
        properties: { type: match[3].trim() },
      });
    }
  }

  const errorRecoveryItems = [...retryFields, ...fallbackFields];
  if (errorRecoveryItems.length > 0) {
    sections.push({
      id: 'error-recovery',
      title: 'Error Recovery Configuration',
      description: 'Retry, fallback, and circuit breaker settings for workflow node execution.',
      adminOnly: true,
      items: errorRecoveryItems,
    });
  }

  // --- Section: Approval Config ---
  const approvalFields: DocItem[] = [];
  const approvalBlock = engineContent.match(/export interface ApprovalConfig\s*\{([\s\S]*?)\}/);
  if (approvalBlock) {
    const fieldPattern = /(\w+)(\?)?:\s*([^;]+);\s*(?:\/\/\s*(.+))?/g;
    for (const match of regexMatchAll(approvalBlock[1], fieldPattern)) {
      approvalFields.push({
        id: `approval-${match[1]}`,
        name: match[1],
        description: match[4]?.trim() || match[3].trim(),
        type: 'config-field',
        properties: { type: match[3].trim() },
      });
    }
  }

  if (approvalFields.length > 0) {
    sections.push({
      id: 'approval-config',
      title: 'Approval Configuration',
      description: 'Human-in-the-loop approval settings for workflow execution gates.',
      adminOnly: false,
      items: approvalFields,
    });
  }

  // Count total node types
  const totalNodes = sections
    .filter(s => s.id.startsWith('nodes-'))
    .reduce((sum, s) => sum + s.items.length, 0);

  return {
    domain: 'workflow-engine',
    title: 'Workflow Engine',
    description: `Workflow execution engine with ${totalNodes} node types across ${sections.filter(s => s.id.startsWith('nodes-')).length} categories, supporting retry, fallback, circuit breakers, and human approval gates.`,
    icon: 'flow',
    category: 'workflows',
    generatedAt: new Date().toISOString(),
    sourceFiles,
    sections,
  };
}

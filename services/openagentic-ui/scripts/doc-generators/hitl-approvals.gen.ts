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
 * HITL Approvals Documentation Generator
 *
 * Parses PendingApprovalStore.ts to extract:
 * - ApprovalResult interface
 * - PendingApprovalStore class methods
 * - Approval flow (create, resolve, timeout)
 * - Singleton access pattern
 */

import type { DocManifest, DocItem, DocSection } from './types.js';
import { readFileIfExists, svcPath, relativePath, regexMatchAll, getLineNumber } from './utils.js';

export async function generateHitlApprovals(basePath: string): Promise<DocManifest | null> {
  const filePath = svcPath(basePath, 'openagentic-api', 'src', 'services', 'PendingApprovalStore.ts');
  const content = await readFileIfExists(filePath);
  if (!content) return null;

  const sourceFiles = [relativePath(filePath, basePath)];
  const sections: DocSection[] = [];

  // --- Section 1: ApprovalResult Interface ---
  const resultFields: DocItem[] = [];
  const resultBlock = content.match(/export interface ApprovalResult\s*\{([\s\S]*?)\}/);
  if (resultBlock) {
    const fieldPattern = /(\w+)(\?)?:\s*([^;]+);\s*(?:\/\/\s*(.+))?/g;
    for (const match of regexMatchAll(resultBlock[1], fieldPattern)) {
      resultFields.push({
        id: `result-${match[1]}`,
        name: match[1],
        description: match[4]?.trim() || `${match[3].trim()} field`,
        type: 'interface-field',
        properties: { type: match[3].trim(), optional: !!match[2] },
      });
    }
  }

  sections.push({
    id: 'approval-result',
    title: 'Approval Result',
    description: 'The ApprovalResult interface returned when an approval is resolved or times out.',
    adminOnly: false,
    items: resultFields,
  });

  // --- Section 2: Approval Flow ---
  const flowItems: DocItem[] = [];

  // Extract the create method signature and default timeout
  const createMatch = content.match(/create\((\w+):\s*\w+,\s*(\w+):\s*\w+\s*=\s*(\d+)\)/);
  if (createMatch) {
    const defaultTimeout = parseInt(createMatch[3], 10);
    flowItems.push({
      id: 'flow-create',
      name: 'Create Approval',
      description: `Create a pending approval with a configurable timeout (default: ${defaultTimeout / 1000}s / ${defaultTimeout / 60000} minutes)`,
      type: 'flow-step',
      properties: { defaultTimeoutMs: defaultTimeout, step: 1 },
    });
  }

  // Extract ID format
  const idFormatMatch = content.match(/const id = `([^`]+)`/);
  if (idFormatMatch) {
    flowItems.push({
      id: 'flow-id-format',
      name: 'Approval ID Format',
      description: `Generated ID format: ${idFormatMatch[1].replace(/\$\{[^}]+\}/g, '<dynamic>')}`,
      type: 'flow-detail',
      properties: { format: idFormatMatch[1] },
    });
  }

  // Resolve step
  flowItems.push({
    id: 'flow-resolve',
    name: 'Resolve Approval',
    description: 'Resolve a pending approval as approved or denied. Returns false if already resolved or timed out.',
    type: 'flow-step',
    properties: { step: 2 },
  });

  // Timeout step
  flowItems.push({
    id: 'flow-timeout',
    name: 'Timeout Handling',
    description: 'When an approval times out, it auto-resolves as not approved with timedOut=true.',
    type: 'flow-step',
    properties: { step: 3 },
  });

  sections.push({
    id: 'approval-flow',
    title: 'Approval Flow',
    description: 'The lifecycle of a human-in-the-loop approval: create, wait, resolve or timeout.',
    adminOnly: false,
    items: flowItems,
  });

  // --- Section 3: Store Methods ---
  const methodItems: DocItem[] = [];
  const classBlock = content.match(/export class PendingApprovalStore[\s\S]*/);
  if (classBlock) {
    // Match methods with JSDoc
    const methodPattern = /(?:\/\*\*\s*([\s\S]*?)\s*\*\/\s*)?(\w+)\s*\(([^)]*)\)\s*(?::\s*([^{]+))?\s*\{/g;
    const seenMethods = new Set<string>();
    for (const match of regexMatchAll(classBlock[0], methodPattern)) {
      const name = match[2];
      if (name === 'constructor' || seenMethods.has(name)) continue;
      seenMethods.add(name);
      const jsdoc = match[1]?.replace(/\s*\*\s*/g, ' ').trim() || '';
      const params = match[3].trim();
      const returnType = match[4]?.trim() || '';
      methodItems.push({
        id: `method-${name}`,
        name,
        description: jsdoc || `Store method`,
        type: 'method',
        properties: {
          params: params || 'none',
          returns: returnType || 'void',
        },
        sourceLine: getLineNumber(content, match.index),
        sourceFile: sourceFiles[0],
      });
    }
  }

  // Also capture the getter
  const getterPattern = /get (\w+)\(\)\s*:\s*(\w+)/g;
  for (const match of regexMatchAll(content, getterPattern)) {
    methodItems.push({
      id: `getter-${match[1]}`,
      name: match[1],
      description: `Getter returning ${match[2]}`,
      type: 'getter',
      properties: { returns: match[2] },
    });
  }

  sections.push({
    id: 'store-methods',
    title: 'Store API',
    description: 'Methods on the PendingApprovalStore class.',
    adminOnly: false,
    items: methodItems,
  });

  // --- Section 4: Singleton Access ---
  const singletonItems: DocItem[] = [];
  const singletonMatch = content.match(/export function (\w+)\(\)\s*:\s*(\w+)/);
  if (singletonMatch) {
    singletonItems.push({
      id: 'singleton-getter',
      name: singletonMatch[1],
      description: `Returns the singleton ${singletonMatch[2]} instance. Creates one on first call.`,
      type: 'function',
      properties: { returns: singletonMatch[2] },
    });
  }

  if (singletonItems.length > 0) {
    sections.push({
      id: 'singleton-access',
      title: 'Singleton Access',
      description: 'The PendingApprovalStore is a singleton, shared across all pipeline stages.',
      adminOnly: false,
      items: singletonItems,
    });
  }

  return {
    domain: 'hitl-approvals',
    title: 'HITL Approvals',
    description: 'Human-in-the-loop approval store for tool call gating with timeout, resolve, and cleanup lifecycle.',
    icon: 'shield',
    category: 'core',
    generatedAt: new Date().toISOString(),
    sourceFiles,
    sections,
  };
}

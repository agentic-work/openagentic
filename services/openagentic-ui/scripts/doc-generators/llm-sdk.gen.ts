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
 * OpenAgentic LLM SDK Documentation Generator
 *
 * Scans the companion sdk project's compiled type definitions to extract:
 * - Client API (public methods on the main client class)
 * - Resources (API namespace classes like messages, completions)
 * - Types (exported interfaces and type aliases)
 * - Provider adapters (Bedrock, Vertex, etc.)
 */

import type { DocManifest, DocItem, DocSection } from './types.js';
import { readFileIfExists, relativePath, getLineNumber, regexMatchAll, findFiles, companionPath } from './utils.js';

export async function generateLlmSdk(basePath: string): Promise<DocManifest | null> {
  const sdkRoot = companionPath(basePath, 'sdk');
  const distDir = companionPath(basePath, 'sdk', 'dist');

  const dtsFiles = await findFiles(distDir, /\.d\.ts$/);
  if (dtsFiles.length === 0) return null;

  const sourceFiles: string[] = [];
  const sections: DocSection[] = [];

  // --- Section 1: Client API ---
  const clientItems: DocItem[] = [];
  const clientFile = dtsFiles.find(f => /client\.d\.ts$/.test(f));
  if (clientFile) {
    const content = await readFileIfExists(clientFile);
    if (content) {
      sourceFiles.push(relativePath(clientFile, sdkRoot));

      // Match exported class declarations
      const classPattern = /export\s+(?:default\s+)?(?:declare\s+)?class\s+(\w+)/g;
      for (const match of regexMatchAll(content, classPattern)) {
        clientItems.push({
          id: `client-class-${match[1]}`,
          name: match[1],
          description: `SDK client class: ${match[1]}`,
          type: 'client-class',
          sourceFile: relativePath(clientFile, sdkRoot),
          sourceLine: getLineNumber(content, match.index!),
        });
      }

      // Match public methods on classes
      const methodPattern = /^\s+(\w+)\s*\(([^)]*)\)\s*:\s*([^;{]+)/gm;
      for (const match of regexMatchAll(content, methodPattern)) {
        const methodName = match[1];
        // Skip constructor and private-looking methods
        if (methodName === 'constructor' || methodName.startsWith('_')) continue;
        const returnType = match[3].trim();
        clientItems.push({
          id: `client-method-${methodName}`,
          name: methodName,
          description: `Client method returning ${returnType.substring(0, 60)}`,
          type: 'method',
          properties: { params: match[2].trim().substring(0, 100), returnType: returnType.substring(0, 80) },
          sourceFile: relativePath(clientFile, sdkRoot),
          sourceLine: getLineNumber(content, match.index!),
        });
      }
    }
  }

  if (clientItems.length > 0) {
    sections.push({
      id: 'client-api',
      title: 'Client API',
      description: 'Public API surface of the main SDK client class.',
      adminOnly: false,
      items: clientItems,
    });
  }

  // --- Section 2: Resources ---
  const resourceItems: DocItem[] = [];
  const resourceFiles = dtsFiles.filter(f => /\/resources\//.test(f));
  for (const filePath of resourceFiles) {
    const content = await readFileIfExists(filePath);
    if (!content) continue;
    if (!sourceFiles.includes(relativePath(filePath, sdkRoot))) {
      sourceFiles.push(relativePath(filePath, sdkRoot));
    }

    // Match exported class declarations (API namespace resources)
    const classPattern = /export\s+(?:declare\s+)?class\s+(\w+)/g;
    for (const match of regexMatchAll(content, classPattern)) {
      const className = match[1];
      resourceItems.push({
        id: `resource-${className}`,
        name: className,
        description: `API resource: ${className}`,
        type: 'resource-class',
        sourceFile: relativePath(filePath, sdkRoot),
        sourceLine: getLineNumber(content, match.index!),
      });
    }
  }

  if (resourceItems.length > 0) {
    sections.push({
      id: 'resources',
      title: 'Resources',
      description: 'API resource namespaces (messages, completions, models, etc.).',
      adminOnly: false,
      items: resourceItems,
    });
  }

  // --- Section 3: Types ---
  const typeItems: DocItem[] = [];
  for (const filePath of resourceFiles) {
    const content = await readFileIfExists(filePath);
    if (!content) continue;

    // Match exported interfaces
    const ifacePattern = /export\s+(?:declare\s+)?interface\s+(\w+)/g;
    for (const match of regexMatchAll(content, ifacePattern)) {
      typeItems.push({
        id: `type-iface-${match[1]}`,
        name: match[1],
        description: `Interface: ${match[1]}`,
        type: 'interface',
        sourceFile: relativePath(filePath, sdkRoot),
        sourceLine: getLineNumber(content, match.index!),
      });
    }

    // Match exported type aliases
    const typePattern = /export\s+(?:declare\s+)?type\s+(\w+)\s*=/g;
    for (const match of regexMatchAll(content, typePattern)) {
      typeItems.push({
        id: `type-alias-${match[1]}`,
        name: match[1],
        description: `Type alias: ${match[1]}`,
        type: 'type-alias',
        sourceFile: relativePath(filePath, sdkRoot),
        sourceLine: getLineNumber(content, match.index!),
      });
    }
  }

  if (typeItems.length > 0) {
    sections.push({
      id: 'types',
      title: 'Types',
      description: 'Exported interfaces and type aliases from SDK resource definitions.',
      adminOnly: false,
      items: typeItems,
    });
  }

  // --- Section 4: Provider Adapters ---
  const adapterItems: DocItem[] = [];
  const adapterFiles = dtsFiles.filter(f =>
    /bedrock\.d\.ts$/.test(f) || /vertex\.d\.ts$/.test(f)
  );
  for (const filePath of adapterFiles) {
    const content = await readFileIfExists(filePath);
    if (!content) continue;
    if (!sourceFiles.includes(relativePath(filePath, sdkRoot))) {
      sourceFiles.push(relativePath(filePath, sdkRoot));
    }

    // Match exported classes
    const classPattern = /export\s+(?:declare\s+)?class\s+(\w+)/g;
    for (const match of regexMatchAll(content, classPattern)) {
      adapterItems.push({
        id: `adapter-${match[1]}`,
        name: match[1],
        description: `Provider adapter class: ${match[1]}`,
        type: 'provider-adapter',
        sourceFile: relativePath(filePath, sdkRoot),
        sourceLine: getLineNumber(content, match.index!),
      });
    }

    // Match exported interfaces
    const ifacePattern = /export\s+(?:declare\s+)?interface\s+(\w+)/g;
    for (const match of regexMatchAll(content, ifacePattern)) {
      adapterItems.push({
        id: `adapter-iface-${match[1]}`,
        name: match[1],
        description: `Provider adapter interface: ${match[1]}`,
        type: 'provider-interface',
        sourceFile: relativePath(filePath, sdkRoot),
        sourceLine: getLineNumber(content, match.index!),
      });
    }
  }

  if (adapterItems.length > 0) {
    sections.push({
      id: 'provider-adapters',
      title: 'Provider Adapters',
      description: 'Provider-specific adapter classes for Bedrock, Vertex, and other cloud LLM services.',
      adminOnly: false,
      items: adapterItems,
    });
  }

  return {
    domain: 'llm-sdk',
    title: 'OpenAgentic LLM SDK',
    description: 'TypeScript SDK for interacting with the OpenAgentic LLM API, including provider-specific adapters for Bedrock and Vertex.',
    icon: 'tool',
    category: 'tools',
    generatedAt: new Date().toISOString(),
    sourceFiles,
    sections,
  };
}

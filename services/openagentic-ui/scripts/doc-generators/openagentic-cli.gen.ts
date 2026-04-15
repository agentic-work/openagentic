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
 * OpenAgentic CLI Documentation Generator
 *
 * Scans the companion openagentic project (lives outside this repo) to extract:
 * - CLI commands (case statements, command definitions)
 * - Tools (tool classes/interfaces in tools/)
 * - Components (React/Ink UI components)
 * - Services (service classes)
 * - Key modules (root-level exports)
 */

import type { DocManifest, DocItem, DocSection } from './types.js';
import { readFileIfExists, relativePath, getLineNumber, regexMatchAll, findFiles, companionPath } from './utils.js';

export async function generateOpenagenticCli(basePath: string): Promise<DocManifest | null> {
  const srcDir = companionPath(basePath, 'openagentic', 'src');
  const companionRoot = companionPath(basePath, 'openagentic');

  // Check if the companion project exists by looking for any .ts files
  const tsFiles = await findFiles(srcDir, /\.tsx?$/);
  if (tsFiles.length === 0) return null;

  const sourceFiles: string[] = [];
  const sections: DocSection[] = [];

  // --- Section 1: Commands ---
  const commandItems: DocItem[] = [];
  const commandFiles = tsFiles.filter(f => /commands?\.ts$/.test(f) || /\/commands\//.test(f));
  for (const filePath of commandFiles) {
    const content = await readFileIfExists(filePath);
    if (!content) continue;
    sourceFiles.push(relativePath(filePath, companionRoot));

    // Match case "command-name": patterns
    const casePattern = /case\s+["']([^"']+)["']\s*:/g;
    for (const match of regexMatchAll(content, casePattern)) {
      const cmdName = match[1];
      // Try to find a nearby comment
      const lineNum = getLineNumber(content, match.index!);
      const lines = content.split('\n');
      const commentLine = lines[lineNum - 2]?.trim() || '';
      const desc = commentLine.startsWith('//')
        ? commentLine.replace(/^\/\/\s*/, '')
        : `CLI command: ${cmdName}`;
      commandItems.push({
        id: `cmd-${cmdName}`,
        name: cmdName,
        description: desc,
        type: 'command',
        sourceFile: relativePath(filePath, companionRoot),
        sourceLine: lineNum,
      });
    }

    // Match command definition objects: { name: "xxx", ... }
    const defPattern = /\{\s*name:\s*["']([^"']+)["'],?\s*(?:description:\s*["']([^"']+)["'])?/g;
    for (const match of regexMatchAll(content, defPattern)) {
      const cmdName = match[1];
      if (commandItems.some(c => c.name === cmdName)) continue;
      commandItems.push({
        id: `cmd-${cmdName}`,
        name: cmdName,
        description: match[2] || `CLI command: ${cmdName}`,
        type: 'command',
        sourceFile: relativePath(filePath, companionRoot),
        sourceLine: getLineNumber(content, match.index!),
      });
    }
  }

  if (commandItems.length > 0) {
    sections.push({
      id: 'commands',
      title: 'CLI Commands',
      description: 'Available CLI commands in the OpenAgentic interactive terminal.',
      adminOnly: false,
      items: commandItems,
    });
  }

  // --- Section 2: Tools ---
  const toolItems: DocItem[] = [];
  const toolFiles = tsFiles.filter(f => /\/tools\//.test(f) || /Tool\.ts$/.test(f));
  for (const filePath of toolFiles) {
    const content = await readFileIfExists(filePath);
    if (!content) continue;
    if (!sourceFiles.includes(relativePath(filePath, companionRoot))) {
      sourceFiles.push(relativePath(filePath, companionRoot));
    }

    // Match exported classes
    const classPattern = /export\s+(?:default\s+)?class\s+(\w+)/g;
    for (const match of regexMatchAll(content, classPattern)) {
      toolItems.push({
        id: `tool-${match[1]}`,
        name: match[1],
        description: `Tool class: ${match[1]}`,
        type: 'tool-class',
        sourceFile: relativePath(filePath, companionRoot),
        sourceLine: getLineNumber(content, match.index!),
      });
    }

    // Match exported interfaces
    const ifacePattern = /export\s+interface\s+(\w+Tool\w*)/g;
    for (const match of regexMatchAll(content, ifacePattern)) {
      toolItems.push({
        id: `tool-iface-${match[1]}`,
        name: match[1],
        description: `Tool interface: ${match[1]}`,
        type: 'tool-interface',
        sourceFile: relativePath(filePath, companionRoot),
        sourceLine: getLineNumber(content, match.index!),
      });
    }
  }

  if (toolItems.length > 0) {
    sections.push({
      id: 'tools',
      title: 'Tools',
      description: 'Tool definitions and interfaces for OpenAgentic CLI capabilities.',
      adminOnly: false,
      items: toolItems,
    });
  }

  // --- Section 3: Components ---
  const componentItems: DocItem[] = [];
  const componentFiles = tsFiles.filter(f =>
    /\/components\//.test(f) || /\/screens\//.test(f) || /\/ink\//.test(f)
  );
  for (const filePath of componentFiles) {
    const content = await readFileIfExists(filePath);
    if (!content) continue;
    if (!sourceFiles.includes(relativePath(filePath, companionRoot))) {
      sourceFiles.push(relativePath(filePath, companionRoot));
    }

    // Match exported function components
    const funcPattern = /export\s+(?:default\s+)?(?:const|function)\s+(\w+)/g;
    for (const match of regexMatchAll(content, funcPattern)) {
      componentItems.push({
        id: `component-${match[1]}`,
        name: match[1],
        description: `UI component: ${match[1]}`,
        type: 'component',
        sourceFile: relativePath(filePath, companionRoot),
        sourceLine: getLineNumber(content, match.index!),
      });
    }

    // Match exported class components
    const classPattern = /export\s+(?:default\s+)?class\s+(\w+)/g;
    for (const match of regexMatchAll(content, classPattern)) {
      if (componentItems.some(c => c.name === match[1])) continue;
      componentItems.push({
        id: `component-${match[1]}`,
        name: match[1],
        description: `UI component class: ${match[1]}`,
        type: 'component',
        sourceFile: relativePath(filePath, companionRoot),
        sourceLine: getLineNumber(content, match.index!),
      });
    }
  }

  if (componentItems.length > 0) {
    sections.push({
      id: 'components',
      title: 'UI Components',
      description: 'React/Ink terminal UI components for the OpenAgentic CLI.',
      adminOnly: false,
      items: componentItems,
    });
  }

  // --- Section 4: Services ---
  const serviceItems: DocItem[] = [];
  const serviceFiles = tsFiles.filter(f => /\/services\//.test(f));
  for (const filePath of serviceFiles) {
    const content = await readFileIfExists(filePath);
    if (!content) continue;
    if (!sourceFiles.includes(relativePath(filePath, companionRoot))) {
      sourceFiles.push(relativePath(filePath, companionRoot));
    }

    const classPattern = /export\s+(?:default\s+)?class\s+(\w+)/g;
    for (const match of regexMatchAll(content, classPattern)) {
      serviceItems.push({
        id: `service-${match[1]}`,
        name: match[1],
        description: `Service class: ${match[1]}`,
        type: 'service',
        sourceFile: relativePath(filePath, companionRoot),
        sourceLine: getLineNumber(content, match.index!),
      });
    }
  }

  if (serviceItems.length > 0) {
    sections.push({
      id: 'services',
      title: 'Services',
      description: 'Backend service classes used by the OpenAgentic CLI.',
      adminOnly: false,
      items: serviceItems,
    });
  }

  // --- Section 5: Key Modules ---
  const moduleItems: DocItem[] = [];
  const rootFiles = tsFiles.filter(f => {
    const rel = f.replace(srcDir + '/', '');
    return !rel.includes('/') && /\.tsx?$/.test(rel);
  });
  for (const filePath of rootFiles) {
    const content = await readFileIfExists(filePath);
    if (!content) continue;
    if (!sourceFiles.includes(relativePath(filePath, companionRoot))) {
      sourceFiles.push(relativePath(filePath, companionRoot));
    }

    // Exported classes
    const classPattern = /export\s+(?:default\s+)?class\s+(\w+)/g;
    for (const match of regexMatchAll(content, classPattern)) {
      moduleItems.push({
        id: `module-${match[1]}`,
        name: match[1],
        description: `Exported class from ${filePath.split('/').pop()}`,
        type: 'module-class',
        sourceFile: relativePath(filePath, companionRoot),
        sourceLine: getLineNumber(content, match.index!),
      });
    }

    // Exported functions
    const funcPattern = /export\s+(?:default\s+)?(?:async\s+)?function\s+(\w+)/g;
    for (const match of regexMatchAll(content, funcPattern)) {
      moduleItems.push({
        id: `module-${match[1]}`,
        name: match[1],
        description: `Exported function from ${filePath.split('/').pop()}`,
        type: 'module-function',
        sourceFile: relativePath(filePath, companionRoot),
        sourceLine: getLineNumber(content, match.index!),
      });
    }
  }

  if (moduleItems.length > 0) {
    sections.push({
      id: 'key-modules',
      title: 'Key Modules',
      description: 'Top-level exported classes and functions from the OpenAgentic CLI source root.',
      adminOnly: false,
      items: moduleItems,
    });
  }

  return {
    domain: 'openagentic-cli',
    title: 'OpenAgentic CLI',
    description: 'Interactive terminal-based AI coding assistant with Ink UI, tool execution, and multi-model support.',
    icon: 'code',
    category: 'ui',
    generatedAt: new Date().toISOString(),
    sourceFiles,
    sections,
  };
}

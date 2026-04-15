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
 * Code Mode Documentation Generator
 *
 * Scans services/openagentic-manager/src/ to extract:
 * - Exported class names and their descriptions
 * - Key interfaces (from types.ts and other files)
 * - WebSocket handler registrations
 */

import type { DocManifest, DocItem, DocSection } from './types.js';
import {
  readFileIfExists,
  svcPath,
  relativePath,
  getLineNumber,
  regexMatchAll,
  findFiles,
} from './utils.js';
import { basename } from 'path';

export async function generateCodeMode(basePath: string): Promise<DocManifest | null> {
  const srcDir = svcPath(basePath, 'openagentic-manager', 'src');
  const tsFiles = await findFiles(srcDir, /\.ts$/);

  if (tsFiles.length === 0) return null;

  tsFiles.sort();

  const sourceFiles: string[] = [];
  const sections: DocSection[] = [];

  const allClasses: DocItem[] = [];
  const allInterfaces: DocItem[] = [];
  const wsHandlers: DocItem[] = [];

  for (const filePath of tsFiles) {
    const content = await readFileIfExists(filePath);
    if (!content) continue;

    const relPath = relativePath(filePath, basePath);
    sourceFiles.push(relPath);
    const fileName = basename(filePath, '.ts');

    // --- Extract exported classes ---
    const classPattern = /export (?:class|abstract class) (\w+)(?:\s+extends\s+\w+)?(?:\s+implements\s+[\w,\s]+)?\s*\{/g;
    for (const match of regexMatchAll(content, classPattern)) {
      const className = match[1];
      const line = getLineNumber(content, match.index);

      // Try to get JSDoc comment above
      const beforeClass = content.substring(0, match.index);
      const docMatch = beforeClass.match(/\/\*\*\s*([\s\S]*?)\*\/\s*$/);
      let description = `Class from ${fileName}.ts`;
      if (docMatch) {
        const firstLine = docMatch[1]
          .split('\n')
          .map(l => l.trim().replace(/^\*\s?/, ''))
          .filter(l => l.length > 0)[0];
        if (firstLine) description = firstLine;
      }

      allClasses.push({
        id: `class-${className}`,
        name: className,
        description,
        type: 'class',
        sourceLine: line,
        sourceFile: relPath,
      });
    }

    // --- Extract exported interfaces ---
    const interfacePattern = /export interface (\w+)\s*(?:extends\s+[\w,\s<>]+)?\s*\{/g;
    for (const match of regexMatchAll(content, interfacePattern)) {
      const ifaceName = match[1];
      const line = getLineNumber(content, match.index);

      // Count fields in the interface
      const afterMatch = content.substring(match.index);
      const blockEnd = afterMatch.indexOf('\n}');
      const block = blockEnd > 0 ? afterMatch.substring(0, blockEnd) : '';
      const fieldCount = (block.match(/^\s+\w+[\?]?:/gm) || []).length;

      allInterfaces.push({
        id: `iface-${ifaceName}`,
        name: ifaceName,
        description: `${fieldCount} fields (${fileName}.ts)`,
        type: 'interface',
        properties: { fieldCount, file: fileName },
        sourceLine: line,
        sourceFile: relPath,
      });
    }

    // --- Extract WebSocket handlers ---
    // Look for ws.on('message', ...) or wss.on('connection', ...) patterns
    const wsOnPattern = /(?:ws|wss|socket|conn)\s*\.on\(\s*['"](\w+)['"]/g;
    for (const match of regexMatchAll(content, wsOnPattern)) {
      const eventName = match[1];
      const line = getLineNumber(content, match.index);

      wsHandlers.push({
        id: `ws-${fileName}-${eventName}`,
        name: `${eventName}`,
        description: `WebSocket "${eventName}" handler in ${fileName}.ts`,
        type: 'ws-handler',
        properties: { event: eventName, file: fileName },
        sourceLine: line,
        sourceFile: relPath,
      });
    }

    // Also look for WebSocketServer creation or upgrade handlers
    const wssPattern = /new WebSocketServer\(\s*\{([^}]*)\}/g;
    for (const match of regexMatchAll(content, wssPattern)) {
      const line = getLineNumber(content, match.index);
      const pathMatch = match[1].match(/path:\s*['"]([^'"]+)['"]/);

      wsHandlers.push({
        id: `wss-${fileName}`,
        name: `WebSocketServer`,
        description: `Server instance in ${fileName}.ts${pathMatch ? ` (path: ${pathMatch[1]})` : ''}`,
        type: 'ws-server',
        properties: { file: fileName, path: pathMatch?.[1] },
        sourceLine: line,
        sourceFile: relPath,
      });
    }
  }

  // --- Section 1: Classes ---
  sections.push({
    id: 'classes',
    title: 'Code Mode Classes',
    description: `${allClasses.length} exported classes in the openagentic-manager service.`,
    adminOnly: false,
    items: allClasses,
  });

  // --- Section 2: Interfaces ---
  sections.push({
    id: 'interfaces',
    title: 'Key Interfaces',
    description: `${allInterfaces.length} exported interfaces defining the code mode data model.`,
    adminOnly: false,
    items: allInterfaces,
  });

  // --- Section 3: WebSocket Handlers ---
  // Deduplicate by id
  const seenWs = new Set<string>();
  const uniqueWs = wsHandlers.filter(h => {
    if (seenWs.has(h.id)) return false;
    seenWs.add(h.id);
    return true;
  });

  sections.push({
    id: 'websocket-handlers',
    title: 'WebSocket Handlers',
    description: `${uniqueWs.length} WebSocket event handlers for real-time terminal I/O and session management.`,
    adminOnly: false,
    items: uniqueWs,
  });

  return {
    domain: 'code-mode',
    title: 'Code Mode (OpenAgentic)',
    description: `OpenAgentic manager with ${allClasses.length} classes, ${allInterfaces.length} interfaces, and ${uniqueWs.length} WebSocket handlers.`,
    icon: 'code',
    category: 'ui',
    generatedAt: new Date().toISOString(),
    sourceFiles,
    sections,
  };
}

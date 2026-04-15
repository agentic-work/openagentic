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
 * MCP Servers Documentation Generator
 *
 * Scans all mcps/openagentic-{name}-mcp/server.py files to extract:
 * - Server name and description (from module docstring)
 * - Tool definitions (@mcp.tool() decorated functions)
 * - Tool parameters (Annotated[Type, Field(description='...')])
 * - Tool docstrings
 */

import type { DocManifest, DocItem, DocSection } from './types.js';
import { readFileIfExists, svcPath, relativePath, regexMatchAll, getLineNumber, findFiles } from './utils.js';
import { basename, dirname } from 'path';

interface MCPTool {
  name: string;
  description: string;
  params: Array<{ name: string; type: string; description: string; optional: boolean }>;
  line: number;
}

function parseToolsFromPython(content: string): MCPTool[] {
  const tools: MCPTool[] = [];

  // Find all @mcp.tool() decorated functions
  const toolPattern = /@mcp\.tool\(\)\s*\nasync def (\w+)\(([\s\S]*?)\)[\s\S]*?(?:"""([\s\S]*?)"""|$)/g;

  for (const match of regexMatchAll(content, toolPattern)) {
    const funcName = match[1];
    const paramsStr = match[2];
    const docstring = match[3]?.trim() || '';

    // Parse parameters
    const params: MCPTool['params'] = [];
    // Match Annotated parameters: name: Annotated[Type, Field(description='...')]
    const paramPattern = /(\w+):\s*(?:Annotated\[([^,\]]+),\s*Field\((?:[^)]*description=['"]([^'"]+)['"])?[^)]*\)\]|Optional\[([^\]]+)\]|(\w+))/g;
    for (const pm of regexMatchAll(paramsStr, paramPattern)) {
      const paramName = pm[1];
      // Skip 'self', 'ctx', 'meta' parameters
      if (['self', 'ctx', 'meta'].includes(paramName)) continue;

      const paramType = pm[2] || pm[4] || pm[5] || 'unknown';
      const paramDesc = pm[3] || '';
      const isOptional = paramsStr.includes(`${paramName}:`) &&
        (paramsStr.includes(`Optional`) || paramsStr.includes(`= None`) || paramsStr.includes(`= `));

      params.push({
        name: paramName,
        type: paramType.trim(),
        description: paramDesc,
        optional: isOptional,
      });
    }

    // Extract first line of docstring as description
    const description = docstring.split('\n')[0].trim() || funcName.replace(/_/g, ' ');

    tools.push({
      name: funcName,
      description,
      params,
      line: getLineNumber(content, match.index),
    });
  }

  return tools;
}

function parseServerDescription(content: string): string {
  // Extract module docstring
  const docMatch = content.match(/^"""([\s\S]*?)"""/m);
  if (docMatch) {
    const lines = docMatch[1].trim().split('\n');
    // Return first meaningful line
    return lines[0].trim();
  }
  return '';
}

function serverDisplayName(dirName: string): string {
  // oap-aws-mcp -> AWS
  // oap-kubernetes-mcp -> Kubernetes
  // oap-azure-cost-mcp -> Azure Cost
  return dirName
    .replace(/^openagentic-/, '')
    .replace(/-mcp$/, '')
    .split('-')
    .map(w => w.charAt(0).toUpperCase() + w.slice(1))
    .join(' ');
}

export async function generateMcpServers(basePath: string): Promise<DocManifest | null> {
  const mcpsDir = svcPath(basePath, 'mcps');
  const serverFiles = await findFiles(mcpsDir, /openagentic-.*\/server\.py$/);

  if (serverFiles.length === 0) return null;

  const sourceFiles: string[] = [];
  const sections: DocSection[] = [];
  let totalTools = 0;

  // Sort server files for consistent ordering
  serverFiles.sort();

  for (const filePath of serverFiles) {
    const content = await readFileIfExists(filePath);
    if (!content) continue;

    const dirName = basename(dirname(filePath));
    const displayName = serverDisplayName(dirName);
    const serverDesc = parseServerDescription(content);
    const tools = parseToolsFromPython(content);
    const relPath = relativePath(filePath, basePath);
    sourceFiles.push(relPath);
    totalTools += tools.length;

    const toolItems: DocItem[] = tools.map(tool => ({
      id: `${dirName}-${tool.name}`,
      name: tool.name,
      description: tool.description,
      type: 'mcp-tool',
      properties: {
        server: dirName,
        params: tool.params,
        paramCount: tool.params.length,
      },
      sourceLine: tool.line,
      sourceFile: relPath,
    }));

    sections.push({
      id: dirName,
      title: `${displayName} MCP Server`,
      description: `${serverDesc || displayName + ' integration'} (${tools.length} tools)`,
      adminOnly: false,
      items: toolItems,
    });
  }

  // Add a summary section
  sections.unshift({
    id: 'mcp-overview',
    title: 'MCP Server Overview',
    description: `OpenAgentic integrates ${serverFiles.length} MCP (Model Context Protocol) servers providing ${totalTools} tools for cloud management, observability, code execution, and more.`,
    adminOnly: false,
    items: serverFiles.map(f => {
      const dirName = basename(dirname(f));
      const displayName = serverDisplayName(dirName);
      return {
        id: `overview-${dirName}`,
        name: displayName,
        description: `${dirName}`,
        type: 'mcp-server',
        sourceFile: relativePath(f, basePath),
      };
    }),
  });

  return {
    domain: 'mcp-servers',
    title: 'MCP Tools',
    description: `${serverFiles.length} MCP servers providing ${totalTools} tools for cloud management, observability, GitHub, knowledge, and platform administration.`,
    icon: 'tool',
    category: 'tools',
    generatedAt: new Date().toISOString(),
    sourceFiles,
    sections,
  };
}

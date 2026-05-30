import { resolve, basename, dirname, relative } from 'path';
import { readFile } from 'fs/promises';
import type { Extractor, DocManifest, DocSection, DocItem } from '../types';
import { findFiles, regexMatchAll } from '../utils';

export interface McpToolsConfig {
  rootGlob: string;
}

export function mcpTools(config: McpToolsConfig): Extractor {
  return async (basePath: string): Promise<DocManifest> => {
    const globParts = config.rootGlob.split('/');
    const wildIdx = globParts.findIndex((p) => p.includes('*'));
    const parentDir = globParts.slice(0, wildIdx).join('/');
    const awpPattern = new RegExp('^' + globParts[wildIdx].replace(/\*/g, '[^/]+') + '$');

    const searchDir = resolve(basePath, parentDir);
    // Find every server.py within an openagentic-* tree (handles both root server.py
    // and src/.../server.py layouts)
    const serverFiles = await findFiles(searchDir, /\/server\.py$/);

    // Group by openagentic-* ancestor dir so each MCP product gets one section
    const byProduct = new Map<string, string[]>();
    for (const f of serverFiles) {
      const rel = relative(searchDir, f);
      const ancestor = rel.split('/')[0];
      if (!awpPattern.test(ancestor)) continue;
      const arr = byProduct.get(ancestor) ?? [];
      arr.push(f);
      byProduct.set(ancestor, arr);
    }

    const sections: DocSection[] = [];
    const sourceFiles: string[] = [];

    for (const [serverDir, files] of [...byProduct.entries()].sort()) {
      const items: DocItem[] = [];
      const seenToolKeys = new Set<string>();
      let serverDesc = serverDir;

      // Prefer the root server.py for description; merge tools from all
      const rootFile = files.find((f) => relative(searchDir, f).split('/').length === 2);
      const orderedFiles = rootFile ? [rootFile, ...files.filter((f) => f !== rootFile)] : files;

      for (const serverPath of orderedFiles) {
        const content = await readFile(serverPath, 'utf-8');
        sourceFiles.push(relative(basePath, serverPath));

        if (serverPath === orderedFiles[0]) {
          const docstringMatch = content.match(/^"""([\s\S]*?)"""/);
          if (docstringMatch) serverDesc = docstringMatch[1].trim().split('\n')[0];
        }

        const toolPattern =
          /@mcp\.tool\(\)\s*\n(?:async\s+)?def\s+(\w+)\s*\(([\s\S]*?)\)\s*(?:->\s*[^:]+)?:\s*\n(?:\s+"""([\s\S]*?)""")?/g;
        for (const match of regexMatchAll(content, toolPattern)) {
          const toolName = match[1];
          const key = `${serverDir}--${toolName}`;
          if (seenToolKeys.has(key)) continue;
          seenToolKeys.add(key);
          const params = (match[2] ?? '').trim();
          const docstring = (match[3] ?? '').trim();
          const firstLine = docstring.split('\n')[0] || `${toolName} tool`;
          items.push({
            id: key,
            name: toolName,
            description: firstLine,
            type: 'mcp-tool',
            properties: { params },
            sourceFile: relative(basePath, serverPath),
          });
        }
      }

      sections.push({
        id: serverDir,
        title: serverDir,
        description: serverDesc,
        adminOnly: false,
        items,
      });
    }

    return {
      domain: 'mcp-servers',
      title: 'MCP Servers',
      description: 'Model Context Protocol servers and their tools',
      icon: 'tool',
      category: 'tools',
      generatedAt: new Date().toISOString(),
      sourceFiles,
      sections,
    };
  };
}

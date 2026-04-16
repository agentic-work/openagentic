/**
 * MCP Proxy Service Documentation Generator
 *
 * Scans the openagentic-mcp-proxy service for:
 * - FastAPI routes (@app.get, @app.post, @router.get, etc.)
 * - Python class definitions with docstrings
 * - MCP management functions for lifecycle management
 */

import type { DocManifest, DocSection } from './types.js';
import {
  readFileIfExists, svcPath, relativePath, findFiles,
  parsePyRoutes, parsePyClasses, parsePyFunctions,
  type ParsedPyRoute, type ParsedPyClass, type ParsedPyFunction,
} from './utils.js';

export async function generateMcpProxy(basePath: string): Promise<DocManifest | null> {
  const srcDir = svcPath(basePath, 'openagentic-mcp-proxy', 'src');
  const pyFiles = await findFiles(srcDir, /\.py$/);

  if (pyFiles.length === 0) return null;

  const sourceFiles: string[] = [];
  const sections: DocSection[] = [];
  const allRoutes: (ParsedPyRoute & { file: string })[] = [];
  const allClasses: (ParsedPyClass & { file: string })[] = [];
  const allFunctions: (ParsedPyFunction & { file: string })[] = [];

  for (const filePath of pyFiles.sort()) {
    const content = await readFileIfExists(filePath);
    if (!content) continue;

    const relPath = relativePath(filePath, basePath);
    sourceFiles.push(relPath);

    for (const route of parsePyRoutes(content)) {
      allRoutes.push({ ...route, file: relPath });
    }
    for (const cls of parsePyClasses(content)) {
      allClasses.push({ ...cls, file: relPath });
    }
    for (const fn of parsePyFunctions(content)) {
      allFunctions.push({ ...fn, file: relPath });
    }
  }

  if (allRoutes.length > 0) {
    sections.push({
      id: 'api-routes',
      title: 'API Routes',
      description: `${allRoutes.length} FastAPI route endpoints exposed by the MCP proxy.`,
      adminOnly: false,
      items: allRoutes.map(route => ({
        id: `route-${route.method.toLowerCase()}-${route.funcName}`,
        name: `${route.method} ${route.path}`,
        description: route.docstring,
        type: 'api-route',
        properties: { method: route.method, path: route.path, handler: route.funcName },
        sourceFile: route.file,
        sourceLine: route.line,
      })),
    });
  }

  if (allClasses.length > 0) {
    sections.push({
      id: 'classes',
      title: 'Service Classes',
      description: `${allClasses.length} Python classes implementing MCP proxy functionality.`,
      adminOnly: false,
      items: allClasses.map(cls => ({
        id: `class-${cls.name.toLowerCase()}`,
        name: cls.name,
        description: cls.docstring || `Class with ${cls.methods.length} public methods`,
        type: 'python-class',
        properties: { methods: cls.methods, methodCount: cls.methods.length },
        sourceFile: cls.file,
        sourceLine: cls.line,
      })),
    });
  }

  if (allFunctions.length > 0) {
    sections.push({
      id: 'mcp-functions',
      title: 'MCP Management Functions',
      description: `${allFunctions.length} exported functions for MCP session and lifecycle management.`,
      adminOnly: false,
      items: allFunctions.map(fn => ({
        id: `func-${fn.name}`,
        name: fn.name,
        description: fn.docstring,
        type: 'function',
        properties: { params: fn.params },
        sourceFile: fn.file,
        sourceLine: fn.line,
      })),
    });
  }

  return {
    domain: 'mcp-proxy',
    title: 'MCP Proxy Service',
    description: `MCP proxy service with ${allRoutes.length} API routes, ${allClasses.length} classes, and ${allFunctions.length} management functions.`,
    icon: 'tool',
    category: 'tools',
    generatedAt: new Date().toISOString(),
    sourceFiles,
    sections,
  };
}

/**
 * API Routes Documentation Generator
 *
 * Scans all .ts files in services/openagentic-api/src/routes/ to extract:
 * - HTTP method + path for each route registration
 * - Grouped by source file / directory
 *
 * Detects patterns like fastify.get('/path', ...), fastify.post('/path', ...), etc.
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
import { basename, dirname, relative } from 'path';

export async function generateApiRoutes(basePath: string): Promise<DocManifest | null> {
  const routesDir = svcPath(basePath, 'openagentic-api', 'src', 'routes');
  const routeFiles = await findFiles(routesDir, /\.ts$/);

  if (routeFiles.length === 0) return null;

  // Sort for deterministic output
  routeFiles.sort();

  const sourceFiles: string[] = [];
  const sections: DocSection[] = [];
  let totalRoutes = 0;

  // Group files by subdirectory
  const groups = new Map<string, string[]>();
  for (const file of routeFiles) {
    const rel = relative(routesDir, file);
    const dir = dirname(rel);
    const groupKey = dir === '.' ? 'root' : dir;
    if (!groups.has(groupKey)) groups.set(groupKey, []);
    groups.get(groupKey)!.push(file);
  }

  for (const [group, files] of groups) {
    const items: DocItem[] = [];

    for (const filePath of files) {
      const content = await readFileIfExists(filePath);
      if (!content) continue;

      const relPath = relativePath(filePath, basePath);
      sourceFiles.push(relPath);
      const fileName = basename(filePath, '.ts');

      // Match fastify.get/post/put/delete/patch('/path', ...)
      const routePattern = /fastify\.(get|post|put|delete|patch)\(\s*['"`]([^'"`]+)['"`]/g;
      for (const match of regexMatchAll(content, routePattern)) {
        const method = match[1].toUpperCase();
        const path = match[2];
        const line = getLineNumber(content, match.index);

        items.push({
          id: `${fileName}-${method.toLowerCase()}-${path.replace(/[^a-zA-Z0-9]/g, '-')}`,
          name: `${method} ${path}`,
          description: `Registered in ${fileName}.ts`,
          type: 'http-route',
          properties: {
            method,
            path,
            file: fileName,
          },
          sourceLine: line,
          sourceFile: relPath,
        });
        totalRoutes++;
      }

      // Also match route('/path') patterns (alternative registration)
      const altPattern = /\.route\(\s*\{[^}]*method:\s*['"`](\w+)['"`][^}]*url:\s*['"`]([^'"`]+)['"`]/g;
      for (const match of regexMatchAll(content, altPattern)) {
        const method = match[1].toUpperCase();
        const path = match[2];
        const line = getLineNumber(content, match.index);

        items.push({
          id: `${fileName}-route-${method.toLowerCase()}-${path.replace(/[^a-zA-Z0-9]/g, '-')}`,
          name: `${method} ${path}`,
          description: `Route object in ${fileName}.ts`,
          type: 'http-route',
          properties: { method, path, file: fileName },
          sourceLine: line,
          sourceFile: relPath,
        });
        totalRoutes++;
      }
    }

    const groupTitle = group === 'root' ? 'Root Routes' : `${group.charAt(0).toUpperCase() + group.slice(1)} Routes`;
    sections.push({
      id: `routes-${group}`,
      title: groupTitle,
      description: `${items.length} routes from ${files.length} file(s) in ${group === 'root' ? 'routes/' : `routes/${group}/`}`,
      adminOnly: group.includes('admin'),
      items,
    });
  }

  return {
    domain: 'api-routes',
    title: 'API Routes',
    description: `${totalRoutes} HTTP routes across ${routeFiles.length} route files, organized by directory.`,
    icon: 'code',
    category: 'core',
    generatedAt: new Date().toISOString(),
    sourceFiles,
    sections,
  };
}

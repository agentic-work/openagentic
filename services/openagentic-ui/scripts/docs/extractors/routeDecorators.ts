import { resolve, relative } from 'path';
import { readFile } from 'fs/promises';
import type { Extractor, DocManifest, DocSection, DocItem } from '../types';
import { findFiles, regexMatchAll } from '../utils';

export interface RouteDecoratorsConfig {
  rootDir: string;
}

export function routeDecorators(config: RouteDecoratorsConfig): Extractor {
  return async (basePath: string): Promise<DocManifest> => {
    const root = resolve(basePath, config.rootDir);
    const files = await findFiles(root, /\.ts$/);
    const grouped: Record<string, DocItem[]> = {};
    const sourceFiles: string[] = [];

    const routePattern =
      /(?:fastify|app|router|server)\.(get|post|put|delete|patch|head|options)\s*\(\s*['"`]([^'"`]+)['"`]/g;

    for (const file of files) {
      if (file.includes('.test.ts') || file.includes('__tests__')) continue;
      let content: string;
      try {
        content = await readFile(file, 'utf-8');
      } catch {
        continue;
      }
      const matches = regexMatchAll(content, routePattern);
      if (matches.length === 0) continue;
      const rel = relative(basePath, file);
      sourceFiles.push(rel);

      const parts = rel.split('/');
      const group = parts.slice(-3, -1).join('/');
      grouped[group] ??= [];
      for (const m of matches) {
        const method = m[1].toUpperCase();
        const path = m[2];
        grouped[group].push({
          id: `${method}-${path}`.replace(/[^a-zA-Z0-9-]/g, '_'),
          name: `${method} ${path}`,
          description: `${method} ${path}`,
          type: 'http-route',
          properties: { method, path },
          sourceFile: rel,
        });
      }
    }

    const sections: DocSection[] = Object.entries(grouped).map(([group, items]) => ({
      id: group.replace(/\//g, '_'),
      title: group,
      description: `Routes registered in ${group}`,
      adminOnly: false,
      items,
    }));

    return {
      domain: 'api-routes',
      title: 'API Routes',
      description: 'HTTP routes registered across the API',
      icon: 'route',
      category: 'core',
      generatedAt: new Date().toISOString(),
      sourceFiles,
      sections,
    };
  };
}

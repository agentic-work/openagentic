import { resolve } from 'path';
import { readFile } from 'fs/promises';
import type { Extractor, DocManifest, DocItem } from '../types';
import { regexMatchAll } from '../utils';

export interface PrismaSchemaConfig {
  domain?: string;
  title?: string;
  description?: string;
  icon?: string;
  category?: string;
  path: string;
}

const DEFAULTS = {
  domain: 'database-schema',
  title: 'Database Schema',
  description: 'Prisma data model',
  icon: 'db',
  category: 'infrastructure',
};

export function prismaSchema(config: PrismaSchemaConfig): Extractor {
  const meta = { ...DEFAULTS, ...config };
  return async (basePath: string): Promise<DocManifest> => {
    const abs = resolve(basePath, config.path);
    let src: string;
    try {
      src = await readFile(abs, 'utf-8');
    } catch {
      return {
        domain: meta.domain,
        title: meta.title,
        description: meta.description,
        icon: meta.icon,
        category: meta.category,
        generatedAt: new Date().toISOString(),
        sourceFiles: [],
        sections: [{
          id: 'unavailable',
          title: 'Schema not present',
          description: `${config.path} not present at build time.`,
          adminOnly: false,
          items: [],
        }],
      };
    }

    const modelPattern = /model\s+(\w+)\s*\{([\s\S]*?)\n\}/g;
    const items: DocItem[] = [];
    for (const m of regexMatchAll(src, modelPattern)) {
      const modelName = m[1];
      const body = m[2];
      const fieldCount = body.split('\n').filter((l) => /^\s+\w+\s+\w+/.test(l)).length;
      items.push({
        id: modelName,
        name: modelName,
        description: `Prisma model with ${fieldCount} fields`,
        type: 'prisma-model',
        properties: { fieldCount },
        sourceFile: config.path,
      });
    }

    return {
      domain: meta.domain,
      title: meta.title,
      description: meta.description,
      icon: meta.icon,
      category: meta.category,
      generatedAt: new Date().toISOString(),
      sourceFiles: [config.path],
      sections: [{
        id: 'models',
        title: 'Models',
        description: 'All Prisma models defined in schema.prisma',
        adminOnly: false,
        items,
      }],
    };
  };
}

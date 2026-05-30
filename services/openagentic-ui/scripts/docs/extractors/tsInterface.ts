import { resolve, relative } from 'path';
import { readFile } from 'fs/promises';
import type { Extractor, DocManifest, DocItem, DocSection } from '../types';
import { regexMatchAll } from '../utils';

export interface TsInterfaceConfig {
  domain: string;
  title: string;
  description: string;
  icon: string;
  category: string;
  path: string;
  typeName: string;
}

interface InterfaceField {
  name: string;
  type: string;
  jsdoc?: string;
}

function extractInterfaceFields(body: string): InterfaceField[] {
  const fields: InterfaceField[] = [];
  const pattern =
    /(\/\*\*([\s\S]*?)\*\/\s*)?(\w+)(\??)\s*:\s*([^;,\n]+)[;,]?/g;
  for (const m of regexMatchAll(body, pattern)) {
    const jsdoc = m[2]
      ?.split('\n')
      .map((l) => l.replace(/^\s*\*\s?/, '').trim())
      .filter(Boolean)
      .join(' ');
    fields.push({ name: m[3], type: m[5].trim(), jsdoc });
  }
  return fields;
}

export function tsInterface(config: TsInterfaceConfig): Extractor {
  return async (basePath: string): Promise<DocManifest> => {
    const abs = resolve(basePath, config.path);
    const src = await readFile(abs, 'utf-8');
    const sections: DocSection[] = [];

    if (config.typeName === '*') {
      const interfacePattern = /export\s+interface\s+(\w+)\s*\{([\s\S]*?)\n\}/g;
      for (const m of regexMatchAll(src, interfacePattern)) {
        const fields = extractInterfaceFields(m[2]);
        if (fields.length === 0) continue;
        sections.push({
          id: m[1],
          title: m[1],
          description: `Interface ${m[1]}`,
          adminOnly: false,
          items: fields.map((f): DocItem => ({
            id: `${m[1]}.${f.name}`,
            name: f.name,
            description: (f.jsdoc ?? f.type).slice(0, 280),
            type: 'ts-field',
            properties: { tsType: f.type },
            sourceFile: relative(basePath, abs),
          })),
        });
      }
    } else {
      const namedRe = new RegExp(
        `export\\s+interface\\s+${config.typeName}\\s*\\{([\\s\\S]*?)\\n\\}`,
      );
      const namedMatch = src.match(namedRe);
      if (namedMatch) {
        const fields = extractInterfaceFields(namedMatch[1]);
        sections.push({
          id: config.typeName,
          title: config.typeName,
          description: `Interface ${config.typeName}`,
          adminOnly: false,
          items: fields.map((f): DocItem => ({
            id: f.name,
            name: f.name,
            description: (f.jsdoc ?? f.type).slice(0, 280),
            type: 'ts-field',
            properties: { tsType: f.type },
            sourceFile: relative(basePath, abs),
          })),
        });
      }
    }

    return {
      domain: config.domain,
      title: config.title,
      description: config.description,
      icon: config.icon,
      category: config.category,
      generatedAt: new Date().toISOString(),
      sourceFiles: [config.path],
      sections,
    };
  };
}

import { resolve, relative } from 'path';
import { readFile } from 'fs/promises';
import type { Extractor, DocManifest, DocItem } from '../types';
import { regexMatchAll } from '../utils';

export interface TsConstExportConfig {
  domain: string;
  title: string;
  description: string;
  icon: string;
  category: string;
  path: string;
  exportName: string;
  /**
   * When the named export is an object literal (`export const X = { a: ..., b: ... }`)
   * rather than an array, set this to emit one DocItem per top-level key, using
   * the preceding `//` comment as the description.
   */
  objectExport?: boolean;
}

export function tsConstExport(config: TsConstExportConfig): Extractor {
  return async (basePath: string): Promise<DocManifest> => {
    const abs = resolve(basePath, config.path);
    const src = await readFile(abs, 'utf-8');
    const items: DocItem[] = [];

    if (config.objectExport) {
      // export const NAME = { ... } as const;  → one item per top-level key
      const objRe = new RegExp(
        `export\\s+const\\s+${config.exportName}\\s*[:=]\\s*\\{([\\s\\S]*?)\\}\\s*(?:as\\s+const)?\\s*;`,
      );
      const objMatch = src.match(objRe);
      if (!objMatch) {
        throw new Error(
          `tsConstExport: ${config.exportName} (object) not found in ${config.path}`,
        );
      }
      const body = objMatch[1];
      const lines = body.split('\n');
      let pendingComment = '';
      // top-level key = exactly two-space indent + `key:` (skips nested call args)
      const keyRe = /^ {2}([a-zA-Z_$][\w$]*)\s*:/;
      for (const line of lines) {
        const commentMatch = line.match(/^\s*\/\/\s?(.*)$/);
        if (commentMatch) {
          const text = commentMatch[1].trim();
          if (text) pendingComment = pendingComment ? `${pendingComment} ${text}` : text;
          continue;
        }
        const keyMatch = line.match(keyRe);
        if (keyMatch) {
          const key = keyMatch[1];
          items.push({
            id: key,
            name: key,
            description: (pendingComment || `Feature flag: ${key}`)
              .split('\n')[0]
              .trim()
              .slice(0, 280),
            type: 'feature-flag',
            sourceFile: relative(basePath, abs),
          });
          pendingComment = '';
          continue;
        }
        // blank line resets the pending comment so it only attaches to the next key
        if (line.trim() === '') pendingComment = '';
      }
    } else if (config.exportName === '*') {
      // Two-pass: find every `export const NAME` start, then for each
      // slice the source from that point up to the next top-level statement
      // (or end of file). Avoids the lookahead-at-EOF bug in single-pass regex.
      const startPattern = /export\s+const\s+(\w+)\b/g;
      const starts: Array<{ index: number; name: string }> = [];
      for (const m of regexMatchAll(src, startPattern)) {
        starts.push({ index: m.index, name: m[1] });
      }
      for (let i = 0; i < starts.length; i++) {
        const start = starts[i];
        const end = i + 1 < starts.length ? starts[i + 1].index : src.length;
        const block = src.slice(start.index, end);
        const descMatch = block.match(/['"`]([\s\S]*?)['"`]/);
        items.push({
          id: start.name,
          name: start.name,
          description: (descMatch?.[1] ?? `Exported const ${start.name}`)
            .split('\n')
            .slice(0, 2)
            .join(' ')
            .slice(0, 280),
          type: 'ts-const',
          sourceFile: relative(basePath, abs),
        });
      }
    } else {
      const namedRe = new RegExp(
        `export\\s+const\\s+${config.exportName}\\s*[:=]\\s*\\[([\\s\\S]*?)\\];`,
      );
      const namedMatch = src.match(namedRe);
      if (!namedMatch) {
        throw new Error(
          `tsConstExport: ${config.exportName} not found in ${config.path}`,
        );
      }
      const body = namedMatch[1];
      const itemPattern =
        /\{\s*name:\s*['"`]([^'"`]+)['"`][\s\S]*?description:\s*['"`]([\s\S]*?)['"`]/g;
      for (const im of regexMatchAll(body, itemPattern)) {
        items.push({
          id: im[1],
          name: im[1],
          description: im[2].split('\n')[0].trim().slice(0, 280),
          type: 'ts-const-item',
          sourceFile: relative(basePath, abs),
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
      sections: [
        {
          id: 'main',
          title: config.title,
          description: config.description,
          adminOnly: false,
          items,
        },
      ],
    };
  };
}

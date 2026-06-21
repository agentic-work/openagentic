import { resolve, basename } from 'path';
import { readFile, readdir, stat } from 'fs/promises';
import type { Extractor, DocManifest, DocSection, DocItem } from '../types';

export interface MarkdownDocConfig {
  domain: string;
  title: string;
  description: string;
  icon: string;
  category: string;
  pathOrGlob: string;
  sectionFromHeading?: 'h1' | 'h2';
  fileFilter?: RegExp;
}

async function expandPathOrGlob(basePath: string, expr: string): Promise<string[]> {
  if (!expr.includes('*')) return [expr];
  const parts = expr.split('/');
  const lastIdx = parts.findIndex((p) => p.includes('*'));
  const parent = parts.slice(0, lastIdx).join('/');
  const pat = new RegExp('^' + parts[lastIdx].replace(/\*/g, '.*') + '$');
  const parentAbs = resolve(basePath, parent);
  try {
    const entries = await readdir(parentAbs);
    const out: string[] = [];
    for (const e of entries) {
      if (!pat.test(e)) continue;
      const s = await stat(resolve(parentAbs, e));
      if (s.isFile()) out.push(`${parent}/${e}`);
    }
    return out.sort((a, b) => a.localeCompare(b));
  } catch {
    return [];
  }
}

interface ParsedSubsection {
  title: string;
  body: string;
}

function parseSubsections(md: string, heading: 'h1' | 'h2'): ParsedSubsection[] {
  const prefix = heading === 'h1' ? '#' : '##';
  const lines = md.split('\n');
  const sections: { title: string; body: string[] }[] = [];
  let current: { title: string; body: string[] } | null = null;
  const re = new RegExp(`^${prefix} (?!#)(.+)$`);
  for (const line of lines) {
    const m = line.match(re);
    if (m) {
      if (current) sections.push(current);
      current = { title: m[1].trim(), body: [] };
    } else if (current) {
      current.body.push(line);
    }
  }
  if (current) sections.push(current);
  return sections.map((s) => ({ title: s.title, body: s.body.join('\n').trim() }));
}

export function markdownDoc(config: MarkdownDocConfig): Extractor {
  return async (basePath: string): Promise<DocManifest> => {
    let files = await expandPathOrGlob(basePath, config.pathOrGlob);
    if (config.fileFilter) files = files.filter((f) => config.fileFilter!.test(f));

    const sections: DocSection[] = [];
    const sourceFiles: string[] = [];

    for (const relFile of files) {
      const abs = resolve(basePath, relFile);
      let content: string;
      try {
        content = await readFile(abs, 'utf-8');
      } catch {
        continue;
      }
      sourceFiles.push(relFile);
      const fileName = basename(relFile, '.md');
      const subsections = parseSubsections(content, config.sectionFromHeading ?? 'h2');

      const items: DocItem[] = subsections.map((sub, i) => ({
        id: `${fileName}--${i}`,
        name: sub.title,
        description:
          sub.body.split('\n').slice(0, 3).join(' ').slice(0, 280) || sub.title,
        type: 'markdown-section',
        sourceFile: relFile,
      }));

      const firstParaMatch = content.match(/(?:^|\n\n)([^\n#].+?)(?:\n\n|$)/s);
      const sectionDesc = (firstParaMatch?.[1] ?? fileName).slice(0, 280);

      sections.push({
        id: fileName,
        title: fileName,
        description: sectionDesc,
        adminOnly: false,
        items,
      });
    }

    return {
      domain: config.domain,
      title: config.title,
      description: config.description,
      icon: config.icon,
      category: config.category,
      generatedAt: new Date().toISOString(),
      sourceFiles,
      sections,
    };
  };
}

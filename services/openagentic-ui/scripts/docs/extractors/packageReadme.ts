import { readFile } from 'fs/promises';
import type { Extractor, DocManifest, DocItem, DocSection } from '../types';
import { companionPath } from '../utils';
import { regexMatchAll } from '../utils';

export interface PackageReadmeConfig {
  domain: string;
  title: string;
  description: string;
  icon: string;
  category: string;
  companion: string;
}

function parseSections(content: string): DocSection[] {
  const lines = content.split('\n');
  const sections: { title: string; body: string[] }[] = [];
  let current: { title: string; body: string[] } | null = null;
  for (const line of lines) {
    const h2 = line.match(/^##\s+(?!#)(.+)$/);
    if (h2) {
      if (current) sections.push(current);
      current = { title: h2[1].trim(), body: [] };
    } else if (current) {
      current.body.push(line);
    }
  }
  if (current) sections.push(current);
  return sections.map((s, i) => ({
    id: `section-${i}`,
    title: s.title,
    description: s.body.join('\n').slice(0, 280) || s.title,
    adminOnly: false,
    items: [],
  }));
}

export function packageReadme(config: PackageReadmeConfig): Extractor {
  return async (basePath: string): Promise<DocManifest> => {
    const readmeAbs = companionPath(basePath, config.companion, 'README.md');
    let content: string | null = null;
    try {
      content = await readFile(readmeAbs, 'utf-8');
    } catch { /* not present */ }

    if (!content) {
      return {
        domain: config.domain,
        title: config.title,
        description: config.description,
        icon: config.icon,
        category: config.category,
        generatedAt: new Date().toISOString(),
        sourceFiles: [],
        sections: [{
          id: 'unavailable',
          title: 'Companion repo not staged',
          description: `${config.companion} README not available at build time. Set DOCS_COMPANION_ROOT or place the companion as a sibling of agentic/.`,
          adminOnly: false,
          items: [],
        }],
      };
    }

    const subsections = parseSections(content);
    const sections: DocSection[] = subsections.length > 0
      ? subsections
      : [{
          id: 'readme',
          title: config.title,
          description: content.slice(0, 280),
          adminOnly: false,
          items: [{
            id: 'overview',
            name: 'Overview',
            description: content.slice(0, 280),
            type: 'readme',
            sourceFile: `<companion>/${config.companion}/README.md`,
          } satisfies DocItem],
        }];

    return {
      domain: config.domain,
      title: config.title,
      description: config.description,
      icon: config.icon,
      category: config.category,
      generatedAt: new Date().toISOString(),
      sourceFiles: [`<companion>/${config.companion}/README.md`],
      sections,
    };
  };
}

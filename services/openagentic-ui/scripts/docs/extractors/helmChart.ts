import { resolve, relative, basename } from 'path';
import { readdir, stat } from 'fs/promises';
import type { Extractor, DocManifest, DocItem } from '../types';

export interface HelmChartConfig {
  domain: string;
  title: string;
  description: string;
  icon: string;
  category: string;
  chartPath: string;
}

export function helmChart(config: HelmChartConfig): Extractor {
  return async (basePath: string): Promise<DocManifest> => {
    const templatesDir = resolve(basePath, config.chartPath, 'templates');
    let entries: string[] = [];
    try {
      entries = await readdir(templatesDir);
    } catch {
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
          title: 'Chart not present',
          description: `${config.chartPath} not present at build time. openagentic-helm is now SoT — chart may live in the separate repo.`,
          adminOnly: false,
          items: [],
        }],
      };
    }

    const items: DocItem[] = [];
    for (const e of entries.sort((a, b) => a.localeCompare(b))) {
      if (!e.endsWith('.yaml') && !e.endsWith('.yml')) continue;
      const abs = resolve(templatesDir, e);
      const s = await stat(abs);
      if (!s.isFile()) continue;
      items.push({
        id: e,
        name: basename(e, '.yaml').replaceAll('-', ' '),
        description: `Template ${e}`,
        type: 'helm-template',
        sourceFile: relative(basePath, abs),
      });
    }

    return {
      domain: config.domain,
      title: config.title,
      description: config.description,
      icon: config.icon,
      category: config.category,
      generatedAt: new Date().toISOString(),
      sourceFiles: items.map((i) => i.sourceFile!).filter(Boolean),
      sections: [{
        id: 'templates',
        title: 'Templates',
        description: 'All Helm chart templates',
        adminOnly: false,
        items,
      }],
    };
  };
}

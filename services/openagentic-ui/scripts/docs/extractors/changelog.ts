import { resolve, relative } from 'path';
import { readFile } from 'fs/promises';
import type { Extractor, DocManifest, DocSection, DocItem } from '../types';

export interface ChangelogConfig {
  /** Path (relative to repo root) to version.json. */
  path: string;
}

interface ReleaseEntry {
  version?: string;
  date?: string;
  codename?: string;
  highlights?: string[];
  breaking?: string[];
  features?: string[];
  fixes?: string[];
  notes?: string;
}

interface VersionJson {
  version?: string;
  codename?: string;
  releaseDate?: string;
  changelog?: ReleaseEntry[];
}

/** Stable kebab id for a release version (e.g. `1.0.0` -> `v1-0-0`). */
function versionId(version: string): string {
  return 'v' + version.replace(/[^a-z0-9]+/gi, '-');
}

/**
 * Source-derive the platform changelog from version.json.
 *
 * version.json is the single source of truth for release history. The hand-
 * written ChangelogPage.tsx had been drifting from it (it still listed a stale
 * 0.7.x history while version.json shipped 1.0.0 "Open Field"). Emitting the
 * changelog here makes it a generated FACT so the docs page consumes/asserts
 * against it instead of carrying its own copy — and the sync-guard test pins
 * the generated `current` version to version.json so it can never go stale.
 *
 * One section per release; one DocItem per highlight / breaking note / fix.
 * Deterministic + offline (single file read, no yaml/json deps beyond JSON.parse).
 */
export function changelog(config: ChangelogConfig): Extractor {
  return async (basePath: string): Promise<DocManifest> => {
    const abs = resolve(basePath, config.path);
    const rel = relative(basePath, abs);

    let parsed: VersionJson = {};
    try {
      parsed = JSON.parse(await readFile(abs, 'utf-8')) as VersionJson;
    } catch {
      parsed = {};
    }

    const releases = Array.isArray(parsed.changelog) ? parsed.changelog : [];
    const currentVersion = parsed.version ?? '';

    const sections: DocSection[] = [];
    for (const rel0 of releases) {
      const version = (rel0.version ?? '').trim();
      if (!version) continue;
      const isCurrent = version === currentVersion;
      const sid = versionId(version);

      const items: DocItem[] = [];
      const push = (
        kind: 'highlight' | 'breaking' | 'feature' | 'fix',
        list: string[] | undefined,
      ) => {
        (list ?? []).forEach((text, i) => {
          const line = String(text).trim();
          if (!line) return;
          items.push({
            id: `${sid}--${kind}-${i}`,
            name: line.split('—')[0].trim().slice(0, 80) || line.slice(0, 80),
            description: line,
            type: `changelog-${kind}`,
            properties: { kind, version },
            sourceFile: rel,
          });
        });
      };

      push('highlight', rel0.highlights);
      push('breaking', rel0.breaking);
      // features/fixes are richer detail on older internal releases; keep them
      // so the generated changelog is the complete record.
      push('feature', rel0.features);
      push('fix', rel0.fixes);

      const codename = (rel0.codename ?? '').trim();
      const date = (rel0.date ?? '').trim();
      const descParts = [
        codename ? `“${codename}”` : '',
        date,
        isCurrent ? '(current)' : '',
      ].filter(Boolean);

      sections.push({
        id: sid,
        title: `v${version}${codename ? ` — ${codename}` : ''}`,
        description: descParts.join(' '),
        adminOnly: false,
        items,
      });
    }

    return {
      domain: 'changelog',
      title: 'Changelog',
      description:
        'Release history, source-derived from version.json — the single source of truth for platform versions.',
      icon: 'brain',
      category: 'core',
      generatedAt: new Date().toISOString(),
      sourceFiles: [rel],
      sections,
    };
  };
}

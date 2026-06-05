import React, { useEffect, useMemo } from 'react';
import { motion } from 'framer-motion';
import { useDocsStore } from '@/stores/useDocsStore';

/**
 * ChangelogPage — release history, SOURCE-READ from the generated changelog
 * manifest (public/docs/generated/changelog.json), which the docs generator
 * derives from version.json (the single source of truth for platform versions).
 *
 * There is no hand-maintained release array here anymore: the page used to ship
 * its own copy that drifted from version.json (it still listed a stale 0.7.x
 * history while the platform shipped 1.0.0 "Open Field"). Now every release,
 * codename, date, and highlight comes straight from the generated FACT.
 */

interface ChangelogItem {
  id: string;
  name: string;
  description?: string;
  type?: string;
  properties?: { kind?: string; version?: string };
}

interface ChangelogSection {
  id: string;
  title: string;
  description?: string;
  items: ChangelogItem[];
}

// Per-change-kind label + tone (semantic tokens — not categorical brand hues).
const KIND_META: Record<string, { label: string; color: string }> = {
  highlight: { label: 'Highlight', color: 'var(--color-primary)' },
  breaking: { label: 'Breaking', color: 'var(--color-error)' },
  feature: { label: 'Feature', color: 'var(--color-success)' },
  fix: { label: 'Fix', color: 'var(--color-info)' },
};

const ChangelogPage: React.FC = () => {
  const { loadManifest, loadedManifests, index } = useDocsStore();

  useEffect(() => {
    if (!loadedManifests.has('changelog')) {
      loadManifest('changelog').catch(() => {});
    }
  }, [loadManifest, loadedManifests]);

  const manifest = loadedManifests.get('changelog');
  const currentVersion = index?.version;

  const sections = useMemo<ChangelogSection[]>(
    () => (manifest?.sections as unknown as ChangelogSection[]) ?? [],
    [manifest],
  );

  return (
    <div className="max-w-4xl mx-auto px-8 py-12">
      <h1 className="text-2xl font-semibold mb-2" style={{ color: 'var(--color-text)' }}>
        Changelog
      </h1>
      <p className="text-sm mb-10" style={{ color: 'var(--color-textSecondary)' }}>
        Version history and release notes for the OpenAgentic platform, derived
        from <code>version.json</code> at build time.
      </p>

      {!manifest && (
        <div className="flex items-center gap-3 py-8" style={{ color: 'var(--color-textSecondary)' }}>
          <div
            className="w-4 h-4 border-2 border-current border-t-transparent rounded-full animate-spin"
            style={{ color: 'var(--color-textMuted)' }}
          />
          <span className="text-sm">Loading release history…</span>
        </div>
      )}

      <div className="relative">
        {/* Timeline line */}
        {sections.length > 0 && (
          <div
            className="absolute left-[18px] top-0 bottom-0 w-px"
            style={{ backgroundColor: 'var(--color-border)' }}
          />
        )}

        <div className="space-y-10">
          {sections.map((release, i) => {
            // The manifest title is `v1.0.0 — Open Field`; the description is
            // `"Open Field" 2026-06-04 (current)`. Derive the version + current
            // flag from the generated FACT (no hand-typed values).
            const versionFromProps = release.items[0]?.properties?.version;
            const versionLabel =
              versionFromProps ?? release.title.replace(/^v/, '').split('—')[0].trim();
            const codename = release.title.includes('—')
              ? release.title.split('—')[1].trim()
              : '';
            const isCurrent = currentVersion
              ? versionLabel === currentVersion
              : /\(current\)/i.test(release.description ?? '');

            return (
              <motion.div
                key={release.id}
                initial={{ opacity: 0, x: -10 }}
                animate={{ opacity: 1, x: 0 }}
                transition={{ delay: i * 0.05 }}
                className="relative pl-12"
              >
                {/* Timeline dot */}
                <div
                  className="absolute left-2.5 top-1 w-4 h-4 rounded-full border-2"
                  style={{
                    backgroundColor: isCurrent ? 'var(--color-primary)' : 'var(--color-surface)',
                    borderColor: isCurrent ? 'var(--color-primary)' : 'var(--color-border)',
                  }}
                />

                {/* Version header */}
                <div className="flex items-center gap-3 mb-3 flex-wrap">
                  <span className="text-lg font-semibold" style={{ color: 'var(--color-text)' }}>
                    v{versionLabel}
                  </span>
                  {codename && (
                    <span
                      className="text-xs px-2 py-0.5 rounded-full font-medium"
                      style={{
                        backgroundColor: isCurrent ? 'var(--color-primary)' : 'var(--color-surfaceSecondary)',
                        color: isCurrent ? 'white' : 'var(--color-textMuted)',
                      }}
                    >
                      {codename}
                    </span>
                  )}
                  {isCurrent && (
                    <span
                      className="text-[10px] px-1.5 py-0.5 rounded font-medium"
                      style={{ backgroundColor: 'color-mix(in srgb, var(--color-success) 12%, transparent)', color: 'var(--color-success)' }}
                    >
                      CURRENT
                    </span>
                  )}
                  <span className="text-xs" style={{ color: 'var(--color-textMuted)' }}>
                    {(release.description ?? '').replace(/\(current\)/i, '').replace(/["“”]/g, '').trim()}
                  </span>
                </div>

                {/* Changes */}
                <div
                  className="rounded-lg p-4"
                  style={{ backgroundColor: 'var(--color-surface)', border: '1px solid var(--color-border)' }}
                >
                  {release.items.length === 0 ? (
                    <p className="text-sm" style={{ color: 'var(--color-textMuted)' }}>
                      No detailed notes for this release.
                    </p>
                  ) : (
                    <ul className="space-y-2">
                      {release.items.map((item) => {
                        const kind = item.properties?.kind ?? 'highlight';
                        const meta = KIND_META[kind] ?? KIND_META.highlight;
                        return (
                          <li
                            key={item.id}
                            className="flex items-start gap-2 text-sm"
                            style={{ color: 'var(--color-textSecondary)' }}
                          >
                            <span
                              className="text-[9px] font-semibold px-1.5 py-0.5 rounded uppercase tracking-wider flex-shrink-0 mt-0.5"
                              style={{
                                backgroundColor: `color-mix(in srgb, ${meta.color} 12%, transparent)`,
                                color: meta.color,
                              }}
                            >
                              {meta.label}
                            </span>
                            <span>{item.description ?? item.name}</span>
                          </li>
                        );
                      })}
                    </ul>
                  )}
                </div>
              </motion.div>
            );
          })}
        </div>
      </div>
    </div>
  );
};

export default ChangelogPage;

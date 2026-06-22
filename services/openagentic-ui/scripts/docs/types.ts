/**
 * Documentation Generator Types
 *
 * Shared types for all doc generators. Each domain produces a DocManifest
 * that is written to public/docs/generated/{domain}.json.
 *
 * UI consumers (DocsViewer, DocsContent, useDocsStore) depend on the shapes
 * of DocItem/DocSection/DocManifest/DocsIndex — do not change those without
 * a coordinated UI-side change.
 */

export interface DocItem {
  id: string;
  name: string;
  description: string;
  type?: string;
  properties?: Record<string, unknown>;
  sourceFile?: string;
  sourceLine?: number;
}

export interface DocSection {
  id: string;
  title: string;
  description: string;
  adminOnly: boolean;
  items: DocItem[];
}

export interface DocManifest {
  domain: string;
  title: string;
  description: string;
  icon: string;
  category: string;
  generatedAt: string;
  sourceFiles: string[];
  sections: DocSection[];
}

export interface DocsIndex {
  generatedAt: string;
  version: string;
  codename?: string;
  categories: Array<{ id: string; title: string; icon: string }>;
  manifests: Array<{
    domain: string;
    title: string;
    description: string;
    category: string;
    file: string;
    sectionCount: number;
    itemCount: number;
    adminOnly: boolean;
  }>;
}

// ---------- Unified docs generator types (2026-05-13) ----------

export type Extractor = (basePath: string) => Promise<DocManifest>;

export interface InvariantResult {
  ok: boolean;
  message: string;
  missing?: string[];
}

export type InvariantFn = (manifest: DocManifest, basePath: string) => Promise<InvariantResult>;

export interface DomainConfig {
  domain: string;
  title: string;
  description: string;
  icon: string;
  category: string;
  extractor: Extractor;
  invariants: InvariantFn[];
}

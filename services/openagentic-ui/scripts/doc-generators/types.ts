/**
 * Documentation Generator Types
 *
 * Shared types for all doc generators. Each generator produces a DocManifest
 * that is written to public/docs/generated/{domain}.json.
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

export type DocGenerator = (basePath: string) => Promise<DocManifest | null>;

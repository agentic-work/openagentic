/**
 * Copyright 2026 Gnomus.ai
 *
 * Licensed under the Apache License, Version 2.0 (the "License");
 * you may not use this file except in compliance with the License.
 * You may obtain a copy of the License at
 *
 *     http://www.apache.org/licenses/LICENSE-2.0
 *
 * Unless required by applicable law or agreed to in writing, software
 * distributed under the License is distributed on an "AS IS" BASIS,
 * WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
 * See the License for the specific language governing permissions and
 * limitations under the License.
 */

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

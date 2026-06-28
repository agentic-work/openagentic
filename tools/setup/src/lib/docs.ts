// All wizard doc links point at the docs ROOT. The per-section pages
// (/docs/deploy, /docs/providers, …) don't exist yet, so everything resolves to
// https://www.openagentics.io/docs/. Used by the persistent Footer, the `?` Help
// overlay, and the `d`-opens-docs key.

const BASE = 'https://www.openagentics.io/docs/';

export interface DocLink {
  url: string;
  label: string;
}

/** Resolve a step title to its docs page — currently always the docs root. */
export function getDocFor(_title?: string): DocLink {
  return { url: BASE, label: 'docs' };
}

export const DOCS_ROOT = BASE;

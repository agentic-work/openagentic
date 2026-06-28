/**
 * stripMarkdownTables — server-side mdast-driven removal of markdown
 * tables from assistant prose when the same turn emitted a
 * `compose_visual({template:'table'})` artifact.
 *
 * Why: the UI's SharedMarkdownRenderer swaps every markdown `<table>`
 * to a canonical <V2StreamingTable> (the same primitive
 * compose_visual({template:'table'}) renders). When the model emits
 * both, the user sees the data TWICE. Visible Sev-0 #1069.
 *
 * How: parse the prose to mdast via unified+remark-parse+remark-gfm,
 * walk the tree, drop any `table` node, re-serialize with
 * remark-stringify. Inline pipes (e.g. in code blocks or shell
 * commands) are NOT parsed as table cells by remark-gfm, so they
 * survive byte-identical.
 *
 * Gate: `shouldStrip` boolean from the caller. The caller knows
 * whether the turn emitted a streaming_table / viz_render:table
 * artifact; this helper just executes the strip. Callers that pass
 * false get the input back verbatim (zero overhead).
 *
 * Called from the chat-message finalize site (ChatStorageService write)
 * so the persisted + reloaded message has no markdown table — only the
 * canonical compose_visual artifact renders. The streamed turn flickers
 * a markdown table briefly during streaming; the reload state is clean.
 */
import { unified } from 'unified';
import remarkParse from 'remark-parse';
import remarkGfm from 'remark-gfm';
import remarkStringify from 'remark-stringify';
import type { Root, RootContent } from 'mdast';

let cachedProcessor: ReturnType<typeof buildProcessor> | null = null;

function buildProcessor() {
  return unified()
    .use(remarkParse)
    .use(remarkGfm)
    .use(remarkStringify, {
      bullet: '-',
      fences: true,
      rule: '-',
    });
}

function getProcessor() {
  if (!cachedProcessor) cachedProcessor = buildProcessor();
  return cachedProcessor;
}

export function stripMarkdownTables(input: string, shouldStrip: boolean): string {
  if (!shouldStrip) return input;
  if (!input || typeof input !== 'string') return input;
  // Cheap pre-check: if no pipe characters exist at all, no possible
  // markdown table — skip the full parse to keep the hot path cheap.
  if (input.indexOf('|') === -1) return input;

  try {
    const processor = getProcessor();
    const tree = processor.parse(input) as Root;
    const beforeChildren = tree.children.length;
    tree.children = tree.children.filter((node: RootContent) => node.type !== 'table');
    if (tree.children.length === beforeChildren) {
      // No table nodes found — return verbatim to preserve byte-for-byte
      // identity for the no-table case (avoids serializer roundtrip drift).
      return input;
    }
    const out = processor.stringify(tree) as string;
    return out.trimEnd();
  } catch {
    // Parse/serialize failure → return verbatim. Better to ship the dup
    // than to drop the message entirely.
    return input;
  }
}

/**
 * WebSearchTool — meta-tool definition for the chat-pipeline refactor 10-primitive
 * T1 catalog (the chat-pipeline refactor plan §Phase C, task C.9).
 *
 * Promoted from MCP-only to T1 always-on so the model has public-internet
 * access without needing to discover it via tool_search first. Use cases:
 * current events, citations, public docs/APIs, outside-platform context.
 *
 * Wire-up note: dispatcher delegates to the existing web MCP server's
 * search endpoint. The T1 wrapper exists so the description can steer
 * the model away from confusion with tool_search (platform catalog) and
 * the Sev-0 SSRF risk in the underlying web MCP (see audit
 * docs/audit/2026-05-08-services/mcps.md).
 */

const DESCRIPTION = [
  'Search the PUBLIC INTERNET. Returns web search results (titles,',
  'snippets, URLs) for the given query. Use when the user asks about',
  'current events, public companies, public APIs/docs, citations, or',
  'anything that lives outside the platform.',
  '',
  'Distinct from tool_search (which expands your TOOL catalog) and from',
  'any internal kb_search / docs RAG (which queries platform-internal',
  'documentation). web_search is the only T1 primitive that reaches the',
  'public web for read.',
  '',
  'Pair with web_fetch when a result URL is worth pulling into full',
  'context. Don\'t paste raw search results back to the user — synthesize.',
].join('\n');

export const WEB_SEARCH_TOOL = {
  type: 'function' as const,
  function: {
    name: 'web_search',
    description: DESCRIPTION,
    parameters: {
      type: 'object' as const,
      properties: {
        query: {
          type: 'string' as const,
          description:
            'Plain-language search query. Examples: "Azure VM pricing 2026", "kubernetes 1.30 release notes".',
        },
        max_results: {
          type: 'integer' as const,
          description: 'How many results to return. Default 5, max 20.',
          default: 5,
          minimum: 1,
          maximum: 20,
        },
      },
      required: ['query'] as string[],
      additionalProperties: false as const,
    },
  },
};

export function isWebSearchTool(name: string): boolean {
  return name === 'web_search';
}

export interface WebSearchInput {
  query: string;
  max_results?: number;
}

export interface WebSearchHit {
  title: string;
  url: string;
  snippet: string;
}

export interface WebSearchResult {
  ok: boolean;
  output?: string;
  error?: string;
  hits?: ReadonlyArray<WebSearchHit>;
}

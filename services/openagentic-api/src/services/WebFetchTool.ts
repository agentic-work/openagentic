/**
 * WebFetchTool — meta-tool definition for the chat-pipeline refactor 10-primitive
 * T1 catalog (the chat-pipeline refactor plan §Phase C, task C.10).
 *
 * Companion to web_search: pulls a single URL into context (extracts
 * readable text content) so the model can read referenced pages without
 * re-searching. Promoted from MCP-only to T1 always-on.
 *
 * Wire-up note: dispatcher delegates to the existing web MCP server's
 * fetch endpoint. The T1 wrapper exists so the description steers the
 * model to pair web_search → web_fetch correctly, and so the SSRF
 * mitigation contract (audit Sev-0 §1) is enforced at one place.
 */

const DESCRIPTION = [
  'Fetch a single URL and return its readable content (HTML stripped to',
  'text, PDFs extracted, images skipped). Companion to web_search — when',
  'a search hit looks promising, web_fetch pulls it into context so you',
  'can read it.',
  '',
  'Use when:',
  '  - the user gave you a URL directly ("summarize this article: …")',
  '  - web_search returned a high-signal result you need to read in full',
  '  - a tool result references a URL with details that matter',
  '',
  'WHAT IT RETURNS: extracted plain-text content (capped to a budget so',
  'one fetch can\'t blow your context).',
].join('\n');

export const WEB_FETCH_TOOL = {
  type: 'function' as const,
  function: {
    name: 'web_fetch',
    description: DESCRIPTION,
    parameters: {
      type: 'object' as const,
      properties: {
        url: {
          type: 'string' as const,
          description:
            'Absolute URL to fetch. Must be http:// or https://. Server enforces SSRF denylist (no IMDS, no metadata endpoints, no RFC1918, no *.svc.cluster.local).',
        },
        max_chars: {
          type: 'integer' as const,
          description:
            'Max characters of extracted text to return. Default 8000.',
          default: 8000,
          minimum: 500,
          maximum: 64000,
        },
      },
      required: ['url'] as string[],
      additionalProperties: false as const,
    },
  },
};

export function isWebFetchTool(name: string): boolean {
  return name === 'web_fetch';
}

export interface WebFetchInput {
  url: string;
  max_chars?: number;
}

export interface WebFetchResult {
  ok: boolean;
  output?: string;
  error?: string;
  url?: string;
  content?: string;
  content_type?: string;
}

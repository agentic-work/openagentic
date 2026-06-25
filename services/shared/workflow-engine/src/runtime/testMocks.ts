/**
 * Test mocks — wire format + resolver.
 *
 * Phase B blocker (#17): WorkflowTestRunner used to instantiate the
 * engine in-process and inject function-based mocks. With the engine
 * moving to a remote workflows-svc pod, mocks must traverse HTTP — so
 * function responses drop in favor of static `response` values. The
 * resolver below is the pure decision function the executor consults
 * before reaching for the network.
 */

export interface MockMcpToolEntry {
  /** Exact match required (case-sensitive). */
  toolName: string;
  /** Optional MCP server filter. Match is normalized
   *  (hyphens→underscores, trailing _mcp stripped) on both sides so
   *  `oap-azure-mcp` and `openagentic_azure` resolve to the same entry. */
  server?: string;
  /** Static JSON-safe response returned when matched. */
  response: any;
  /** Optional artificial delay before returning (ms). */
  delay?: number;
  /** Force the executor to throw with `errorMessage`. */
  shouldFail?: boolean;
  errorMessage?: string;
}

export interface MockLLMResponseEntry {
  /** Optional regex-string applied to the rendered prompt. */
  pattern?: string;
  /** Optional model-id filter (exact match). */
  model?: string;
  response: string;
  delay?: number;
  shouldFail?: boolean;
  errorMessage?: string;
}

export interface TestMocks {
  mcpTools?: MockMcpToolEntry[];
  llmResponses?: MockLLMResponseEntry[];
}

export interface ResolvedMcpMock {
  matched: true;
  response: any;
  delay?: number;
  shouldFail: boolean;
  errorMessage?: string;
}

function normalizeServer(name: string | undefined): string | undefined {
  if (!name) return undefined;
  return String(name).replaceAll('-', '_').replace(/_mcp$/, '');
}

export function resolveMockMcpResponse(
  toolName: string,
  server: string | undefined,
  mocks: TestMocks | undefined,
): ResolvedMcpMock | null {
  if (!mocks?.mcpTools?.length) return null;
  const normalizedRequestServer = normalizeServer(server);

  for (const entry of mocks.mcpTools) {
    if (entry.toolName !== toolName) continue;
    if (entry.server !== undefined) {
      const normalizedEntryServer = normalizeServer(entry.server);
      if (normalizedEntryServer !== normalizedRequestServer) continue;
    }
    return {
      matched: true,
      response: entry.response,
      delay: entry.delay,
      shouldFail: !!entry.shouldFail,
      errorMessage: entry.errorMessage,
    };
  }
  return null;
}

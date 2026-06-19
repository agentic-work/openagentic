/**
 * mcp_tool node executor.
 *
 * Migrated from WorkflowExecutionEngine.executeMCPToolNode (heaviest node in
 * batch 3 — preserves all parameter-coercion logic and 3-layer error
 * unwrapping).
 *
 * Auth: this node runs AS the user — uses ctx.authToken (NOT internal-secret)
 * + optional X-AWS-ID-Token / X-Azure-ID-Token for OBO federation.
 */

import type { WorkflowNode } from '../types.js';
import type { NodeExecutionContext } from '../types.js';
import { abortableAxiosPost } from '../../abortableAxios.js';
import { resolveMockMcpResponse } from '../../runtime/testMocks.js';

const LLM_OUTPUT_FIELDS = new Set([
  'content',
  'model',
  'usage',
  'provider',
  '_costMeta',
  'message',
  'role',
]);

export async function execute(
  node: WorkflowNode,
  input: unknown,
  ctx: NodeExecutionContext,
): Promise<unknown> {
  if (!ctx.mcpProxyUrl) {
    throw new Error('mcp_tool requires ctx.mcpProxyUrl (MCP_PROXY_URL env)');
  }

  const data = (node.data || {}) as Record<string, any>;
  const {
    toolName,
    toolServer: toolServerRaw,
    serverName,
    arguments: argsField,
    toolParams,
    toolArgs: toolArgsField,
  } = data;
  const toolServer = toolServerRaw || serverName;

  // Normalize server name: hyphens → underscores, strip trailing _mcp.
  const normalizedServer = toolServer
    ? String(toolServer).replace(/-/g, '_').replace(/_mcp$/, '')
    : toolServer;

  // Interpolate string values in arguments. Object values pass through.
  const rawArgs = argsField || toolArgsField || toolParams || {};
  const resolvedArgs: Record<string, any> = {};
  for (const [key, value] of Object.entries(rawArgs)) {
    if (typeof value === 'string') {
      resolvedArgs[key] = ctx.interpolateTemplate(value, input);
    } else {
      resolvedArgs[key] = value;
    }
  }

  // Smart parameter coercion: if args are blank but upstream input exists,
  // try to derive parameters from the input. Mirrors legacy behavior 1:1.
  const hasEmptyArgs =
    Object.keys(resolvedArgs).length === 0 ||
    Object.values(resolvedArgs).every(
      (v) => v === '' || v === undefined || v === null,
    );
  if (hasEmptyArgs && input) {
    const inputObj = input as any;
    const inputStr = typeof input === 'string' ? input : JSON.stringify(input);

    if (toolName === 'web_search' || toolName === 'web_news_search') {
      resolvedArgs.query =
        typeof input === 'string'
          ? input.substring(0, 500)
          : inputObj?.query ||
            inputObj?.search ||
            inputObj?.text ||
            inputObj?.message ||
            inputStr.substring(0, 500);
    } else if (toolName?.startsWith('k8s_') && !resolvedArgs.namespace) {
      resolvedArgs.namespace = inputObj?.namespace || process.env.OPENAGENTIC_NAMESPACE || 'default';
      if (inputObj?.deployment_name) resolvedArgs.deployment_name = inputObj.deployment_name;
      if (inputObj?.deployment) resolvedArgs.deployment_name = inputObj.deployment;
    } else if (toolName === 'loki_query' && !resolvedArgs.query) {
      resolvedArgs.query =
        inputObj?.query ||
        inputObj?.loki_query ||
        `{namespace="${inputObj?.namespace || process.env.OPENAGENTIC_NAMESPACE || 'default'}"}`;
    } else if (typeof input === 'object' && !Array.isArray(input)) {
      // Generic: pass simple object values, but skip LLM-output leakage fields.
      for (const [k, v] of Object.entries(inputObj)) {
        if (
          !k.startsWith('__') &&
          !LLM_OUTPUT_FIELDS.has(k) &&
          typeof v !== 'object'
        ) {
          resolvedArgs[k] = v;
        }
      }
    }
  }

  // Strip internal workflow properties that MCP tools don't expect.
  delete resolvedArgs.__sharedContext;
  delete resolvedArgs.__nodeId;
  delete resolvedArgs.__executionId;

  // Route web_search and web_news_search through openagentic_web (Searx on K8s).
  const effectiveServer =
    toolName === 'web_search' || toolName === 'web_news_search'
      ? 'openagentic_web'
      : normalizedServer;

  // Test-mocks short-circuit (Phase B #17). When ctx.testMocks contains
  // a matching mcpTool entry, return the mock instead of hitting the
  // proxy. Lets WorkflowTestRunner drive deterministic test runs against
  // the remote workflows-svc engine without standing up real MCP backends.
  const mock = resolveMockMcpResponse(toolName, effectiveServer, ctx.testMocks);
  if (mock) {
    if (mock.delay && mock.delay > 0) {
      await new Promise((r) => setTimeout(r, mock.delay));
    }
    if (mock.shouldFail) {
      throw new Error(mock.errorMessage || `mcp_tool: mocked failure for ${toolName}`);
    }
    ctx.logger.info(
      { nodeId: node.id, toolName, toolServer: effectiveServer, mocked: true },
      '[mcp_tool] Returning mocked response (test-mode)',
    );
    return mock.response;
  }

  ctx.logger.info(
    {
      nodeId: node.id,
      toolName,
      toolServer: effectiveServer,
      originalServer: toolServer,
    },
    '[mcp_tool] Executing',
  );

  const response = await abortableAxiosPost(
    { signal: ctx.signal },
    `${ctx.mcpProxyUrl}/call`,
    {
      server: effectiveServer,
      tool: toolName,
      arguments: resolvedArgs,
    },
    {
      headers: {
        'Content-Type': 'application/json',
        // Prefer the service-internal key (System Root) so mcp-proxy authorizes
        // WITHOUT a per-user policy round-trip to the api. The user-token path
        // is fragile: mcp-proxy must reach the api to resolve group policies,
        // which fails transiently and 401s the whole tool call (made grounded
        // flows non-deterministic). Single-tenant: System Root is correct.
        Authorization:
          (process.env.API_INTERNAL_KEY || process.env.INTERNAL_API_KEY)
            ? `Bearer ${process.env.API_INTERNAL_KEY || process.env.INTERNAL_API_KEY}`
            : (ctx.authToken || ''),
        // Pass ID token for AWS Identity Center and Azure OBO federation.
        ...(ctx.idToken
          ? {
              'X-AWS-ID-Token': ctx.idToken,
              'X-Azure-ID-Token': ctx.idToken,
            }
          : {}),
      },
      timeout: 60000,
      validateStatus: () => true,
    },
  );

  // HTTP-level error.
  if (response.status >= 400) {
    const errorMsg =
      response.data?.error ||
      response.data?.message ||
      `MCP call failed with HTTP ${response.status}`;
    throw new Error(`MCP tool "${toolName}" failed: ${errorMsg}`);
  }

  const proxyResponse = response.data;

  // Layer 0: proxy-level error envelope.
  if (
    proxyResponse?.error &&
    typeof proxyResponse.error === 'object' &&
    proxyResponse.error.code
  ) {
    const errMsg = proxyResponse.error.message || 'MCP proxy error';
    throw new Error(`MCP tool "${toolName}" error: ${errMsg}`);
  }

  // Layer 1: unwrap proxy wrapper → JSONRPC response.
  const jsonrpcResponse = proxyResponse?.result ?? proxyResponse;

  // Layer 2: JSONRPC-level error.
  if (jsonrpcResponse?.error) {
    const errMsg =
      jsonrpcResponse.error.message ||
      jsonrpcResponse.error.data ||
      JSON.stringify(jsonrpcResponse.error);
    throw new Error(`MCP tool "${toolName}" error: ${errMsg}`);
  }

  // Layer 3: unwrap JSONRPC result → MCP tool result.
  const mcpResult = jsonrpcResponse?.result ?? jsonrpcResponse;

  if (mcpResult && typeof mcpResult === 'object') {
    if (mcpResult.isError) {
      const errContent = mcpResult.content?.[0]?.text || 'Unknown MCP error';
      throw new Error(`MCP tool "${toolName}" error: ${errContent}`);
    }

    // Tool-level failure inside content blocks.
    if (Array.isArray(mcpResult.content)) {
      for (const block of mcpResult.content) {
        if (block?.type === 'text' && typeof block.text === 'string') {
          try {
            const parsed = JSON.parse(block.text);
            if (
              parsed &&
              typeof parsed === 'object' &&
              parsed.success === false &&
              parsed.error
            ) {
              const errMsg =
                typeof parsed.error === 'string'
                  ? parsed.error
                  : JSON.stringify(parsed.error);
              const errType = parsed.error_type ? ` (${parsed.error_type})` : '';
              throw new Error(`MCP tool "${toolName}" failed${errType}: ${errMsg}`);
            }
          } catch (parseErr) {
            if (
              parseErr instanceof Error &&
              parseErr.message.startsWith(`MCP tool "${toolName}"`)
            ) {
              throw parseErr;
            }
          }
        }
      }
    }

    // Top-level success:false flat result.
    if (
      mcpResult.success === false &&
      (mcpResult.error || mcpResult.error_message)
    ) {
      const errMsg = mcpResult.error || mcpResult.error_message;
      const errType = mcpResult.error_type ? ` (${mcpResult.error_type})` : '';
      throw new Error(
        `MCP tool "${toolName}" failed${errType}: ${
          typeof errMsg === 'string' ? errMsg : JSON.stringify(errMsg)
        }`,
      );
    }
  }

  // Normalize: lift typed-tool fields to top level + join content blocks.
  //
  // Live mcp-proxy emits the MCP-standard envelope per the spec:
  //   { content: [...], structuredContent: { <python dict> }, isError }
  //
  // FastMCP additionally wraps the python tool's return value under a
  // `result` key inside structuredContent (live shape captured via
  // diagnostic 2026-05-14 against openagentic_kubernetes.k8s_list_pods):
  //   structuredContent: { result: { success, namespace, pods, count, ... } }
  // When that single-key `result` wrap is present, peel it so the
  // python dict's own fields surface at top level — that matches what
  // tool authors mean by `structuredContent`.
  //
  // Downstream typed nodes (extract_key path='pods', filter_data
  // items='{{input.pods}}', select_data input='{{input.pods}}') expect
  // the python dict's fields at top level. We lift them additively:
  //
  //   1. Peel structuredContent.result when it's the sole wrap.
  //   2. Spread the resulting dict's keys at top level.
  //   3. Keep `structuredContent` as a sibling for back-compat with
  //      callers that already deep-path (chatmode ToolEnvelopeSplitter,
  //      slug 3 k8s-crashloop-triage template asserts both shapes).
  //   4. Envelope keys (`content` joined text, `isError`) always win
  //      over any same-named field inside structuredContent — the
  //      joined text is the authoritative LLM-facing content.
  //
  // Regression: reports/flows-shared-context-fix/2026-05-14/evidence.md.
  if (mcpResult && typeof mcpResult === 'object') {
    const hasContent = Array.isArray(mcpResult.content);
    let sc: Record<string, unknown> | null = null;
    if (
      mcpResult.structuredContent &&
      typeof mcpResult.structuredContent === 'object' &&
      !Array.isArray(mcpResult.structuredContent)
    ) {
      sc = mcpResult.structuredContent as Record<string, unknown>;
      // FastMCP convention: peel a sole `result` wrap if present.
      const keys = Object.keys(sc);
      if (
        keys.length === 1 &&
        keys[0] === 'result' &&
        sc.result &&
        typeof sc.result === 'object' &&
        !Array.isArray(sc.result)
      ) {
        sc = sc.result as Record<string, unknown>;
      }
    }

    if (hasContent || sc) {
      const lifted: Record<string, unknown> = sc ? { ...sc } : {};
      // mcpResult fields override structuredContent fields — envelope
      // wins over inner dict for same-named keys.
      for (const [k, v] of Object.entries(mcpResult as Record<string, unknown>)) {
        lifted[k] = v;
      }
      if (hasContent) {
        const textContent = (mcpResult.content as Array<any>)
          .filter((b: any) => b?.type === 'text' && typeof b.text === 'string')
          .map((b: any) => b.text)
          .join('\n');
        lifted.content = textContent || JSON.stringify(mcpResult.content);
      }
      return lifted;
    }
  }

  return mcpResult;
}

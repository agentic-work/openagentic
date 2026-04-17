import axios from 'axios';
import { logger } from '../utils/logger';

interface ToolCallResult {
  toolName: string;
  toolCallId: string;
  result: any;
  error?: string;
  executionTimeMs: number;
}

interface MCPBridgeConfig {
  mcpProxyUrl: string;
  timeout?: number;
}

export class MCPBridge {
  private mcpProxyUrl: string;
  private timeout: number;

  constructor(config: MCPBridgeConfig) {
    this.mcpProxyUrl = config.mcpProxyUrl;
    this.timeout = config.timeout || 30000;
  }

  // Dynamic timeout: typed cloud-resource creates (e.g. azure_create_app_gateway,
  // azure_create_front_door, azure_create_vm) can take minutes to provision,
  // so bump their timeout. Azure Front Door / App Gateway typically 5-15 min.
  private getToolTimeout(toolName: string): number {
    if (/^azure_create_(app_gateway|front_door|aks_cluster|vm)/.test(toolName)) {
      return 900000; // 15 minutes — heavy provisioning
    }
    if (toolName.startsWith('azure_') || toolName.startsWith('aws_') || toolName.startsWith('aif_')) {
      return 120000; // 2 minutes for general cloud operations
    }
    return this.timeout;
  }

  async callTool(
    toolName: string,
    args: Record<string, any>,
    authHeaders: Record<string, string>
  ): Promise<ToolCallResult> {
    const start = Date.now();
    const toolTimeout = this.getToolTimeout(toolName);

    // CRITICAL OBO INJECTION: mcp-proxy /mcp/tool reads `meta.userAccessToken`
    // off the request body (NOT off the Authorization header) and injects it
    // into the user_info passed to the upstream MCP server. Without this,
    // oap-azure-mcp falls back to a default credential and Azure ARM returns
    // 401 "primary access token is invalid" because the request runs as the
    // platform service principal (or no identity at all) instead of as the
    // actual end user. We pull the access token straight off the Authorization
    // header that buildAuthHeaders set, strip the Bearer prefix, and inject it.
    //
    // We ALSO pass the user identity fields (user_email, user_name) so the
    // shared http_transport.py logging shows the actual user instead of
    // "unknown" / a stale platform admin email.
    const authHeader = authHeaders['Authorization'] || authHeaders['authorization'] || '';
    const userAccessToken = authHeader.startsWith('Bearer ')
      ? authHeader.substring(7)
      : authHeader;
    const userEmail = authHeaders['X-User-Email'] || authHeaders['x-user-email'] || '';
    const userId = authHeaders['X-User-ID'] || authHeaders['x-user-id'] || '';

    const meta: Record<string, any> = {};
    if (userAccessToken) meta.userAccessToken = userAccessToken;
    if (userEmail) {
      meta.user_email = userEmail;
      meta.userEmail = userEmail;
    }
    if (userId) {
      meta.user_id = userId;
      meta.userId = userId;
    }
    // Also pass the Azure ID token (separate audience) so oap-azure-mcp can
    // do OBO exchanges if needed.
    const azureIdToken = authHeaders['X-Azure-ID-Token'] || authHeaders['x-azure-id-token'];
    if (azureIdToken) meta.azureIdToken = azureIdToken;
    const awsIdToken = authHeaders['X-AWS-ID-Token'] || authHeaders['x-aws-id-token'];
    if (awsIdToken) meta.awsIdToken = awsIdToken;

    try {
      const response = await axios.post(
        `${this.mcpProxyUrl}/mcp/tool`,
        {
          tool: toolName,
          arguments: args,
          ...(Object.keys(meta).length > 0 ? { meta } : {}),
        },
        {
          headers: {
            'Content-Type': 'application/json',
            ...authHeaders,
          },
          timeout: toolTimeout,
        }
      );

      return {
        toolName,
        toolCallId: `mcp_${toolName}_${Date.now()}`,
        result: response.data?.result ?? response.data,
        executionTimeMs: Date.now() - start,
      };
    } catch (error: any) {
      logger.error({
        toolName,
        error: error.message,
        hasUserAccessToken: !!userAccessToken,
        hasUserEmail: !!userEmail,
      }, 'MCP tool call failed');
      return {
        toolName,
        toolCallId: `mcp_${toolName}_${Date.now()}`,
        result: null,
        error: error.response?.data?.error || error.message,
        executionTimeMs: Date.now() - start,
      };
    }
  }

  async batchCall(
    calls: Array<{ toolName: string; args: Record<string, any> }>,
    authHeaders: Record<string, string>
  ): Promise<ToolCallResult[]> {
    // mcp-proxy /batch-call requires per-call `server` (no auto-detect like /mcp/tool).
    // Agent-proxy doesn't track server-per-tool, so dispatch individual /mcp/tool calls
    // in parallel — the runtime cost is identical since /mcp/tool resolves the server.
    return Promise.all(calls.map(c => this.callTool(c.toolName, c.args, authHeaders)));
  }

  async listTools(authHeaders: Record<string, string>): Promise<any[]> {
    try {
      const response = await axios.get(`${this.mcpProxyUrl}/tools`, {
        headers: authHeaders,
        timeout: 10000,
      });
      const rawTools = response.data?.tools || response.data || [];

      // Convert MCP tool format {name, description, inputSchema} to OpenAI format
      // {type: "function", function: {name, description, parameters}}
      return rawTools.map((tool: any) => {
        // Already in OpenAI format
        if (tool.type === 'function' && tool.function) return tool;

        // Convert from MCP format
        return {
          type: 'function',
          function: {
            name: tool.name,
            description: tool.description || '',
            parameters: tool.inputSchema || { type: 'object', properties: {} },
          },
        };
      });
    } catch (error: any) {
      logger.error({ error: error.message }, 'Failed to list MCP tools');
      return [];
    }
  }
}

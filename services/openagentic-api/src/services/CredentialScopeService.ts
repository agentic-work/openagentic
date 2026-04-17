/**
 * Per-Tool Credential Scoping Service
 *
 * Maps MCP tools to the exact credentials they need.
 * Default: tool gets NO credentials unless explicitly mapped.
 * Prevents tools from receiving the user's full Azure AD token
 * when they only need a specific scope (or no credentials at all).
 */

import { prisma } from '../utils/prisma.js';
import type { Logger } from 'pino';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export type CredentialType =
  | 'azure_arm'       // Azure ARM access token
  | 'azure_graph'     // Azure Graph access token
  | 'azure_generic'   // Full Azure AD token (avoid if possible)
  | 'aws_session'     // AWS STS session credentials
  | 'gcp_token'       // GCP service account token
  | 'api_key'         // Named API key from SystemConfiguration
  | 'internal_only'   // No user credentials — internal service-to-service only
  | 'none';           // Explicitly no credentials

export interface CredentialScope {
  type: CredentialType;
  /** For azure types: OBO scope (e.g. 'https://management.azure.com/.default') */
  oboScope?: string;
  /** For api_key: the SystemConfiguration key name */
  apiKeyName?: string;
}

export interface UserCredentials {
  /** Azure AD access token (from OBO) */
  azureAccessToken?: string;
  /** Azure AD ID token */
  azureIdToken?: string;
  /** Raw JWT from auth */
  authToken?: string;
  /** Auth method */
  authMethod?: string;
  /** User ID */
  userId?: string;
  /** Additional named credentials */
  namedCredentials?: Record<string, string>;
}

export interface ScopedCredentials {
  /** The token to pass to the MCP tool (may be scoped or null) */
  accessToken?: string;
  /** ID token if needed */
  idToken?: string;
  /** Named API key if applicable */
  apiKey?: string;
  /** Whether this is an internal-only call (no user creds) */
  internalOnly: boolean;
  /** Credential type that was applied */
  scopeType: CredentialType;
}

// ---------------------------------------------------------------------------
// Default tool-to-credential mapping
// ---------------------------------------------------------------------------

const DEFAULT_TOOL_SCOPES: Record<string, CredentialScope> = {
  // Azure management tools → need ARM-scoped token only. Prefix match `azure_`
  // catches all typed tools (azure_create_*, azure_list_*, azure_get_*, etc.)
  // via the prefix-match fallback in getCredentialScopeForTool below.

  // Azure Graph tools → need Graph-scoped token only
  'azure_graph_execute': { type: 'azure_graph', oboScope: 'https://graph.microsoft.com/.default' },
  'azure_graph_list_users': { type: 'azure_graph', oboScope: 'https://graph.microsoft.com/.default' },
  'azure_graph_get_user': { type: 'azure_graph', oboScope: 'https://graph.microsoft.com/.default' },

  // AWS tools → AWS session (no Azure token)
  'aws_s3_list_buckets': { type: 'aws_session' },
  'aws_ec2_describe_instances': { type: 'aws_session' },
  'aws_lambda_list_functions': { type: 'aws_session' },
  'aws_bedrock_list_models': { type: 'aws_session' },

  // Web tools → no credentials
  'web_search': { type: 'none' },
  'web_fetch': { type: 'none' },

  // Memory tools → internal only
  'memory_store': { type: 'internal_only' },
  'memory_recall': { type: 'internal_only' },
  'memory_forget': { type: 'internal_only' },

  // Diagram tools → internal only
  'create_diagram': { type: 'internal_only' },
  'create_mermaid_diagram': { type: 'internal_only' },

  // Admin tools → internal only (admin check happens elsewhere)
  'admin_system_health': { type: 'internal_only' },
  'admin_list_users': { type: 'internal_only' },
  'admin_get_metrics': { type: 'internal_only' },

  // Code tools → internal only (auth via session token)
  'openagentic_execute': { type: 'internal_only' },
  'execute_code': { type: 'internal_only' },

  // Data layer tools → internal only
  'query_data': { type: 'internal_only' },
};

// ---------------------------------------------------------------------------
// CredentialScopeService
// ---------------------------------------------------------------------------

export class CredentialScopeService {
  private logger: Logger;
  private toolScopes: Record<string, CredentialScope>;
  private defaultScope: CredentialScope = { type: 'none' }; // Default: no credentials

  constructor(logger: Logger) {
    this.logger = logger.child({ component: 'CredentialScope' });
    this.toolScopes = { ...DEFAULT_TOOL_SCOPES };
  }

  /**
   * Load admin-configured tool credential mappings.
   */
  async loadConfig(): Promise<void> {
    try {
      const config = await prisma.systemConfiguration.findFirst({
        where: { key: 'tool_credential_scopes' },
      });
      if (config?.value) {
        const val = typeof config.value === 'string' ? JSON.parse(config.value) : config.value;
        if (val.scopes && typeof val.scopes === 'object') {
          Object.assign(this.toolScopes, val.scopes);
        }
        if (val.defaultScope) {
          this.defaultScope = val.defaultScope;
        }
        this.logger.info({
          configuredTools: Object.keys(val.scopes || {}).length,
        }, '[CRED-SCOPE] Loaded admin config');
      }
    } catch {
      // Use defaults
    }
  }

  /**
   * Scope credentials for a specific tool.
   * Returns only what the tool needs, nothing more.
   */
  scopeCredentials(toolName: string, userCredentials: UserCredentials): ScopedCredentials {
    const scope = this.getScope(toolName);

    switch (scope.type) {
      case 'none':
        return { internalOnly: false, scopeType: 'none' };

      case 'internal_only':
        return { internalOnly: true, scopeType: 'internal_only' };

      case 'azure_arm':
      case 'azure_graph':
        // Only pass the Azure access token — the MCP proxy will do OBO with the right scope
        return {
          accessToken: userCredentials.azureAccessToken,
          idToken: userCredentials.azureIdToken,
          internalOnly: false,
          scopeType: scope.type,
        };

      case 'azure_generic':
        return {
          accessToken: userCredentials.azureAccessToken,
          idToken: userCredentials.azureIdToken,
          internalOnly: false,
          scopeType: 'azure_generic',
        };

      case 'aws_session':
        // AWS credentials come from environment/role, not user token
        return { internalOnly: false, scopeType: 'aws_session' };

      case 'gcp_token':
        // GCP credentials come from service account, not user token
        return { internalOnly: false, scopeType: 'gcp_token' };

      case 'api_key':
        return {
          apiKey: userCredentials.namedCredentials?.[scope.apiKeyName ?? ''],
          internalOnly: false,
          scopeType: 'api_key',
        };

      default:
        this.logger.warn({ toolName, scopeType: scope.type }, '[CRED-SCOPE] Unknown scope type');
        return { internalOnly: false, scopeType: 'none' };
    }
  }

  /**
   * Get the credential scope for a tool.
   */
  getScope(toolName: string): CredentialScope {
    // Exact match first
    if (this.toolScopes[toolName]) return this.toolScopes[toolName];

    // Prefix match (e.g., 'azure_graph_*' matches 'azure_graph_list_users')
    for (const [pattern, scope] of Object.entries(this.toolScopes)) {
      if (pattern.endsWith('*') && toolName.startsWith(pattern.slice(0, -1))) {
        return scope;
      }
    }

    // Azure management tools without a dedicated entry → ARM scope (covers all
    // the typed azure_create_* / azure_list_* / azure_get_* tools).
    if (toolName.startsWith('azure_') && !toolName.startsWith('azure_graph_')) {
      return { type: 'azure_arm', oboScope: 'https://management.azure.com/.default' };
    }
    if (toolName.startsWith('azure_graph_')) {
      return { type: 'azure_graph', oboScope: 'https://graph.microsoft.com/.default' };
    }

    return this.defaultScope;
  }

  /**
   * Build MCP proxy headers with only scoped credentials.
   */
  buildScopedHeaders(
    toolName: string,
    userCredentials: UserCredentials,
    baseHeaders: Record<string, string> = {},
  ): Record<string, string> {
    const scoped = this.scopeCredentials(toolName, userCredentials);
    const headers = { ...baseHeaders };

    if (scoped.internalOnly) {
      // Remove user credential headers
      delete headers['X-Azure-Access-Token'];
      delete headers['X-Azure-ID-Token'];
      delete headers['Authorization'];
      return headers;
    }

    // Only include scoped credentials
    if (scoped.accessToken) {
      headers['X-Azure-Access-Token'] = scoped.accessToken;
    } else {
      delete headers['X-Azure-Access-Token'];
    }

    if (scoped.idToken) {
      headers['X-Azure-ID-Token'] = scoped.idToken;
    } else {
      delete headers['X-Azure-ID-Token'];
    }

    if (scoped.apiKey) {
      headers['X-API-Key'] = scoped.apiKey;
    }

    return headers;
  }

  /**
   * Get all configured scopes (for admin UI).
   */
  getAllScopes(): Record<string, CredentialScope> {
    return { ...this.toolScopes };
  }
}

// ---------------------------------------------------------------------------
// Singleton
// ---------------------------------------------------------------------------

let _instance: CredentialScopeService | null = null;

export function getCredentialScopeService(logger: Logger): CredentialScopeService {
  if (!_instance) {
    _instance = new CredentialScopeService(logger);
    _instance.loadConfig().catch(() => {});
  }
  return _instance;
}

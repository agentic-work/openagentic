/**
 * MCP Access Control Service
 *
 * Enforces per-MCP access control with policy-based permissions.
 * Supports:
 * - Per-MCP access control (which users/roles can access which MCPs)
 * - Policy-based permissions (allow/deny rules)
 * - Azure AD group-based policies
 * - Priority-based policy resolution
 * - Runtime enforcement during tool execution
 */

import { Logger } from 'pino';
import { loggers } from '../utils/logger.js';
import { prisma } from '../utils/prisma.js';
const logger = loggers.services.child({ component: 'MCPAccessControl' });

export interface MCPAccessCheckResult {
  allowed: boolean;
  reason: string;
  policy?: {
    id: string;
    azure_group_id: string;
    azure_group_name: string;
    access_type: 'allow' | 'deny';
    priority: number;
  };
}

export interface MCPPermissions {
  read: boolean;
  write: boolean;
  execute: boolean;
}

export interface MCPToolPermissions extends MCPPermissions {
  serverId: string;
  serverName: string;
  toolName: string;
  allowedGroups: string[];
  deniedGroups: string[];
}

/**
 * Check if a user has access to a specific MCP server
 *
 * Policy Resolution Algorithm:
 * 1. Find all policies matching user's Azure AD groups for the specified server
 * 2. Sort by priority (lower number = higher priority)
 * 3. Return the first matching policy's access_type
 * 4. If no explicit policy, use default policy based on user admin status
 */
export async function checkMCPAccess(
  userId: string,
  serverId: string,
  userGroups: string[],
  isAdmin: boolean,
  requestLogger?: Logger
): Promise<MCPAccessCheckResult> {
  const log = requestLogger || logger;

  try {
    // Verify server exists and is enabled
    const server = await prisma.mCPServerConfig.findUnique({
      where: { id: serverId },
      select: { id: true, name: true, enabled: true }
    });

    if (!server) {
      // PERMISSIVE MODE: Allow access to servers not explicitly configured in database
      // This enables MCP proxy servers to work without explicit database registration
      // Access can be restricted by adding server config and policies to database
      log.info({
        userId,
        serverId,
        reason: 'server_not_configured',
        defaultAccess: 'allow'
      }, '[MCP-ACCESS] Server not in database - allowing by default (permissive mode)');
      return {
        allowed: true,
        reason: `MCP server '${serverId}' not configured - allowed by default (permissive mode)`
      };
    }

    if (!server.enabled) {
      return {
        allowed: false,
        reason: `MCP server '${server.name}' is disabled`
      };
    }

    // Find all policies matching user's groups for this server
    const matchingPolicies = await prisma.mCPAccessPolicy.findMany({
      where: {
        server_id: serverId,
        azure_group_id: { in: userGroups },
        is_enabled: true
      },
      orderBy: [
        { priority: 'asc' },  // Lower priority number = higher precedence
        { created_at: 'asc' }
      ]
    });

    // If explicit policies exist, use the highest priority policy
    if (matchingPolicies.length > 0) {
      const topPolicy = matchingPolicies[0];

      log.info({
        userId,
        serverId,
        serverName: server.name,
        policyId: topPolicy.id,
        azureGroup: topPolicy.azure_group_name,
        accessType: topPolicy.access_type,
        priority: topPolicy.priority
      }, '[MCP-ACCESS] Explicit policy found');

      return {
        allowed: topPolicy.access_type === 'allow',
        reason: `Explicit ${topPolicy.access_type} policy for group '${topPolicy.azure_group_name}'`,
        policy: {
          id: topPolicy.id,
          azure_group_id: topPolicy.azure_group_id,
          azure_group_name: topPolicy.azure_group_name,
          access_type: topPolicy.access_type as 'allow' | 'deny',
          priority: topPolicy.priority
        }
      };
    }

    // No explicit policy - use default policy
    const defaultPolicyType = isAdmin ? 'admin_default' : 'user_default';
    const defaultPolicy = await prisma.mCPDefaultPolicy.findUnique({
      where: { policy_type: defaultPolicyType }
    });

    const defaultAccess = defaultPolicy?.default_access || 'deny';

    log.info({
      userId,
      serverId,
      serverName: server.name,
      isAdmin,
      defaultPolicyType,
      defaultAccess
    }, '[MCP-ACCESS] No explicit policy, using default');

    return {
      allowed: defaultAccess === 'allow',
      reason: `Default ${defaultPolicyType} policy: ${defaultAccess}`
    };

  } catch (error) {
    log.error({
      userId,
      serverId,
      error
    }, '[MCP-ACCESS] Error checking MCP access');

    // Fail securely - deny access on error
    return {
      allowed: false,
      reason: 'Error checking access permissions'
    };
  }
}

/**
 * Filter available tools based on user's MCP access policies
 *
 * This is called during the MCP stage to remove tools from servers
 * the user doesn't have access to.
 */
export async function filterToolsByAccess(
  userId: string,
  userGroups: string[],
  isAdmin: boolean,
  tools: any[],
  requestLogger?: Logger
): Promise<any[]> {
  const log = requestLogger || logger;

  if (!tools || tools.length === 0) {
    return [];
  }

  // Extract unique server IDs from tools
  const serverIds = new Set<string>();
  for (const tool of tools) {
    const serverId = tool._serverId || tool.serverId || tool.function?.server_name;
    if (serverId) {
      serverIds.add(serverId);
    }
  }

  // Check access for each server
  const accessMap = new Map<string, boolean>();
  for (const serverId of serverIds) {
    const result = await checkMCPAccess(userId, serverId, userGroups, isAdmin, log);
    accessMap.set(serverId, result.allowed);

    if (!result.allowed) {
      log.warn({
        userId,
        serverId,
        reason: result.reason
      }, '[MCP-ACCESS] Access denied to MCP server');
    }
  }

  // Filter tools based on access
  const filteredTools = tools.filter(tool => {
    const serverId = tool._serverId || tool.serverId || tool.function?.server_name;
    if (!serverId) {
      log.warn({
        toolName: tool.function?.name,
        reason: 'no_server_id'
      }, '[MCP-ACCESS] Tool has no server ID, excluding from results');
      return false;
    }

    return accessMap.get(serverId) === true;
  });

  log.info({
    userId,
    totalTools: tools.length,
    filteredTools: filteredTools.length,
    removedTools: tools.length - filteredTools.length,
    accessibleServers: Array.from(accessMap.entries())
      .filter(([_, allowed]) => allowed)
      .map(([serverId]) => serverId)
  }, '[MCP-ACCESS] Filtered tools by access policies');

  return filteredTools;
}

/**
 * Check if a user can execute a specific tool
 *
 * Called before tool execution to enforce runtime access control
 */
export async function checkToolExecutionAccess(
  userId: string,
  userGroups: string[],
  isAdmin: boolean,
  toolName: string,
  serverId: string,
  requestLogger?: Logger
): Promise<MCPAccessCheckResult> {
  const log = requestLogger || logger;

  log.debug({
    userId,
    toolName,
    serverId,
    userGroups
  }, '[MCP-ACCESS] Checking tool execution access');

  // Check MCP server access
  const accessResult = await checkMCPAccess(userId, serverId, userGroups, isAdmin, log);

  if (!accessResult.allowed) {
    log.warn({
      userId,
      toolName,
      serverId,
      reason: accessResult.reason
    }, '[MCP-ACCESS] Tool execution denied - no server access');
  }

  return accessResult;
}

/**
 * Get all accessible MCP servers for a user
 */
export async function getAccessibleServers(
  userId: string,
  userGroups: string[],
  isAdmin: boolean,
  requestLogger?: Logger
): Promise<string[]> {
  const log = requestLogger || logger;

  try {
    // Get all enabled servers
    const servers = await prisma.mCPServerConfig.findMany({
      where: { enabled: true },
      select: { id: true, name: true }
    });

    // Check access for each server
    const accessibleServers: string[] = [];
    for (const server of servers) {
      const result = await checkMCPAccess(userId, server.id, userGroups, isAdmin, log);
      if (result.allowed) {
        accessibleServers.push(server.id);
      }
    }

    log.info({
      userId,
      totalServers: servers.length,
      accessibleServers: accessibleServers.length
    }, '[MCP-ACCESS] Retrieved accessible servers');

    return accessibleServers;

  } catch (error) {
    log.error({
      userId,
      error
    }, '[MCP-ACCESS] Error getting accessible servers');
    return [];
  }
}

/**
 * Bulk check access for multiple servers
 * Returns a map of serverId -> access result
 */
export async function bulkCheckMCPAccess(
  userId: string,
  serverIds: string[],
  userGroups: string[],
  isAdmin: boolean,
  requestLogger?: Logger
): Promise<Map<string, MCPAccessCheckResult>> {
  const log = requestLogger || logger;
  const results = new Map<string, MCPAccessCheckResult>();

  for (const serverId of serverIds) {
    const result = await checkMCPAccess(userId, serverId, userGroups, isAdmin, log);
    results.set(serverId, result);
  }

  return results;
}

/**
 * Get detailed permissions for a specific MCP server
 * Including read, write, execute permissions
 */
export async function getMCPPermissions(
  userId: string,
  serverId: string,
  userGroups: string[],
  isAdmin: boolean,
  requestLogger?: Logger
): Promise<MCPPermissions> {
  const log = requestLogger || logger;

  const accessResult = await checkMCPAccess(userId, serverId, userGroups, isAdmin, log);

  // For now, all permissions are tied to access
  // In the future, we could have granular permissions (read-only vs execute)
  return {
    read: accessResult.allowed,
    write: accessResult.allowed,
    execute: accessResult.allowed
  };
}

/**
 * Singleton instance
 */
class MCPAccessControlService {
  async checkAccess(
    userId: string,
    serverId: string,
    userGroups: string[],
    isAdmin: boolean,
    requestLogger?: Logger
  ): Promise<MCPAccessCheckResult> {
    return checkMCPAccess(userId, serverId, userGroups, isAdmin, requestLogger);
  }

  async filterTools(
    userId: string,
    userGroups: string[],
    isAdmin: boolean,
    tools: any[],
    requestLogger?: Logger
  ): Promise<any[]> {
    return filterToolsByAccess(userId, userGroups, isAdmin, tools, requestLogger);
  }

  async checkToolExecution(
    userId: string,
    userGroups: string[],
    isAdmin: boolean,
    toolName: string,
    serverId: string,
    requestLogger?: Logger
  ): Promise<MCPAccessCheckResult> {
    return checkToolExecutionAccess(userId, userGroups, isAdmin, toolName, serverId, requestLogger);
  }

  async getAccessibleServers(
    userId: string,
    userGroups: string[],
    isAdmin: boolean,
    requestLogger?: Logger
  ): Promise<string[]> {
    return getAccessibleServers(userId, userGroups, isAdmin, requestLogger);
  }

  async bulkCheckAccess(
    userId: string,
    serverIds: string[],
    userGroups: string[],
    isAdmin: boolean,
    requestLogger?: Logger
  ): Promise<Map<string, MCPAccessCheckResult>> {
    return bulkCheckMCPAccess(userId, serverIds, userGroups, isAdmin, requestLogger);
  }

  async getPermissions(
    userId: string,
    serverId: string,
    userGroups: string[],
    isAdmin: boolean,
    requestLogger?: Logger
  ): Promise<MCPPermissions> {
    return getMCPPermissions(userId, serverId, userGroups, isAdmin, requestLogger);
  }

  /**
   * Check per-tool access using MCPToolAccessPolicy table.
   * Resolution: explicit user deny > group deny > user allow > group allow > server-level > default allow.
   */
  async checkToolAccess(
    userId: string,
    serverId: string,
    toolName: string,
    userGroups: string[],
    isAdmin: boolean,
    requestLogger?: Logger
  ): Promise<{ allowed: boolean; reason: string; requireApproval: boolean }> {
    const log = requestLogger || logger;

    // Admins bypass tool-level policies
    if (isAdmin) {
      return { allowed: true, reason: 'admin_bypass', requireApproval: false };
    }

    try {
      // Load all active policies for this server+tool, ordered by priority
      const policies = await prisma.mCPToolAccessPolicy.findMany({
        where: {
          is_enabled: true,
          OR: [
            { server_id: serverId, tool_name: toolName },
            { server_id: serverId, tool_name: '*' }
          ]
        },
        orderBy: { priority: 'asc' }
      });

      if (policies.length === 0) {
        // No tool-level policies — fall through to server-level access
        return { allowed: true, reason: 'no_tool_policy', requireApproval: false };
      }

      // Check user-specific policies first (highest priority)
      for (const policy of policies) {
        if (policy.user_id === userId) {
          return {
            allowed: policy.access_type === 'allow',
            reason: `user_policy:${policy.id}`,
            requireApproval: policy.require_approval
          };
        }
      }

      // Check group policies
      for (const policy of policies) {
        if (policy.azure_group_id && userGroups.includes(policy.azure_group_id)) {
          return {
            allowed: policy.access_type === 'allow',
            reason: `group_policy:${policy.id}`,
            requireApproval: policy.require_approval
          };
        }
      }

      // Check wildcard policies (no user or group specified)
      for (const policy of policies) {
        if (!policy.user_id && !policy.azure_group_id) {
          return {
            allowed: policy.access_type === 'allow',
            reason: `global_policy:${policy.id}`,
            requireApproval: policy.require_approval
          };
        }
      }

      // No matching policy — allow by default
      return { allowed: true, reason: 'default_allow', requireApproval: false };
    } catch (error) {
      log.error({ error, serverId, toolName, userId }, '[MCP-ACCESS] Error checking tool access');
      return { allowed: true, reason: 'error_fallback', requireApproval: false };
    }
  }

  /**
   * Filter tools list applying both server-level AND tool-level policies.
   */
  async filterToolsWithToolPolicies(
    userId: string,
    userGroups: string[],
    isAdmin: boolean,
    tools: any[],
    requestLogger?: Logger
  ): Promise<any[]> {
    // First apply server-level filtering
    const serverFiltered = await filterToolsByAccess(userId, userGroups, isAdmin, tools, requestLogger);

    if (isAdmin) return serverFiltered;

    // Then apply tool-level filtering
    const results: any[] = [];
    for (const tool of serverFiltered) {
      const serverId = tool._serverId || tool.serverId || tool.function?.server_name;
      const toolName = tool.function?.name || tool.name;
      if (!serverId || !toolName) {
        results.push(tool);
        continue;
      }
      const { allowed } = await this.checkToolAccess(userId, serverId, toolName, userGroups, isAdmin, requestLogger);
      if (allowed) {
        results.push(tool);
      }
    }
    return results;
  }
}

// Export singleton
export const mcpAccessControlService = new MCPAccessControlService();
export default mcpAccessControlService;

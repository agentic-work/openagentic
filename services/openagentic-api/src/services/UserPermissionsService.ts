/**
 * User Permissions Service
 *
 * Manages user-level and group-level permissions for:
 * - LLM provider access
 * - MCP server access
 * - Token/request limits
 * - Feature flags
 *
 * Permission resolution order:
 * 1. User-specific permissions (highest priority)
 * 2. Group permissions (merged, highest priority group wins)
 * 3. Default permissions (lowest priority)
 */

import { PrismaClient } from '@prisma/client';
import type { Logger } from 'pino';

export interface UserPermissions {
  userId: string;
  allowedLlmProviders: string[];
  deniedLlmProviders: string[];
  allowedMcpServers: string[];
  deniedMcpServers: string[];
  workflowsEnabled: boolean;
  workflows: string[];
  dailyTokenLimit: number | null;
  monthlyTokenLimit: number | null;
  dailyRequestLimit: number | null;
  monthlyRequestLimit: number | null;
  canUseImageGeneration: boolean;
  canUseCodeExecution: boolean;
  canUseWebSearch: boolean;
  canUseFileUpload: boolean;
  canUseMemory: boolean;
  canUseRag: boolean;
  canUseAwcode: boolean;
  adminNotes?: string;
  source: 'user' | 'group' | 'default';
}

export interface PermissionUpdate {
  allowedLlmProviders?: string[];
  deniedLlmProviders?: string[];
  allowedMcpServers?: string[];
  deniedMcpServers?: string[];
  workflowsEnabled?: boolean;
  workflows?: string[];
  dailyTokenLimit?: number | null;
  monthlyTokenLimit?: number | null;
  dailyRequestLimit?: number | null;
  monthlyRequestLimit?: number | null;
  canUseImageGeneration?: boolean;
  canUseCodeExecution?: boolean;
  canUseWebSearch?: boolean;
  canUseFileUpload?: boolean;
  canUseMemory?: boolean;
  canUseRag?: boolean;
  canUseAwcode?: boolean;
  adminNotes?: string;
}

export interface GroupPermissionUpdate extends PermissionUpdate {
  azureGroupId: string;
  azureGroupName: string;
  templateId?: string;
  priority?: number;
}

export interface PermissionTemplate {
  id: string;
  name: string;
  description?: string;
  allowedLlmProviders: string[];
  deniedLlmProviders: string[];
  allowedMcpServers: string[];
  deniedMcpServers: string[];
  workflowsEnabled: boolean;
  workflows: string[];
  dailyTokenLimit: number | null;
  monthlyTokenLimit: number | null;
  dailyRequestLimit: number | null;
  monthlyRequestLimit: number | null;
  canUseImageGeneration: boolean;
  canUseCodeExecution: boolean;
  canUseWebSearch: boolean;
  canUseFileUpload: boolean;
  canUseMemory: boolean;
  canUseRag: boolean;
  canUseAwcode: boolean;
  isDefault: boolean;
}

const DEFAULT_PERMISSIONS: Omit<UserPermissions, 'userId' | 'source'> = {
  allowedLlmProviders: [],
  deniedLlmProviders: [],
  allowedMcpServers: [],
  deniedMcpServers: [],
  workflowsEnabled: false,
  workflows: [],
  dailyTokenLimit: null,
  monthlyTokenLimit: null,
  dailyRequestLimit: null,
  monthlyRequestLimit: null,
  canUseImageGeneration: true,
  canUseCodeExecution: true,
  canUseWebSearch: true,
  canUseFileUpload: true,
  canUseMemory: true,
  canUseRag: true,
  canUseAwcode: false,  // AWCode disabled by default - must be enabled per-user or admin gets it automatically
};

export class UserPermissionsService {
  private prisma: PrismaClient;
  private logger: Logger;
  private permissionCache: Map<string, { permissions: UserPermissions; expiresAt: number }> = new Map();
  private cacheTtlMs = 60000; // 1 minute cache

  constructor(prisma: PrismaClient, logger: Logger) {
    this.prisma = prisma;
    this.logger = logger.child({ service: 'UserPermissionsService' });
  }

  /**
   * Get resolved permissions for a user
   * Merges user-specific, group, and default permissions
   */
  async getUserPermissions(userId: string, userGroups: string[] = []): Promise<UserPermissions> {
    // Check cache
    const cacheKey = `${userId}:${userGroups.sort().join(',')}`;
    const cached = this.permissionCache.get(cacheKey);
    if (cached && cached.expiresAt > Date.now()) {
      return cached.permissions;
    }

    try {
      // 1. Check for user-specific permissions
      const userPerms = await this.prisma.userPermissions.findUnique({
        where: { user_id: userId },
      });

      if (userPerms) {
        const permissions: UserPermissions = {
          userId,
          allowedLlmProviders: userPerms.allowed_llm_providers,
          deniedLlmProviders: userPerms.denied_llm_providers,
          allowedMcpServers: userPerms.allowed_mcp_servers,
          deniedMcpServers: userPerms.denied_mcp_servers,
          workflowsEnabled: userPerms.workflows_enabled,
          workflows: userPerms.workflows,
          dailyTokenLimit: userPerms.daily_token_limit,
          monthlyTokenLimit: userPerms.monthly_token_limit,
          dailyRequestLimit: userPerms.daily_request_limit,
          monthlyRequestLimit: userPerms.monthly_request_limit,
          canUseImageGeneration: userPerms.can_use_image_generation,
          canUseCodeExecution: userPerms.can_use_code_execution,
          canUseWebSearch: userPerms.can_use_web_search,
          canUseFileUpload: userPerms.can_use_file_upload,
          canUseMemory: userPerms.can_use_memory,
          canUseRag: userPerms.can_use_rag,
          canUseAwcode: (userPerms as any).can_use_awcode ?? false,
          adminNotes: userPerms.admin_notes || undefined,
          source: 'user',
        };

        this.permissionCache.set(cacheKey, {
          permissions,
          expiresAt: Date.now() + this.cacheTtlMs,
        });

        return permissions;
      }

      // 2. Check for group permissions (if user has groups)
      if (userGroups.length > 0) {
        const groupPerms = await this.prisma.groupPermissions.findMany({
          where: {
            azure_group_id: { in: userGroups },
          },
          orderBy: { priority: 'asc' }, // Lower priority number = higher precedence
        });

        if (groupPerms.length > 0) {
          // Merge group permissions (highest priority group wins)
          const highestPriorityGroup = groupPerms[0];
          const permissions: UserPermissions = {
            userId,
            allowedLlmProviders: highestPriorityGroup.allowed_llm_providers,
            deniedLlmProviders: highestPriorityGroup.denied_llm_providers,
            allowedMcpServers: highestPriorityGroup.allowed_mcp_servers,
            deniedMcpServers: highestPriorityGroup.denied_mcp_servers,
            workflowsEnabled: highestPriorityGroup.workflows_enabled,
            workflows: highestPriorityGroup.workflows,
            dailyTokenLimit: highestPriorityGroup.daily_token_limit,
            monthlyTokenLimit: highestPriorityGroup.monthly_token_limit,
            dailyRequestLimit: highestPriorityGroup.daily_request_limit,
            monthlyRequestLimit: highestPriorityGroup.monthly_request_limit,
            canUseImageGeneration: highestPriorityGroup.can_use_image_generation,
            canUseCodeExecution: highestPriorityGroup.can_use_code_execution,
            canUseWebSearch: highestPriorityGroup.can_use_web_search,
            canUseFileUpload: highestPriorityGroup.can_use_file_upload,
            canUseMemory: highestPriorityGroup.can_use_memory,
            canUseRag: highestPriorityGroup.can_use_rag,
            canUseAwcode: (highestPriorityGroup as any).can_use_awcode ?? false,
            adminNotes: highestPriorityGroup.admin_notes || undefined,
            source: 'group',
          };

          this.permissionCache.set(cacheKey, {
            permissions,
            expiresAt: Date.now() + this.cacheTtlMs,
          });

          return permissions;
        }
      }

      // 3. Return default permissions
      const defaultPerms: UserPermissions = {
        ...DEFAULT_PERMISSIONS,
        userId,
        source: 'default',
      };

      this.permissionCache.set(cacheKey, {
        permissions: defaultPerms,
        expiresAt: Date.now() + this.cacheTtlMs,
      });

      return defaultPerms;

    } catch (error) {
      this.logger.error({ error, userId }, 'Failed to get user permissions');
      return {
        ...DEFAULT_PERMISSIONS,
        userId,
        source: 'default',
      };
    }
  }

  /**
   * Set user-specific permissions
   */
  async setUserPermissions(
    userId: string,
    update: PermissionUpdate,
    adminUserId: string
  ): Promise<UserPermissions> {
    try {
      const result = await this.prisma.userPermissions.upsert({
        where: { user_id: userId },
        create: {
          user_id: userId,
          allowed_llm_providers: update.allowedLlmProviders || [],
          denied_llm_providers: update.deniedLlmProviders || [],
          allowed_mcp_servers: update.allowedMcpServers || [],
          denied_mcp_servers: update.deniedMcpServers || [],
          workflows_enabled: update.workflowsEnabled ?? false,
          workflows: update.workflows || [],
          daily_token_limit: update.dailyTokenLimit,
          monthly_token_limit: update.monthlyTokenLimit,
          daily_request_limit: update.dailyRequestLimit,
          monthly_request_limit: update.monthlyRequestLimit,
          can_use_image_generation: update.canUseImageGeneration ?? true,
          can_use_code_execution: update.canUseCodeExecution ?? true,
          can_use_web_search: update.canUseWebSearch ?? true,
          can_use_file_upload: update.canUseFileUpload ?? true,
          can_use_memory: update.canUseMemory ?? true,
          can_use_rag: update.canUseRag ?? true,
          can_use_awcode: update.canUseAwcode ?? false,
          admin_notes: update.adminNotes,
          created_by: adminUserId,
          updated_by: adminUserId,
        } as any,
        update: {
          allowed_llm_providers: update.allowedLlmProviders,
          denied_llm_providers: update.deniedLlmProviders,
          allowed_mcp_servers: update.allowedMcpServers,
          denied_mcp_servers: update.deniedMcpServers,
          workflows_enabled: update.workflowsEnabled,
          workflows: update.workflows,
          daily_token_limit: update.dailyTokenLimit,
          monthly_token_limit: update.monthlyTokenLimit,
          daily_request_limit: update.dailyRequestLimit,
          monthly_request_limit: update.monthlyRequestLimit,
          can_use_image_generation: update.canUseImageGeneration,
          can_use_code_execution: update.canUseCodeExecution,
          can_use_web_search: update.canUseWebSearch,
          can_use_file_upload: update.canUseFileUpload,
          can_use_memory: update.canUseMemory,
          can_use_rag: update.canUseRag,
          can_use_awcode: update.canUseAwcode,
          admin_notes: update.adminNotes,
          updated_by: adminUserId,
        } as any,
      });

      // Invalidate cache for this user
      this.invalidateUserCache(userId);

      this.logger.info({ userId, adminUserId }, 'User permissions updated');

      return {
        userId,
        allowedLlmProviders: result.allowed_llm_providers,
        deniedLlmProviders: result.denied_llm_providers,
        allowedMcpServers: result.allowed_mcp_servers,
        deniedMcpServers: result.denied_mcp_servers,
        workflowsEnabled: result.workflows_enabled,
        workflows: result.workflows,
        dailyTokenLimit: result.daily_token_limit,
        monthlyTokenLimit: result.monthly_token_limit,
        dailyRequestLimit: result.daily_request_limit,
        monthlyRequestLimit: result.monthly_request_limit,
        canUseImageGeneration: result.can_use_image_generation,
        canUseCodeExecution: result.can_use_code_execution,
        canUseWebSearch: result.can_use_web_search,
        canUseFileUpload: result.can_use_file_upload,
        canUseMemory: result.can_use_memory,
        canUseRag: result.can_use_rag,
        canUseAwcode: (result as any).can_use_awcode ?? false,
        adminNotes: result.admin_notes || undefined,
        source: 'user',
      };
    } catch (error) {
      this.logger.error({ error, userId }, 'Failed to set user permissions');
      throw error;
    }
  }

  /**
   * Delete user-specific permissions (reverts to group/default)
   */
  async deleteUserPermissions(userId: string): Promise<void> {
    try {
      await this.prisma.userPermissions.delete({
        where: { user_id: userId },
      });
      this.invalidateUserCache(userId);
      this.logger.info({ userId }, 'User permissions deleted');
    } catch (error) {
      // Ignore if not found
      if ((error as any)?.code !== 'P2025') {
        this.logger.error({ error, userId }, 'Failed to delete user permissions');
        throw error;
      }
    }
  }

  /**
   * Set group permissions
   */
  async setGroupPermissions(
    update: GroupPermissionUpdate,
    adminUserId: string
  ): Promise<void> {
    try {
      await this.prisma.groupPermissions.upsert({
        where: { azure_group_id: update.azureGroupId },
        create: {
          azure_group_id: update.azureGroupId,
          azure_group_name: update.azureGroupName,
          template_id: update.templateId,
          allowed_llm_providers: update.allowedLlmProviders || [],
          denied_llm_providers: update.deniedLlmProviders || [],
          allowed_mcp_servers: update.allowedMcpServers || [],
          denied_mcp_servers: update.deniedMcpServers || [],
          workflows_enabled: update.workflowsEnabled ?? false,
          workflows: update.workflows || [],
          daily_token_limit: update.dailyTokenLimit,
          monthly_token_limit: update.monthlyTokenLimit,
          daily_request_limit: update.dailyRequestLimit,
          monthly_request_limit: update.monthlyRequestLimit,
          can_use_image_generation: update.canUseImageGeneration ?? true,
          can_use_code_execution: update.canUseCodeExecution ?? true,
          can_use_web_search: update.canUseWebSearch ?? true,
          can_use_file_upload: update.canUseFileUpload ?? true,
          can_use_memory: update.canUseMemory ?? true,
          can_use_rag: update.canUseRag ?? true,
          can_use_awcode: update.canUseAwcode ?? false,
          priority: update.priority || 1000,
          admin_notes: update.adminNotes,
          created_by: adminUserId,
          updated_by: adminUserId,
        } as any,
        update: {
          azure_group_name: update.azureGroupName,
          template_id: update.templateId,
          allowed_llm_providers: update.allowedLlmProviders,
          denied_llm_providers: update.deniedLlmProviders,
          allowed_mcp_servers: update.allowedMcpServers,
          denied_mcp_servers: update.deniedMcpServers,
          workflows_enabled: update.workflowsEnabled,
          workflows: update.workflows,
          daily_token_limit: update.dailyTokenLimit,
          monthly_token_limit: update.monthlyTokenLimit,
          daily_request_limit: update.dailyRequestLimit,
          monthly_request_limit: update.monthlyRequestLimit,
          can_use_image_generation: update.canUseImageGeneration,
          can_use_code_execution: update.canUseCodeExecution,
          can_use_web_search: update.canUseWebSearch,
          can_use_file_upload: update.canUseFileUpload,
          can_use_memory: update.canUseMemory,
          can_use_rag: update.canUseRag,
          can_use_awcode: update.canUseAwcode,
          priority: update.priority,
          admin_notes: update.adminNotes,
          updated_by: adminUserId,
        } as any,
      });

      // Invalidate all cache (group change affects many users)
      this.permissionCache.clear();

      this.logger.info({ groupId: update.azureGroupId, adminUserId }, 'Group permissions updated');
    } catch (error) {
      this.logger.error({ error, groupId: update.azureGroupId }, 'Failed to set group permissions');
      throw error;
    }
  }

  /**
   * Get all group permissions
   */
  async getAllGroupPermissions(): Promise<GroupPermissionUpdate[]> {
    try {
      const groups = await this.prisma.groupPermissions.findMany({
        orderBy: { priority: 'asc' },
      });

      return groups.map((g) => ({
        azureGroupId: g.azure_group_id,
        azureGroupName: g.azure_group_name,
        templateId: g.template_id || undefined,
        allowedLlmProviders: g.allowed_llm_providers,
        deniedLlmProviders: g.denied_llm_providers,
        allowedMcpServers: g.allowed_mcp_servers,
        deniedMcpServers: g.denied_mcp_servers,
        workflowsEnabled: g.workflows_enabled,
        workflows: g.workflows,
        dailyTokenLimit: g.daily_token_limit,
        monthlyTokenLimit: g.monthly_token_limit,
        dailyRequestLimit: g.daily_request_limit,
        monthlyRequestLimit: g.monthly_request_limit,
        canUseImageGeneration: g.can_use_image_generation,
        canUseCodeExecution: g.can_use_code_execution,
        canUseWebSearch: g.can_use_web_search,
        canUseFileUpload: g.can_use_file_upload,
        canUseMemory: g.can_use_memory,
        canUseRag: g.can_use_rag,
        canUseAwcode: (g as any).can_use_awcode ?? false,
        priority: g.priority,
        adminNotes: g.admin_notes || undefined,
      }));
    } catch (error) {
      this.logger.error({ error }, 'Failed to get all group permissions');
      throw error;
    }
  }

  /**
   * Delete group permissions
   */
  async deleteGroupPermissions(azureGroupId: string): Promise<void> {
    try {
      await this.prisma.groupPermissions.delete({
        where: { azure_group_id: azureGroupId },
      });
      this.permissionCache.clear();
      this.logger.info({ groupId: azureGroupId }, 'Group permissions deleted');
    } catch (error) {
      if ((error as any)?.code !== 'P2025') {
        this.logger.error({ error, groupId: azureGroupId }, 'Failed to delete group permissions');
        throw error;
      }
    }
  }

  /**
   * Check if user can access a specific LLM provider
   */
  async canAccessLlmProvider(userId: string, providerId: string, userGroups: string[] = []): Promise<boolean> {
    const perms = await this.getUserPermissions(userId, userGroups);

    // If explicitly denied
    if (perms.deniedLlmProviders.includes(providerId)) {
      return false;
    }

    // If allowed list is empty, allow all (except denied)
    if (perms.allowedLlmProviders.length === 0) {
      return true;
    }

    // Check if in allowed list
    return perms.allowedLlmProviders.includes(providerId);
  }

  /**
   * Check if user can access a specific MCP server
   */
  async canAccessMcpServer(userId: string, serverId: string, userGroups: string[] = []): Promise<boolean> {
    const perms = await this.getUserPermissions(userId, userGroups);

    // If explicitly denied
    if (perms.deniedMcpServers.includes(serverId)) {
      return false;
    }

    // If allowed list is empty, allow all (except denied)
    if (perms.allowedMcpServers.length === 0) {
      return true;
    }

    // Check if in allowed list
    return perms.allowedMcpServers.includes(serverId);
  }

  /**
   * Check if user can access workflow automation
   */
  async canAccessWorkflows(userId: string, userGroups: string[] = []): Promise<boolean> {
    const perms = await this.getUserPermissions(userId, userGroups);
    return perms.workflowsEnabled;
  }

  /**
   * Check if user can access AWCode
   * Admins always have access, non-admins need explicit permission
   */
  async canAccessAwcode(userId: string, isAdmin: boolean, userGroups: string[] = []): Promise<boolean> {
    // Admins always have access
    if (isAdmin) {
      return true;
    }
    const perms = await this.getUserPermissions(userId, userGroups);
    return perms.canUseAwcode;
  }

  /**
   * Get all users with custom permissions
   */
  async getAllUserPermissions(): Promise<UserPermissions[]> {
    try {
      const users = await this.prisma.userPermissions.findMany({
        orderBy: { created_at: 'desc' },
      });

      return users.map((u) => ({
        userId: u.user_id,
        allowedLlmProviders: u.allowed_llm_providers,
        deniedLlmProviders: u.denied_llm_providers,
        allowedMcpServers: u.allowed_mcp_servers,
        deniedMcpServers: u.denied_mcp_servers,
        workflowsEnabled: u.workflows_enabled,
        workflows: u.workflows,
        dailyTokenLimit: u.daily_token_limit,
        monthlyTokenLimit: u.monthly_token_limit,
        dailyRequestLimit: u.daily_request_limit,
        monthlyRequestLimit: u.monthly_request_limit,
        canUseImageGeneration: u.can_use_image_generation,
        canUseCodeExecution: u.can_use_code_execution,
        canUseWebSearch: u.can_use_web_search,
        canUseFileUpload: u.can_use_file_upload,
        canUseMemory: u.can_use_memory,
        canUseRag: u.can_use_rag,
        canUseAwcode: (u as any).can_use_awcode ?? false,
        adminNotes: u.admin_notes || undefined,
        source: 'user' as const,
      }));
    } catch (error) {
      this.logger.error({ error }, 'Failed to get all user permissions');
      throw error;
    }
  }

  /**
   * Create or update permission template
   */
  async upsertPermissionTemplate(
    template: Omit<PermissionTemplate, 'id'> & { id?: string },
    adminUserId: string
  ): Promise<PermissionTemplate> {
    try {
      const result = await this.prisma.permissionTemplate.upsert({
        where: { name: template.name },
        create: {
          name: template.name,
          description: template.description,
          allowed_llm_providers: template.allowedLlmProviders,
          denied_llm_providers: template.deniedLlmProviders,
          allowed_mcp_servers: template.allowedMcpServers,
          denied_mcp_servers: template.deniedMcpServers,
          workflows_enabled: template.workflowsEnabled,
          workflows: template.workflows,
          daily_token_limit: template.dailyTokenLimit,
          monthly_token_limit: template.monthlyTokenLimit,
          daily_request_limit: template.dailyRequestLimit,
          monthly_request_limit: template.monthlyRequestLimit,
          can_use_image_generation: template.canUseImageGeneration,
          can_use_code_execution: template.canUseCodeExecution,
          can_use_web_search: template.canUseWebSearch,
          can_use_file_upload: template.canUseFileUpload,
          can_use_memory: template.canUseMemory,
          can_use_rag: template.canUseRag,
          can_use_awcode: template.canUseAwcode,
          is_default: template.isDefault,
          created_by: adminUserId,
          updated_by: adminUserId,
        } as any,
        update: {
          description: template.description,
          allowed_llm_providers: template.allowedLlmProviders,
          denied_llm_providers: template.deniedLlmProviders,
          allowed_mcp_servers: template.allowedMcpServers,
          denied_mcp_servers: template.deniedMcpServers,
          workflows_enabled: template.workflowsEnabled,
          workflows: template.workflows,
          daily_token_limit: template.dailyTokenLimit,
          monthly_token_limit: template.monthlyTokenLimit,
          daily_request_limit: template.dailyRequestLimit,
          monthly_request_limit: template.monthlyRequestLimit,
          can_use_image_generation: template.canUseImageGeneration,
          can_use_code_execution: template.canUseCodeExecution,
          can_use_web_search: template.canUseWebSearch,
          can_use_file_upload: template.canUseFileUpload,
          can_use_memory: template.canUseMemory,
          can_use_rag: template.canUseRag,
          can_use_awcode: template.canUseAwcode,
          is_default: template.isDefault,
          updated_by: adminUserId,
        } as any,
      });

      return {
        id: result.id,
        name: result.name,
        description: result.description || undefined,
        allowedLlmProviders: result.allowed_llm_providers,
        deniedLlmProviders: result.denied_llm_providers,
        allowedMcpServers: result.allowed_mcp_servers,
        deniedMcpServers: result.denied_mcp_servers,
        workflowsEnabled: result.workflows_enabled,
        workflows: result.workflows,
        dailyTokenLimit: result.daily_token_limit,
        monthlyTokenLimit: result.monthly_token_limit,
        dailyRequestLimit: result.daily_request_limit,
        monthlyRequestLimit: result.monthly_request_limit,
        canUseImageGeneration: result.can_use_image_generation,
        canUseCodeExecution: result.can_use_code_execution,
        canUseWebSearch: result.can_use_web_search,
        canUseFileUpload: result.can_use_file_upload,
        canUseMemory: result.can_use_memory,
        canUseRag: result.can_use_rag,
        canUseAwcode: (result as any).can_use_awcode ?? false,
        isDefault: result.is_default,
      };
    } catch (error) {
      this.logger.error({ error, templateName: template.name }, 'Failed to upsert permission template');
      throw error;
    }
  }

  /**
   * Get all permission templates
   */
  async getAllTemplates(): Promise<PermissionTemplate[]> {
    try {
      const templates = await this.prisma.permissionTemplate.findMany({
        orderBy: { name: 'asc' },
      });

      return templates.map((t) => ({
        id: t.id,
        name: t.name,
        description: t.description || undefined,
        allowedLlmProviders: t.allowed_llm_providers,
        deniedLlmProviders: t.denied_llm_providers,
        allowedMcpServers: t.allowed_mcp_servers,
        deniedMcpServers: t.denied_mcp_servers,
        workflowsEnabled: t.workflows_enabled,
        workflows: t.workflows,
        dailyTokenLimit: t.daily_token_limit,
        monthlyTokenLimit: t.monthly_token_limit,
        dailyRequestLimit: t.daily_request_limit,
        monthlyRequestLimit: t.monthly_request_limit,
        canUseImageGeneration: t.can_use_image_generation,
        canUseCodeExecution: t.can_use_code_execution,
        canUseWebSearch: t.can_use_web_search,
        canUseFileUpload: t.can_use_file_upload,
        canUseMemory: t.can_use_memory,
        canUseRag: t.can_use_rag,
        canUseAwcode: (t as any).can_use_awcode ?? false,
        isDefault: t.is_default,
      }));
    } catch (error) {
      this.logger.error({ error }, 'Failed to get all templates');
      throw error;
    }
  }

  /**
   * Invalidate cache for a specific user
   */
  private invalidateUserCache(userId: string): void {
    // Remove all cache entries that start with the userId
    for (const key of this.permissionCache.keys()) {
      if (key.startsWith(`${userId}:`)) {
        this.permissionCache.delete(key);
      }
    }
  }

  /**
   * Clear all cache
   */
  clearCache(): void {
    this.permissionCache.clear();
  }
}

export default UserPermissionsService;

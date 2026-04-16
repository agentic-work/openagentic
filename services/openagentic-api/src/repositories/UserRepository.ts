/**
 * User Repository
 * 
 * Handles database operations for users with specialized authentication queries
 * Supports both local and Azure AD users
 */

import { User } from '@prisma/client';
import { BaseRepository, QueryOptions } from './BaseRepository.js';
import { PrismaClient } from '@prisma/client';
import type { Logger } from 'pino';

export interface UserWithSessions extends User {
  chatSessions?: Array<{
    id: string;
    title: string;
    created_at: Date;
    messageCount: number;
  }>;
  sessionCount?: number;
  lastActivity?: Date;
}

export interface CreateUserData {
  email: string;
  name: string;
  username?: string;
  passwordHash?: string;
  groups?: string[];
  azureOid?: string;
  azureTenantId?: string;
  isAdmin?: boolean;
  isActive?: boolean;
  metadata?: any;
}

export interface UpdateUserData {
  name?: string;
  username?: string;
  passwordHash?: string;
  groups?: string[];
  azureOid?: string;
  azureTenantId?: string;
  isAdmin?: boolean;
  isActive?: boolean;
  lastLogin?: Date;
  metadata?: any;
  forcePasswordChange?: boolean;
}

export interface UserFilters {
  email?: string;
  username?: string;
  isAdmin?: boolean;
  isActive?: boolean;
  hasAzureOid?: boolean;
  groups?: string[];
  createdAfter?: Date;
  lastLoginAfter?: Date;
  limit?: number;
  offset?: number;
  includeInactive?: boolean;
}

/**
 * Repository for User model with authentication-specific queries
 */
export class UserRepository extends BaseRepository<User> {
  constructor(prisma: PrismaClient, logger?: Logger) {
    super(prisma, 'user', {
      defaultTTL: 3600, // 1 hour for user data
      keyPrefix: 'user',
      enableCaching: true
    }, logger);
  }

  /**
   * Find user by email with caching (for login)
   */
  async findByEmail(
    email: string,
    options: QueryOptions = {}
  ): Promise<User | null> {
    const cacheKey = this.getCacheKey(`email:${email.toLowerCase()}`);
    
    try {
      // Check cache first
      if (this.cacheConfig.enableCaching && !options.transaction) {
        const cached = await this.getFromCache(cacheKey);
        if (cached) {
          this.logger.debug('Cache hit for user by email', { email });
          return cached as User;
        }
      }

      const db = options.transaction || this.prisma;
      const user = await (db as any).user.findUnique({
        where: { 
          email: email.toLowerCase() // Ensure case-insensitive lookup
        }
      });

      // Cache result if found
      if (user && this.cacheConfig.enableCaching && !options.transaction) {
        const ttl = options.cache?.ttl || this.cacheConfig.defaultTTL;
        await this.setCache(cacheKey, user, ttl);
        this.logger.debug('Cached user by email', { email, userId: user.id });
      }

      return user;

    } catch (error) {
      this.logger.error('Failed to find user by email', { email, error });
      throw error;
    }
  }


  /**
   * Find user by Azure OID (for Azure AD auth)
   */
  async findByAzureOid(
    azureOid: string,
    azureTenantId?: string,
    options: QueryOptions = {}
  ): Promise<User | null> {
    const cacheKey = this.getCacheKey(`azure:${azureOid}:${azureTenantId || 'any'}`);
    
    try {
      // Check cache first
      if (this.cacheConfig.enableCaching && !options.transaction) {
        const cached = await this.getFromCache(cacheKey);
        if (cached) {
          this.logger.debug('Cache hit for user by Azure OID', { azureOid });
          return cached as User;
        }
      }

      const whereClause: any = { azure_oid: azureOid };
      if (azureTenantId) {
        whereClause.azure_tenant_id = azureTenantId;
      }

      const db = options.transaction || this.prisma;
      const user = await (db as any).user.findFirst({
        where: whereClause
      });

      // Cache result if found
      if (user && this.cacheConfig.enableCaching && !options.transaction) {
        const ttl = options.cache?.ttl || this.cacheConfig.defaultTTL;
        await this.setCache(cacheKey, user, ttl);
        this.logger.debug('Cached user by Azure OID', { azureOid, userId: user.id });
      }

      return user;

    } catch (error) {
      this.logger.error('Failed to find user by Azure OID', { azureOid, error });
      throw error;
    }
  }


  /**
   * Find admin users
   */
  async findAdmins(options: QueryOptions = {}): Promise<User[]> {
    const cacheKey = this.getCacheKey('admins');
    
    try {
      // Check cache first
      if (this.cacheConfig.enableCaching && !options.transaction) {
        const cached = await this.getFromCache(cacheKey);
        if (cached) {
          this.logger.debug('Cache hit for admin users');
          return cached as User[];
        }
      }

      const db = options.transaction || this.prisma;
      const admins = await (db as any).user.findMany({
        where: {
          is_admin: true,
          is_active: true
        },
        orderBy: { name: 'asc' }
      });

      // Cache results
      if (this.cacheConfig.enableCaching && !options.transaction) {
        const ttl = options.cache?.ttl || this.cacheConfig.defaultTTL;
        await this.setCache(cacheKey, admins, ttl);
        this.logger.debug('Cached admin users', { count: admins.length });
      }

      return admins;

    } catch (error) {
      this.logger.error('Failed to find admin users', { error });
      throw error;
    }
  }

  /**
   * Find users with activity data
   */
  async findWithActivity(
    filters: UserFilters = {},
    options: QueryOptions = {}
  ): Promise<UserWithSessions[]> {
    try {
      // Build where clause
      const whereClause: any = {};
      if (filters.email) whereClause.email = { contains: filters.email, mode: 'insensitive' };
      if (filters.isAdmin !== undefined) whereClause.is_admin = filters.isAdmin;
      if (!filters.includeInactive) whereClause.is_active = true;
      if (filters.hasAzureOid !== undefined) {
        whereClause.azure_oid = filters.hasAzureOid ? { not: null } : null;
      }
      if (filters.groups && filters.groups.length > 0) {
        whereClause.groups = { hasSome: filters.groups };
      }
      if (filters.createdAfter) {
        whereClause.created_at = { gte: filters.createdAfter };
      }
      if (filters.lastLoginAfter) {
        whereClause.last_login_at = { gte: filters.lastLoginAfter };
      }

      const db = options.transaction || this.prisma;
      const users = await (db as any).user.findMany({
        where: whereClause,
        include: {
          chatSessions: {
            select: {
              id: true,
              title: true,
              created_at: true,
              messageCount: true
            },
            orderBy: { updated_at: 'desc' },
            take: 5 // Recent sessions only
          }
        },
        orderBy: { last_login_at: 'desc' },
        take: filters.limit || 50,
        skip: filters.offset || 0
      });

      // Add computed fields
      return users.map((user: any) => ({
        ...user,
        sessionCount: user.chatSessions?.length || 0,
        lastActivity: user.chatSessions?.[0]?.created_at || user.last_login_at
      }));

    } catch (error) {
      this.logger.error('Failed to find users with activity', { filters, error });
      throw error;
    }
  }

  /**
   * Update last login time
   */
  async updateLastLogin(
    userId: string,
    options: QueryOptions = {}
  ): Promise<User> {
    try {
      const updateData: UpdateUserData = {
        lastLogin: new Date()
      };

      const result = await this.update(userId, updateData, options);
      
      this.logger.info('Updated user last login', { userId });
      return result;

    } catch (error) {
      this.logger.error('Failed to update last login', { userId, error });
      throw error;
    }
  }

  /**
   * Change user password (with hash)
   */
  async changePassword(
    userId: string,
    newPasswordHash: string,
    clearForcePasswordChange: boolean = true,
    options: QueryOptions = {}
  ): Promise<User> {
    try {
      const updateData: UpdateUserData = {
        passwordHash: newPasswordHash
      };

      if (clearForcePasswordChange) {
        updateData.forcePasswordChange = false;
      }

      const result = await this.update(userId, updateData, options);
      
      this.logger.info('Changed user password', { userId });
      return result;

    } catch (error) {
      this.logger.error('Failed to change password', { userId, error });
      throw error;
    }
  }

  /**
   * Deactivate user (soft delete)
   */
  async deactivateUser(userId: string, options: QueryOptions = {}): Promise<User> {
    try {
      const updateData: UpdateUserData = {
        isActive: false
      };

      const result = await this.update(userId, updateData, options);
      
      this.logger.info('Deactivated user', { userId });
      return result;

    } catch (error) {
      this.logger.error('Failed to deactivate user', { userId, error });
      throw error;
    }
  }

  /**
   * Override cache invalidation to clear identifier-based caches
   */
  protected async invalidateCache(userId?: string): Promise<void> {
    if (!this.cache) return;

    try {
      // Get user data to invalidate specific caches
      if (userId) {
        const user = await this.prisma.user.findUnique({
          where: { id: userId },
          select: {
            email: true,
            azure_oid: true,
            azure_tenant_id: true,
            is_admin: true
          }
        });

        if (user) {
          // Invalidate email cache
          if (user.email) {
            const emailKey = this.getCacheKey(`email:${user.email.toLowerCase()}`);
            await this.cache.del(emailKey);
          }

          // Invalidate Azure OID cache
          if (user.azure_oid) {
            const azureKey = this.getCacheKey(`azure:${user.azure_oid}:${user.azure_tenant_id || 'any'}`);
            await this.cache.del(azureKey);
          }

          // Invalidate admin cache if user is admin
          if (user.is_admin) {
            const adminKey = this.getCacheKey('admins');
            await this.cache.del(adminKey);
          }
        }
      }

      // Call parent invalidation
      await super.invalidateCache(userId);

      // Also invalidate admin cache (might have changed)
      const adminKey = this.getCacheKey('admins');
      await this.cache.del(adminKey);

    } catch (error) {
      this.logger.warn('Cache invalidation error in UserRepository', { 
        userId, 
        error 
      });
    }
  }
}
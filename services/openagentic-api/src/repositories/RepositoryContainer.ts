/**
 * Repository Container - Dependency Injection for Repositories
 * 
 * FIXES ABSTRACTION LAYER ISSUES:
 * - Centralized repository management
 * - Dependency injection pattern
 * - Transaction coordination across repositories
 * - Consistent configuration and logging
 */

import { PrismaClient } from '@prisma/client';
import { Redis } from 'ioredis';
import type { Logger } from 'pino';

// Repository imports
import { BaseRepository, RepositoryFactory, CacheConfig } from './BaseRepository.js';
import { ChatSessionRepository } from './ChatSessionRepository.js';
import { MCPToolRepository } from './MCPToolRepository.js';
import { UserRepository } from './UserRepository.js';

export interface RepositoryContainerConfig {
  prisma: PrismaClient;
  logger?: Logger;
  cache?: CacheConfig;
  redis?: Redis; // Redis instance type
}

/**
 * Container for managing all repositories with dependency injection
 */
export class RepositoryContainer {
  private repositories: Map<string, BaseRepository<any>> = new Map();
  private factory: RepositoryFactory;
  
  public readonly chatSessions: ChatSessionRepository;
  public readonly mcpTools: MCPToolRepository;
  public readonly users: UserRepository;

  constructor(private config: RepositoryContainerConfig) {
    // Initialize factory
    this.factory = new RepositoryFactory(
      config.prisma,
      config.cache || {},
      config.logger
    );

    // Initialize specific repositories
    this.chatSessions = new ChatSessionRepository(config.prisma, config.logger);
    this.mcpTools = new MCPToolRepository(config.prisma, config.logger);
    this.users = new UserRepository(config.prisma, config.logger);

    // Register repositories
    this.repositories.set('chatSessions', this.chatSessions);
    this.repositories.set('mcpTools', this.mcpTools);
    this.repositories.set('users', this.users);

    if (config.logger) {
      config.logger.info({
        repositories: Array.from(this.repositories.keys())
      }, 'Repository container initialized');
    }
  }

  /**
   * Get repository by name (generic)
   */
  get<T>(name: string): BaseRepository<T> | undefined {
    return this.repositories.get(name);
  }

  /**
   * Create generic repository for any model
   */
  createRepository<T>(modelName: string, repositoryClass?: new (...args: any[]) => BaseRepository<T>): BaseRepository<T> {
    const key = `generic_${modelName}`;
    
    if (this.repositories.has(key)) {
      return this.repositories.get(key)!;
    }

    const repository = this.factory.create<T>(modelName, repositoryClass);
    this.repositories.set(key, repository);

    if (this.config.logger) {
      this.config.logger.info({ modelName, key }, 'Created generic repository');
    }
    return repository;
  }

  /**
   * Execute operations in a transaction across multiple repositories
   */
  async transaction<R>(
    callback: (repositories: {
      chatSessions: ChatSessionRepository;
      mcpTools: MCPToolRepository;
      users: UserRepository;
      container: RepositoryContainer;
    }) => Promise<R>
  ): Promise<R> {
    return this.config.prisma.$transaction(async (tx) => {
      // Create transaction-aware repository instances
      const txChatSessions = new ChatSessionRepository(tx as PrismaClient, this.config.logger);
      const txMcpTools = new MCPToolRepository(tx as PrismaClient, this.config.logger);
      const txUsers = new UserRepository(tx as PrismaClient, this.config.logger);
      
      // Create transaction-aware container
      const txContainer = new RepositoryContainer({
        ...this.config,
        prisma: tx as PrismaClient
      });

      return callback({
        chatSessions: txChatSessions,
        mcpTools: txMcpTools,
        users: txUsers,
        container: txContainer
      });
    });
  }

  /**
   * Health check for all repositories
   */
  async healthCheck(): Promise<{
    healthy: boolean;
    repositories: Array<{
      name: string;
      healthy: boolean;
      error?: string;
    }>;
  }> {
    const results = [];
    let allHealthy = true;

    for (const [name, repository] of this.repositories) {
      try {
        // Simple query to test repository health
        await repository.count({});
        results.push({ name, healthy: true });
      } catch (error) {
        allHealthy = false;
        results.push({
          name,
          healthy: false,
          error: error instanceof Error ? error.message : 'Unknown error'
        });
      }
    }

    return {
      healthy: allHealthy,
      repositories: results
    };
  }

  /**
   * Cleanup method for graceful shutdown
   */
  async cleanup(): Promise<void> {
    this.config.logger?.info('Cleaning up repository container');

    // Close Redis connections for each repository
    for (const [name, repository] of this.repositories) {
      try {
        // Access private cache property if available
        const cache = (repository as any).cache;
        if (cache && typeof cache.disconnect === 'function') {
          await cache.disconnect();
          if (this.config.logger) {
            this.config.logger.debug({ repository: name }, 'Closed cache connection');
          }
        }
      } catch (error) {
        if (this.config.logger) {
          this.config.logger.warn({ repository: name, error }, 'Error closing cache connection');
        }
      }
    }

    // Clear repository map
    this.repositories.clear();
  }

  /**
   * Get repository statistics
   */
  getStats(): {
    totalRepositories: number;
    repositories: string[];
    cacheEnabled: boolean;
  } {
    return {
      totalRepositories: this.repositories.size,
      repositories: Array.from(this.repositories.keys()),
      cacheEnabled: this.config.cache?.enableCaching !== false
    };
  }
}

/**
 * Repository container singleton factory
 */
let containerInstance: RepositoryContainer | null = null;

export function createRepositoryContainer(config: RepositoryContainerConfig): RepositoryContainer {
  if (containerInstance) {
    config.logger?.warn('Repository container already exists, returning existing instance');
    return containerInstance;
  }

  containerInstance = new RepositoryContainer(config);
  return containerInstance;
}

export function getRepositoryContainer(): RepositoryContainer {
  if (!containerInstance) {
    throw new Error('Repository container not initialized. Call createRepositoryContainer first.');
  }
  return containerInstance;
}

export async function shutdownRepositoryContainer(): Promise<void> {
  if (containerInstance) {
    await containerInstance.cleanup();
    containerInstance = null;
  }
}
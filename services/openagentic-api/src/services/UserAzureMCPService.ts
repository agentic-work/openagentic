import { Logger } from 'pino';
import { exec, ChildProcess } from 'child_process';
import { promisify } from 'util';
import axios from 'axios';

const execAsync = promisify(exec);

/**
 * User Azure MCP Service
 *
 * Manages per-user Azure MCP instances with OBO authentication
 * Each user gets their own isolated Azure MCP process with their token
 */
export class UserAzureMCPService {
  private logger: Logger;
  private redisClient: any;
  private milvusClient: any;
  private userSessions: Map<string, AzureMCPSession> = new Map();

  constructor(logger: Logger, redisClient?: any, milvusClient?: any) {
    this.logger = logger;
    this.redisClient = redisClient;
    this.milvusClient = milvusClient;
  }

  /**
   * Initialize Azure MCP instance for a user on login
   */
  async initializeUserAzureMCP(userId: string, userToken: string, email: string): Promise<void> {
    try {
      this.logger.info({
        userId,
        email
      }, '[USER_AZURE_MCP] Initializing per-user Azure MCP instance');

      // Check if user already has an active session
      if (this.userSessions.has(userId)) {
        this.logger.info({
          userId
        }, '[USER_AZURE_MCP] User already has active Azure MCP session');
        return;
      }

      // Spawn Azure MCP process with user's OBO token
      const azureMCPProcess = await this.spawnAzureMCPProcess(userId, userToken);

      // Get tools list from user's Azure MCP instance
      const tools = await this.getAzureMCPTools(azureMCPProcess);

      this.logger.info({
        userId,
        toolCount: tools.length,
        sampleTools: tools.slice(0, 5).map(t => t.name)
      }, '[USER_AZURE_MCP] Retrieved tools from user Azure MCP instance');

      // Index tools in Milvus/Redis with user_id prefix
      await this.indexUserAzureMCPTools(userId, tools);

      // Store session
      this.userSessions.set(userId, {
        userId,
        email,
        process: azureMCPProcess,
        tools,
        createdAt: new Date(),
        lastAccessedAt: new Date()
      });

      this.logger.info({
        userId,
        toolCount: tools.length
      }, '[USER_AZURE_MCP] ✅ User Azure MCP instance initialized and indexed');

    } catch (error: any) {
      this.logger.error({
        userId,
        error: error.message,
        stack: error.stack
      }, '[USER_AZURE_MCP] ❌ Failed to initialize user Azure MCP instance');

      throw error;
    }
  }

  /**
   * Spawn Azure MCP process with user's OBO token
   */
  private async spawnAzureMCPProcess(userId: string, userToken: string): Promise<ChildProcess> {
    this.logger.info({
      userId
    }, '[USER_AZURE_MCP] Spawning Azure MCP process for user');

    // Azure MCP requires these environment variables
    const env = {
      ...process.env,
      AZURE_ACCESS_TOKEN: userToken,
      // Use OBO flow - Azure MCP will use the provided access token
      AZURE_USE_OBO: 'true'
    };

    // Spawn azmcp process
    // NOTE: Azure MCP binary must be available in PATH or specify full path
    const azureMCPPath = process.env.AZURE_MCP_BINARY_PATH || 'azmcp';

    const child = exec(azureMCPPath, {
      env,
      maxBuffer: 10 * 1024 * 1024 // 10MB buffer for large responses
    });

    this.logger.info({
      userId,
      pid: child.pid
    }, '[USER_AZURE_MCP] ✅ Azure MCP process spawned');

    return child;
  }

  /**
   * Get tools list from Azure MCP process via stdio
   */
  private async getAzureMCPTools(process: ChildProcess): Promise<any[]> {
    return new Promise((resolve, reject) => {
      const timeout = setTimeout(() => {
        reject(new Error('Timeout waiting for Azure MCP tools/list response'));
      }, 30000);

      // Send tools/list request via stdin
      const request = {
        jsonrpc: '2.0',
        id: 1,
        method: 'tools/list'
      };

      let responseData = '';

      process.stdout?.on('data', (data) => {
        responseData += data.toString();

        // Try to parse JSON response
        try {
          const response = JSON.parse(responseData);
          if (response.id === 1 && response.result) {
            clearTimeout(timeout);
            resolve(response.result.tools || []);
          }
        } catch (e) {
          // Not complete JSON yet, keep accumulating
        }
      });

      process.stderr?.on('data', (data) => {
        this.logger.warn({
          stderr: data.toString()
        }, '[USER_AZURE_MCP] Azure MCP stderr');
      });

      process.on('error', (error) => {
        clearTimeout(timeout);
        reject(error);
      });

      // Send the request
      process.stdin?.write(JSON.stringify(request) + '\n');
    });
  }

  /**
   * Index user's Azure MCP tools in Milvus/Redis with user_id prefix
   */
  private async indexUserAzureMCPTools(userId: string, tools: any[]): Promise<void> {
    this.logger.info({
      userId,
      toolCount: tools.length
    }, '[USER_AZURE_MCP] Indexing user Azure MCP tools in Milvus/Redis');

    // Cache in Redis with user prefix
    if (this.redisClient) {
      const cacheKey = `user_azure_mcp_tools:${userId}`;
      await this.redisClient.set(
        cacheKey,
        JSON.stringify(tools),
        'EX',
        86400 // 24 hour TTL
      );

      this.logger.info({
        userId,
        cacheKey
      }, '[USER_AZURE_MCP] ✅ Cached user Azure MCP tools in Redis');
    }

    // Index in Milvus with user_id field
    // This allows semantic search to find user-specific Azure MCP tools
    if (this.milvusClient && tools.length > 0) {
      try {
        const collectionName = 'mcp_tools';

        // Prepare tools for insertion with user_id field
        const toolsToInsert = tools.map(tool => ({
          id: `user_${userId}_azure_${tool.name}`,
          server_id: 'azure_mcp',
          server_name: 'Azure MCP',
          tool_name: tool.name,
          description: tool.description || '',
          parameters: JSON.stringify(tool.inputSchema || {}),
          user_id: userId, // Critical: Add user_id to enable per-user filtering
          metadata: JSON.stringify({
            perUser: true,
            userId: userId,
            createdAt: new Date().toISOString()
          })
        }));

        // Insert tools into Milvus (embeddings will be generated by the collection)
        // Note: The MCPToolIndexingService should handle embedding generation
        this.logger.info({
          userId,
          toolCount: toolsToInsert.length,
          collection: collectionName
        }, '[USER_AZURE_MCP] Inserting user Azure MCP tools into Milvus');

        // TODO: Use MCPToolIndexingService's method to insert with embeddings
        // For now, just log that Milvus indexing would happen here
        this.logger.info({
          userId,
          toolCount: toolsToInsert.length
        }, '[USER_AZURE_MCP] ⚠️ Milvus indexing requires integration with MCPToolIndexingService');

      } catch (error: any) {
        this.logger.error({
          error: error.message,
          userId
        }, '[USER_AZURE_MCP] Failed to index user Azure MCP tools in Milvus');
        // Don't fail the whole operation - Redis cache is sufficient
      }
    }

    this.logger.info({
      userId,
      toolCount: tools.length
    }, '[USER_AZURE_MCP] ✅ User Azure MCP tools indexed');
  }

  /**
   * Get user's Azure MCP session
   */
  getUserSession(userId: string): AzureMCPSession | undefined {
    const session = this.userSessions.get(userId);
    if (session) {
      session.lastAccessedAt = new Date();
    }
    return session;
  }

  /**
   * Terminate user's Azure MCP instance on logout
   */
  async terminateUserAzureMCP(userId: string): Promise<void> {
    this.logger.info({
      userId
    }, '[USER_AZURE_MCP] Terminating user Azure MCP instance');

    const session = this.userSessions.get(userId);
    if (!session) {
      this.logger.warn({
        userId
      }, '[USER_AZURE_MCP] No active session found for user');
      return;
    }

    // Kill the process
    if (session.process && session.process.pid) {
      try {
        process.kill(session.process.pid);
        this.logger.info({
          userId,
          pid: session.process.pid
        }, '[USER_AZURE_MCP] ✅ Azure MCP process terminated');
      } catch (error: any) {
        this.logger.error({
          userId,
          error: error.message
        }, '[USER_AZURE_MCP] Failed to kill Azure MCP process');
      }
    }

    // Clean up Redis cache
    if (this.redisClient) {
      const cacheKey = `user_azure_mcp_tools:${userId}`;
      await this.redisClient.del(cacheKey);
    }

    // Remove from sessions map
    this.userSessions.delete(userId);

    this.logger.info({
      userId
    }, '[USER_AZURE_MCP] ✅ User Azure MCP session terminated');
  }

  /**
   * Clean up stale sessions (sessions inactive for > 1 hour)
   */
  async cleanupStaleSessions(): Promise<void> {
    const now = new Date();
    const staleThreshold = 60 * 60 * 1000; // 1 hour

    for (const [userId, session] of this.userSessions.entries()) {
      const timeSinceLastAccess = now.getTime() - session.lastAccessedAt.getTime();

      if (timeSinceLastAccess > staleThreshold) {
        this.logger.info({
          userId,
          timeSinceLastAccess: Math.round(timeSinceLastAccess / 1000 / 60) + ' minutes'
        }, '[USER_AZURE_MCP] Cleaning up stale Azure MCP session');

        await this.terminateUserAzureMCP(userId);
      }
    }
  }

  /**
   * Start periodic cleanup of stale sessions
   */
  startPeriodicCleanup(): void {
    // Run cleanup every 15 minutes
    setInterval(() => {
      this.cleanupStaleSessions().catch(error => {
        this.logger.error({
          error: error.message
        }, '[USER_AZURE_MCP] Periodic cleanup failed');
      });
    }, 15 * 60 * 1000);

    this.logger.info('[USER_AZURE_MCP] Started periodic session cleanup (every 15 minutes)');
  }
}

interface AzureMCPSession {
  userId: string;
  email: string;
  process: ChildProcess;
  tools: any[];
  createdAt: Date;
  lastAccessedAt: Date;
}

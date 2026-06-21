/**
 * MCP Health Check Service
 *
 * Provides health monitoring for the MCP Orchestrator service.
 */

import type { Logger } from 'pino';

interface MCPHealthStatus {
  healthy: boolean;
  orchestratorUrl: string;
  servers: number;
  tools: number;
  responseTime: string;
  error?: string;
}

export class MCPHealthCheckService {
  private logger: Logger;
  private orchestratorUrl: string | undefined;

  constructor(logger: Logger) {
    this.logger = logger;
    // Only set when explicitly configured. The default OSS install has no
    // MCP orchestrator service, so leaving this undefined makes every method
    // short-circuit instead of firing a doomed fetch at a nonexistent host.
    this.orchestratorUrl = process.env.MCP_ORCHESTRATOR_URL || process.env.ORCHESTRATOR_URL || undefined;
  }

  /**
   * Checks the health of the MCP Orchestrator
   */
  async checkMCPHealth(): Promise<MCPHealthStatus> {
    const startTime = Date.now();

    // No orchestrator configured (default OSS): report healthy with nothing to do.
    if (!this.orchestratorUrl) {
      return {
        healthy: true,
        orchestratorUrl: '',
        servers: 0,
        tools: 0,
        responseTime: '0ms'
      };
    }

    try {
      // Try to connect to MCP orchestrator health endpoint
      const response = await fetch(`${this.orchestratorUrl}/health`, {
        method: 'GET',
        headers: {
          'Content-Type': 'application/json'
        },
        signal: AbortSignal.timeout(5000) // 5 second timeout
      });

      const responseTime = `${Date.now() - startTime}ms`;

      if (!response.ok) {
        return {
          healthy: false,
          orchestratorUrl: this.orchestratorUrl,
          servers: 0,
          tools: 0,
          responseTime,
          error: `MCP Orchestrator returned status ${response.status}`
        };
      }

      const data = await response.json();

      return {
        healthy: true,
        orchestratorUrl: this.orchestratorUrl,
        servers: data.servers || 0,
        tools: data.tools || 0,
        responseTime
      };
    } catch (error) {
      const responseTime = `${Date.now() - startTime}ms`;
      const errorMessage = error instanceof Error ? error.message : 'Unknown error';

      this.logger.error({ error, orchestratorUrl: this.orchestratorUrl }, 'MCP health check failed');

      return {
        healthy: false,
        orchestratorUrl: this.orchestratorUrl,
        servers: 0,
        tools: 0,
        responseTime,
        error: errorMessage
      };
    }
  }

  /**
   * Gets the list of registered MCP servers
   */
  async getServers(): Promise<any[]> {
    if (!this.orchestratorUrl) {
      return [];
    }
    try {
      const response = await fetch(`${this.orchestratorUrl}/api/mcp/servers`, {
        method: 'GET',
        headers: {
          'Content-Type': 'application/json'
        },
        signal: AbortSignal.timeout(5000)
      });

      if (!response.ok) {
        return [];
      }

      const data = await response.json();
      return data.servers || [];
    } catch (error) {
      this.logger.error({ error }, 'Failed to get MCP servers');
      return [];
    }
  }

  /**
   * Gets the list of available tools
   */
  async getTools(): Promise<any[]> {
    if (!this.orchestratorUrl) {
      return [];
    }
    try {
      const response = await fetch(`${this.orchestratorUrl}/api/mcp/tools`, {
        method: 'GET',
        headers: {
          'Content-Type': 'application/json'
        },
        signal: AbortSignal.timeout(5000)
      });

      if (!response.ok) {
        return [];
      }

      const data = await response.json();
      return data.tools || [];
    } catch (error) {
      this.logger.error({ error }, 'Failed to get MCP tools');
      return [];
    }
  }
}

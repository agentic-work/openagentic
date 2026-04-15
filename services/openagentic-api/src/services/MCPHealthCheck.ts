/**
 * Copyright 2026 Gnomus.ai
 *
 * Licensed under the Apache License, Version 2.0 (the "License");
 * you may not use this file except in compliance with the License.
 * You may obtain a copy of the License at
 *
 *     http://www.apache.org/licenses/LICENSE-2.0
 *
 * Unless required by applicable law or agreed to in writing, software
 * distributed under the License is distributed on an "AS IS" BASIS,
 * WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
 * See the License for the specific language governing permissions and
 * limitations under the License.
 */

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
  private orchestratorUrl: string;

  constructor(logger: Logger) {
    this.logger = logger;
    this.orchestratorUrl = process.env.MCP_ORCHESTRATOR_URL || process.env.ORCHESTRATOR_URL || 'http://mcp-orchestrator:3001';
  }

  /**
   * Checks the health of the MCP Orchestrator
   */
  async checkMCPHealth(): Promise<MCPHealthStatus> {
    const startTime = Date.now();

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

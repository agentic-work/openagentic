/**
 * MCP (Model Context Protocol) integration types
 */

export interface MCPServer {
  id: string;
  name: string;
  description: string;
  transport: 'stdio' | 'sse' | 'websocket';
  command?: string;
  args?: string[];
  env?: Record<string, string>;
  enabled: boolean;
  userIsolated: boolean;
  requireObo?: boolean;
  capabilities: MCPCapabilities;
  config?: Record<string, any>;
}

export interface MCPCapabilities {
  tools?: boolean;
  resources?: boolean;
  prompts?: boolean;
  logging?: boolean;
}

export interface MCPTool {
  name: string;
  description?: string;
  inputSchema: {
    type: string;
    properties?: Record<string, any>;
    required?: string[];
  };
}

export interface MCPResource {
  uri: string;
  name?: string;
  description?: string;
  mimeType?: string;
}

export interface MCPInstance {
  id: string;
  userId: string;
  serverId: string;
  serverName: string;
  processId?: number;
  status: MCPStatus;
  isHealthy: boolean;
  temporary?: boolean;
  connectionInfo?: Record<string, any>;
  errorMessage?: string;
  startedAt: Date;
  lastActiveAt: Date;
  stoppedAt?: Date;
  availableTools?: MCPTool[];
  resources?: MCPResource[];
}

export enum MCPStatus {
  STARTING = 'STARTING',
  RUNNING = 'RUNNING',
  STOPPED = 'STOPPED',
  ERROR = 'ERROR',
  RESTARTING = 'RESTARTING'
}

export interface MCPToolCall {
  id: string;
  name: string;
  arguments: Record<string, any>;
  serverName?: string; // Name of the MCP server that executed this call
  explanation?: string; // AI-generated explanation of what the tool call does
  result: {
    success: boolean;
    data?: any;
    error?: string;
    executionTime: number;
  };
  timestamp: Date;
}

export interface MCPToolResult {
  content: any;
  isText?: boolean;
  metadata?: Record<string, any>;
}

export interface MCPError {
  code: string;
  message: string;
  data?: any;
}

// Azure MCP specific types
export interface AzureMCPConfig {
  tenantId: string;
  subscriptionId?: string;
  resourceGroup?: string;
  userToken: string;
  scopes: string[];
}

export interface AzureResource {
  id: string;
  name: string;
  type: string;
  location: string;
  resourceGroup: string;
  subscriptionId: string;
  properties?: Record<string, any>;
  tags?: Record<string, string>;
}

// Memory MCP specific types
export interface MemoryMCPConfig {
  userId: string;
  sessionId?: string;
  vectorStore: string;
  embeddingModel: string;
  maxItems: number;
}

export interface MemoryItem {
  id: string;
  userId: string;
  sessionId?: string;
  content: string;
  embedding?: number[];
  metadata: Record<string, any>;
  importance: number;
  accessCount: number;
  createdAt: Date;
  lastAccessedAt: Date;
  expiresAt?: Date;
}

// MCP Orchestrator types
export interface MCPOrchestrator {
  listServers(): Promise<MCPServer[]>;
  getServer(serverId: string): Promise<MCPServer | null>;
  
  // Instance management
  createUserInstance(userId: string, serverId: string, config?: Record<string, any>): Promise<MCPInstance>;
  getUserInstance(userId: string, serverId: string): Promise<MCPInstance | null>;
  stopUserInstance(userId: string, serverId: string): Promise<void>;
  
  // Tool operations
  listUserTools(userId: string, serverId: string): Promise<MCPTool[]>;
  callUserTool(userId: string, serverId: string, toolName: string, args: Record<string, any>): Promise<MCPToolResult>;
  
  // Resource operations
  listUserResources(userId: string, serverId: string): Promise<MCPResource[]>;
  readUserResource(userId: string, serverId: string, uri: string): Promise<any>;
  
  // Health and monitoring
  healthCheck(userId: string, serverId: string): Promise<boolean>;
  getInstanceStats(): Promise<MCPInstanceStats>;
}

export interface MCPInstanceStats {
  totalInstances: number;
  runningInstances: number;
  errorInstances: number;
  instancesByUser: Record<string, number>;
  instancesByServer: Record<string, number>;
  averageStartupTime: number;
  averageExecutionTime: number;
}
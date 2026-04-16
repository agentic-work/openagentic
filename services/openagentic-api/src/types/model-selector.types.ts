/**
 * Type definitions for Dynamic Model Selection
 */

export interface ModelCapability {
  modelName: string;
  supportsTools: boolean;
  responseTime: number;
  lastTested: Date;
  priorityScore: number;
}

export interface TestTool {
  type: 'function';
  function: {
    name: string;
    description: string;
    parameters: {
      type: 'object';
      properties: Record<string, any>;
      required?: string[];
    };
  };
}

export interface ModelSelectorConfig {
  cacheTtlMinutes?: number;
  concurrencyLimit?: number;
  testTimeout?: number;
  retryAttempts?: number;
  preferredModels?: string[]; // Models to prioritize if available
  fallbackModel?: string; // Fallback when no tool-capable models found
}

export interface ModelTestResult {
  supportsTools: boolean;
  responseTime: number;
  error?: string;
}
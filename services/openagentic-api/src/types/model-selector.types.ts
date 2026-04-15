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
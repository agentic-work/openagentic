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
 * A2A Agentic Loop Client
 *
 * Client library for communicating with the A2A Agentic Loop server.
 * Can be used by Claude Code to send tasks and receive results.
 *
 * Usage:
 *   import { AgentClient } from './agentic-loop/client.js';
 *
 *   const client = new AgentClient('http://hal:3456');
 *   const result = await client.validate('services/openagentic-api/src/server.ts');
 */

import { writeFileSync, readFileSync, existsSync, unlinkSync } from 'fs';
import { join } from 'path';
import { randomUUID } from 'crypto';

// ============================================================================
// Types (mirrored from server)
// ============================================================================

export interface AgenticTask {
  id: string;
  type: 'test' | 'validate' | 'analyze' | 'review' | 'execute';
  description: string;
  context?: {
    files?: string[];
    code?: string;
    testCommand?: string;
    expectedOutcome?: string;
  };
  priority?: number;
  createdAt: string;
  status: 'pending' | 'running' | 'completed' | 'failed';
}

export interface AgenticResult {
  taskId: string;
  status: 'success' | 'failure' | 'error';
  summary: string;
  details: {
    findings?: string[];
    suggestions?: string[];
    testsPassed?: number;
    testsFailed?: number;
    errors?: string[];
    analysis?: string;
  };
  duration: number;
  completedAt: string;
  modelUsed: string;
  tokenUsage?: {
    prompt: number;
    completion: number;
    total: number;
  };
}

export interface HealthStatus {
  healthy: boolean;
  details: {
    ollama?: any;
    models?: string[];
    config?: any;
    error?: string;
  };
}

// ============================================================================
// Client Class
// ============================================================================

export class AgentClient {
  private serverUrl: string;
  private timeout: number;

  // File-based communication (for when HTTP isn't available)
  private queueDir: string;
  private resultsDir: string;
  private useFileQueue: boolean;

  constructor(options: {
    serverUrl?: string;
    timeout?: number;
    useFileQueue?: boolean;
    queueDir?: string;
    resultsDir?: string;
  } = {}) {
    this.serverUrl = options.serverUrl || process.env.AGENTIC_LOOP_URL || 'http://localhost:3456';
    this.timeout = options.timeout || 300000; // 5 minutes
    this.useFileQueue = options.useFileQueue || false;
    this.queueDir = options.queueDir || '/mnt/synology/Code/company/openagentic/agentic/.agentic-loop/queue';
    this.resultsDir = options.resultsDir || '/mnt/synology/Code/company/openagentic/agentic/.agentic-loop/results';
  }

  /**
   * Check server health
   */
  async health(): Promise<HealthStatus> {
    if (this.useFileQueue) {
      return { healthy: true, details: { models: ['file-queue-mode'] } };
    }

    const response = await fetch(`${this.serverUrl}/health`, {
      signal: AbortSignal.timeout(10000)
    });

    if (!response.ok) {
      throw new Error(`Health check failed: ${response.status}`);
    }

    return response.json();
  }

  /**
   * Submit a task and wait for result
   */
  async submitTask(task: Omit<AgenticTask, 'id' | 'createdAt' | 'status'>): Promise<AgenticResult> {
    if (this.useFileQueue) {
      return this.submitTaskViaFile(task);
    }

    const response = await fetch(`${this.serverUrl}/task`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(task),
      signal: AbortSignal.timeout(this.timeout)
    });

    if (!response.ok) {
      throw new Error(`Task submission failed: ${response.status}`);
    }

    return response.json();
  }

  /**
   * Submit task via file queue (for when HTTP isn't available)
   */
  private async submitTaskViaFile(taskInput: Omit<AgenticTask, 'id' | 'createdAt' | 'status'>): Promise<AgenticResult> {
    const task: AgenticTask = {
      ...taskInput,
      id: randomUUID(),
      createdAt: new Date().toISOString(),
      status: 'pending'
    };

    // Write task to queue
    const taskPath = join(this.queueDir, `${task.id}.json`);
    writeFileSync(taskPath, JSON.stringify(task, null, 2));

    // Wait for result
    const resultPath = join(this.resultsDir, `${task.id}.json`);
    const startTime = Date.now();

    while (Date.now() - startTime < this.timeout) {
      if (existsSync(resultPath)) {
        const result = JSON.parse(readFileSync(resultPath, 'utf-8')) as AgenticResult;
        unlinkSync(resultPath); // Clean up
        return result;
      }
      await new Promise(resolve => setTimeout(resolve, 1000));
    }

    throw new Error(`Task timeout after ${this.timeout}ms`);
  }

  /**
   * Quick chat - simple message to agent
   */
  async chat(message: string): Promise<AgenticResult> {
    if (this.useFileQueue) {
      return this.submitTask({
        type: 'execute',
        description: message
      });
    }

    const response = await fetch(`${this.serverUrl}/chat`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ message }),
      signal: AbortSignal.timeout(this.timeout)
    });

    if (!response.ok) {
      throw new Error(`Chat failed: ${response.status}`);
    }

    return response.json();
  }

  // ============================================================================
  // Convenience Methods
  // ============================================================================

  /**
   * Validate one or more files
   */
  async validate(files: string | string[], description?: string): Promise<AgenticResult> {
    const fileList = Array.isArray(files) ? files : [files];
    return this.submitTask({
      type: 'validate',
      description: description || `Validate the following files for correctness and best practices: ${fileList.join(', ')}`,
      context: { files: fileList }
    });
  }

  /**
   * Analyze code structure and patterns
   */
  async analyze(files: string | string[], description?: string): Promise<AgenticResult> {
    const fileList = Array.isArray(files) ? files : [files];
    return this.submitTask({
      type: 'analyze',
      description: description || `Analyze the code structure and patterns in: ${fileList.join(', ')}`,
      context: { files: fileList }
    });
  }

  /**
   * Code review (like PR review)
   */
  async review(files: string | string[], description?: string): Promise<AgenticResult> {
    const fileList = Array.isArray(files) ? files : [files];
    return this.submitTask({
      type: 'review',
      description: description || `Perform a code review of: ${fileList.join(', ')}`,
      context: { files: fileList }
    });
  }

  /**
   * Review inline code
   */
  async reviewCode(code: string, language?: string, description?: string): Promise<AgenticResult> {
    return this.submitTask({
      type: 'review',
      description: description || `Review this ${language || 'code'} snippet for issues and improvements`,
      context: { code }
    });
  }

  /**
   * Run and analyze test output
   */
  async test(testCommand: string, expectedOutcome?: string): Promise<AgenticResult> {
    return this.submitTask({
      type: 'test',
      description: `Execute and analyze test results from: ${testCommand}`,
      context: {
        testCommand,
        expectedOutcome: expectedOutcome || 'All tests should pass'
      }
    });
  }

  /**
   * Validate TypeScript compilation
   */
  async validateBuild(buildOutput: string): Promise<AgenticResult> {
    return this.submitTask({
      type: 'test',
      description: 'Analyze TypeScript build output for errors and warnings',
      context: {
        code: buildOutput,
        expectedOutcome: 'Build should complete with no errors'
      }
    });
  }

  /**
   * Security review
   */
  async securityReview(files: string | string[]): Promise<AgenticResult> {
    const fileList = Array.isArray(files) ? files : [files];
    return this.submitTask({
      type: 'validate',
      description: `Perform a security-focused review of: ${fileList.join(', ')}. Check for vulnerabilities, injection risks, authentication issues, and security best practices.`,
      context: { files: fileList }
    });
  }

  /**
   * Compare changes (like diff review)
   */
  async compareChanges(before: string, after: string, description?: string): Promise<AgenticResult> {
    return this.submitTask({
      type: 'review',
      description: description || 'Compare these two versions and analyze the changes',
      context: {
        code: `=== BEFORE ===\n${before}\n\n=== AFTER ===\n${after}`
      }
    });
  }
}

// ============================================================================
// Standalone CLI Usage
// ============================================================================

async function main(): Promise<void> {
  const args = process.argv.slice(2);

  if (args.length === 0 || args.includes('--help')) {
    console.log(`
A2A Agentic Loop Client CLI

Usage:
  npx tsx src/test/agentic-loop/client.ts <command> [options]

Commands:
  health                    Check server health
  chat <message>            Send a message to the agent
  validate <file> [files]   Validate one or more files
  analyze <file> [files]    Analyze code structure
  review <file> [files]     Code review
  security <file> [files]   Security review
  test <command>            Run and analyze tests

Options:
  --server=URL              Server URL (default: http://localhost:3456)
  --file-queue              Use file-based queue instead of HTTP
  --help                    Show this help

Examples:
  npx tsx client.ts chat "What potential issues exist in server.ts?"
  npx tsx client.ts validate services/openagentic-api/src/server.ts
  npx tsx client.ts security src/middleware/unifiedAuth.ts
`);
    return;
  }

  const serverUrl = args.find(a => a.startsWith('--server='))?.replace('--server=', '') || 'http://localhost:3456';
  const useFileQueue = args.includes('--file-queue');

  const client = new AgentClient({ serverUrl, useFileQueue });
  const command = args[0];
  const commandArgs = args.slice(1).filter(a => !a.startsWith('--'));

  try {
    let result: AgenticResult | HealthStatus;

    switch (command) {
      case 'health':
        result = await client.health();
        break;

      case 'chat':
        result = await client.chat(commandArgs.join(' '));
        break;

      case 'validate':
        result = await client.validate(commandArgs);
        break;

      case 'analyze':
        result = await client.analyze(commandArgs);
        break;

      case 'review':
        result = await client.review(commandArgs);
        break;

      case 'security':
        result = await client.securityReview(commandArgs);
        break;

      case 'test':
        result = await client.test(commandArgs.join(' '));
        break;

      default:
        console.error(`Unknown command: ${command}`);
        process.exit(1);
    }

    console.log(JSON.stringify(result, null, 2));
  } catch (error) {
    console.error('Error:', error instanceof Error ? error.message : error);
    process.exit(1);
  }
}

// Run if executed directly
if (import.meta.url === `file://${process.argv[1]}`) {
  main().catch(console.error);
}

export default AgentClient;

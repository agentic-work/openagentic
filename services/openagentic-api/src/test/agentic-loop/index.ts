/**
 * A2A Agentic Loop Server
 *
 * An Agent-to-Agent testing loop that enables Claude Code to communicate with
 * a gpt-oss instance on the GPU node for continuous testing and validation during development.
 *
 * Architecture:
 * - Runs on the GPU node server with access to ollama:gpt-oss
 * - Uses synology mount for shared codebase access
 * - Accepts requests via HTTP API or direct file-based communication
 * - Executes tests, validates changes, and reports results
 *
 * Usage:
 *   # Start the A2A loop server on the GPU node
 *   HAL_OLLAMA_URL=http://localhost:11434 npx tsx src/test/agentic-loop/index.ts
 *
 *   # Or use the convenience script
 *   npm run agentic-loop
 *
 * Communication Methods:
 *   1. HTTP API: POST /task with JSON body
 *   2. File-based: Write to QUEUE_DIR, read from RESULTS_DIR
 */

import Fastify, { FastifyInstance } from 'fastify';
import { OllamaProvider } from '../../services/llm-providers/OllamaProvider.js';
import pino from 'pino';
import { existsSync, mkdirSync, readFileSync, writeFileSync, readdirSync, unlinkSync } from 'fs';
import { join } from 'path';
import { randomUUID } from 'crypto';

// ============================================================================
// Configuration
// ============================================================================

interface LoopConfig {
  port: number;
  ollamaUrl: string;
  model: string;
  queueDir: string;
  resultsDir: string;
  codebaseRoot: string;
  pollInterval: number;
  maxTaskDuration: number;
  enableFileQueue: boolean;
}

function getConfig(): LoopConfig {
  return {
    port: parseInt(process.env.AGENTIC_LOOP_PORT || '3456', 10),
    ollamaUrl: process.env.HAL_OLLAMA_URL || process.env.OLLAMA_BASE_URL || 'http://localhost:11434',
    model: process.env.HAL_OLLAMA_MODEL || 'gpt-oss',
    queueDir: process.env.AGENTIC_QUEUE_DIR || '/mnt/synology/Code/company/openagentic/agentic/.agentic-loop/queue',
    resultsDir: process.env.AGENTIC_RESULTS_DIR || '/mnt/synology/Code/company/openagentic/agentic/.agentic-loop/results',
    codebaseRoot: process.env.CODEBASE_ROOT || '/mnt/synology/Code/company/openagentic/agentic',
    pollInterval: parseInt(process.env.POLL_INTERVAL || '2000', 10),
    maxTaskDuration: parseInt(process.env.MAX_TASK_DURATION || '300000', 10), // 5 minutes
    enableFileQueue: process.env.ENABLE_FILE_QUEUE !== 'false'
  };
}

// ============================================================================
// Types
// ============================================================================

interface AgenticTask {
  id: string;
  type: 'test' | 'validate' | 'analyze' | 'review' | 'execute';
  description: string;
  context?: {
    files?: string[];      // Files to analyze
    code?: string;         // Inline code to review
    testCommand?: string;  // Command to run
    expectedOutcome?: string;
  };
  priority?: number;
  createdAt: string;
  status: 'pending' | 'running' | 'completed' | 'failed';
}

interface AgenticResult {
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

// ============================================================================
// Agentic Loop Service
// ============================================================================

class AgentService {
  private config: LoopConfig;
  private logger: pino.Logger;
  private provider: OllamaProvider;
  private runningTasks: Map<string, AbortController> = new Map();

  constructor(config: LoopConfig) {
    this.config = config;
    this.logger = pino({
      level: process.env.LOG_LEVEL || 'info',
      transport: {
        target: 'pino-pretty',
        options: { colorize: true }
      }
    });

    this.provider = new OllamaProvider(this.logger, {
      baseUrl: config.ollamaUrl,
      healthCheckModel: config.model
    });

    // Ensure directories exist
    if (config.enableFileQueue) {
      this.ensureDirectories();
    }
  }

  private ensureDirectories(): void {
    [this.config.queueDir, this.config.resultsDir].forEach(dir => {
      if (!existsSync(dir)) {
        mkdirSync(dir, { recursive: true });
        this.logger.info({ dir }, 'Created directory');
      }
    });
  }

  async checkHealth(): Promise<{ healthy: boolean; details: any }> {
    try {
      const health = await this.provider.getHealth();
      const models = await this.provider.listModels();

      return {
        healthy: health.status === 'healthy',
        details: {
          ollama: health,
          models: models.map(m => m.id),
          config: {
            ollamaUrl: this.config.ollamaUrl,
            model: this.config.model,
            codebaseRoot: this.config.codebaseRoot
          }
        }
      };
    } catch (error) {
      return {
        healthy: false,
        details: {
          error: error instanceof Error ? error.message : String(error)
        }
      };
    }
  }

  async executeTask(task: AgenticTask): Promise<AgenticResult> {
    const startTime = Date.now();
    this.logger.info({ taskId: task.id, type: task.type }, 'Executing task');

    try {
      // Build system prompt based on task type
      const systemPrompt = this.buildSystemPrompt(task);

      // Build user prompt with context
      const userPrompt = this.buildUserPrompt(task);

      // Execute the task via gpt-oss
      const response = await this.provider.createCompletion({
        model: this.config.model,
        messages: [
          { role: 'system', content: systemPrompt },
          { role: 'user', content: userPrompt }
        ],
        stream: false,
        max_tokens: 4096,
        temperature: 0.3
      });

      const content = (response as any).choices?.[0]?.message?.content || '';
      const usage = (response as any).usage;

      // Parse the structured response
      const result = this.parseAgentResponse(task, content, startTime, usage);

      this.logger.info({
        taskId: task.id,
        status: result.status,
        duration: result.duration
      }, 'Task completed');

      return result;

    } catch (error) {
      this.logger.error({ taskId: task.id, error }, 'Task failed');

      return {
        taskId: task.id,
        status: 'error',
        summary: `Task execution failed: ${error instanceof Error ? error.message : String(error)}`,
        details: {
          errors: [error instanceof Error ? error.message : String(error)]
        },
        duration: Date.now() - startTime,
        completedAt: new Date().toISOString(),
        modelUsed: this.config.model
      };
    }
  }

  private buildSystemPrompt(task: AgenticTask): string {
    const basePrompt = `You are an AI testing and code validation agent. You work as part of an A2A (Agent-to-Agent) loop with Claude Code. Your role is to analyze code, validate changes, and provide structured feedback.

You have access to the codebase at: ${this.config.codebaseRoot}

Always respond in a structured format with clear sections:
1. SUMMARY: A one-line summary of your findings
2. STATUS: Either SUCCESS, FAILURE, or NEEDS_ATTENTION
3. FINDINGS: Bullet points of what you found
4. SUGGESTIONS: Specific actionable suggestions
5. ANALYSIS: Detailed analysis if needed`;

    switch (task.type) {
      case 'test':
        return `${basePrompt}

Your specific role: Execute and validate test results. Analyze test output for failures, coverage issues, and reliability concerns.`;

      case 'validate':
        return `${basePrompt}

Your specific role: Validate code changes for correctness, security, and best practices. Check for potential bugs, security vulnerabilities, and adherence to coding standards.`;

      case 'analyze':
        return `${basePrompt}

Your specific role: Perform deep analysis of code structure, patterns, and potential improvements. Focus on architecture, maintainability, and performance.`;

      case 'review':
        return `${basePrompt}

Your specific role: Conduct a code review as if reviewing a pull request. Look for issues, suggest improvements, and identify any blocking concerns.`;

      case 'execute':
        return `${basePrompt}

Your specific role: Understand and execute the given task, providing detailed results and any relevant output.`;

      default:
        return basePrompt;
    }
  }

  private buildUserPrompt(task: AgenticTask): string {
    let prompt = `Task: ${task.description}\n\n`;

    if (task.context?.files && task.context.files.length > 0) {
      prompt += 'Files to analyze:\n';
      for (const file of task.context.files) {
        const fullPath = join(this.config.codebaseRoot, file);
        if (existsSync(fullPath)) {
          const content = readFileSync(fullPath, 'utf-8');
          prompt += `\n--- ${file} ---\n${content}\n--- end ${file} ---\n`;
        } else {
          prompt += `\n[File not found: ${file}]\n`;
        }
      }
    }

    if (task.context?.code) {
      prompt += `\nCode to review:\n\`\`\`\n${task.context.code}\n\`\`\`\n`;
    }

    if (task.context?.testCommand) {
      prompt += `\nTest command to consider: ${task.context.testCommand}\n`;
    }

    if (task.context?.expectedOutcome) {
      prompt += `\nExpected outcome: ${task.context.expectedOutcome}\n`;
    }

    prompt += '\nProvide your analysis in the structured format specified.';

    return prompt;
  }

  private parseAgentResponse(task: AgenticTask, content: string, startTime: number, usage?: any): AgenticResult {
    // Parse the structured response
    const summaryMatch = content.match(/SUMMARY:?\s*(.+?)(?=\n|STATUS:|$)/is);
    const statusMatch = content.match(/STATUS:?\s*(SUCCESS|FAILURE|NEEDS_ATTENTION)/i);
    const findingsMatch = content.match(/FINDINGS:?\s*([\s\S]*?)(?=SUGGESTIONS:|ANALYSIS:|$)/i);
    const suggestionsMatch = content.match(/SUGGESTIONS:?\s*([\s\S]*?)(?=ANALYSIS:|$)/i);
    const analysisMatch = content.match(/ANALYSIS:?\s*([\s\S]*?)$/i);

    const status = statusMatch?.[1]?.toUpperCase() === 'SUCCESS' ? 'success' :
                   statusMatch?.[1]?.toUpperCase() === 'FAILURE' ? 'failure' : 'success';

    const findings = findingsMatch?.[1]
      ?.split('\n')
      .map(l => l.trim().replace(/^[-*•]\s*/, ''))
      .filter(l => l.length > 0) || [];

    const suggestions = suggestionsMatch?.[1]
      ?.split('\n')
      .map(l => l.trim().replace(/^[-*•]\s*/, ''))
      .filter(l => l.length > 0) || [];

    return {
      taskId: task.id,
      status,
      summary: summaryMatch?.[1]?.trim() || content.substring(0, 200),
      details: {
        findings,
        suggestions,
        analysis: analysisMatch?.[1]?.trim()
      },
      duration: Date.now() - startTime,
      completedAt: new Date().toISOString(),
      modelUsed: this.config.model,
      tokenUsage: usage ? {
        prompt: usage.prompt_tokens || 0,
        completion: usage.completion_tokens || 0,
        total: usage.total_tokens || 0
      } : undefined
    };
  }

  // File-based queue processing
  async processFileQueue(): Promise<void> {
    if (!this.config.enableFileQueue) return;

    const files = readdirSync(this.config.queueDir).filter(f => f.endsWith('.json'));

    for (const file of files) {
      const taskPath = join(this.config.queueDir, file);
      try {
        const taskData = JSON.parse(readFileSync(taskPath, 'utf-8')) as AgenticTask;
        taskData.status = 'running';

        // Execute the task
        const result = await this.executeTask(taskData);

        // Write result
        const resultPath = join(this.config.resultsDir, `${taskData.id}.json`);
        writeFileSync(resultPath, JSON.stringify(result, null, 2));

        // Remove from queue
        unlinkSync(taskPath);

        this.logger.info({ taskId: taskData.id, resultPath }, 'Task completed and moved to results');
      } catch (error) {
        this.logger.error({ file, error }, 'Failed to process queue item');
      }
    }
  }

  startFileQueuePolling(): void {
    if (!this.config.enableFileQueue) return;

    this.logger.info({ pollInterval: this.config.pollInterval }, 'Starting file queue polling');

    setInterval(() => {
      this.processFileQueue().catch(err =>
        this.logger.error({ error: err }, 'Queue processing error')
      );
    }, this.config.pollInterval);
  }
}

// ============================================================================
// HTTP Server
// ============================================================================

async function createServer(service: AgentService, config: LoopConfig): Promise<FastifyInstance> {
  const server = Fastify({
    logger: {
      level: process.env.LOG_LEVEL || 'info',
      transport: {
        target: 'pino-pretty',
        options: { colorize: true }
      }
    }
  });

  // Health endpoint
  server.get('/health', async () => {
    return service.checkHealth();
  });

  // Submit task endpoint
  server.post<{ Body: Omit<AgenticTask, 'id' | 'createdAt' | 'status'> }>('/task', async (request, reply) => {
    const task: AgenticTask = {
      ...request.body,
      id: randomUUID(),
      createdAt: new Date().toISOString(),
      status: 'pending'
    };

    const result = await service.executeTask(task);
    return reply.send(result);
  });

  // Batch tasks endpoint
  server.post<{ Body: Array<Omit<AgenticTask, 'id' | 'createdAt' | 'status'>> }>('/tasks', async (request, reply) => {
    const results: AgenticResult[] = [];

    for (const taskInput of request.body) {
      const task: AgenticTask = {
        ...taskInput,
        id: randomUUID(),
        createdAt: new Date().toISOString(),
        status: 'pending'
      };

      results.push(await service.executeTask(task));
    }

    return reply.send({ results });
  });

  // Quick test endpoint - convenient for simple validations
  server.post<{ Body: { message: string } }>('/chat', async (request, reply) => {
    const task: AgenticTask = {
      id: randomUUID(),
      type: 'execute',
      description: request.body.message,
      createdAt: new Date().toISOString(),
      status: 'pending'
    };

    const result = await service.executeTask(task);
    return reply.send(result);
  });

  // Config info endpoint
  server.get('/config', async () => {
    return {
      model: config.model,
      ollamaUrl: config.ollamaUrl,
      codebaseRoot: config.codebaseRoot,
      enableFileQueue: config.enableFileQueue
    };
  });

  return server;
}

// ============================================================================
// Main Entry Point
// ============================================================================

async function main(): Promise<void> {
  const config = getConfig();
  const service = new AgentService(config);

  console.log(`
╔═══════════════════════════════════════════════════════════════════════════════╗
║                       A2A AGENTIC LOOP SERVER                                  ║
║═══════════════════════════════════════════════════════════════════════════════║
║  Ollama URL:    ${config.ollamaUrl.padEnd(55)}║
║  Model:         ${config.model.padEnd(55)}║
║  Codebase:      ${config.codebaseRoot.padEnd(55)}║
║  Port:          ${String(config.port).padEnd(55)}║
║  File Queue:    ${(config.enableFileQueue ? 'enabled' : 'disabled').padEnd(55)}║
╚═══════════════════════════════════════════════════════════════════════════════╝
`);

  // Check health before starting
  const health = await service.checkHealth();
  if (!health.healthy) {
    console.error('❌ Health check failed:', health.details);
    console.error('Make sure ollama is running and the model is available.');
    process.exit(1);
  }

  console.log('✅ Health check passed');
  console.log('Available models:', health.details.models.join(', '));

  // Start file queue polling if enabled
  if (config.enableFileQueue) {
    service.startFileQueuePolling();
    console.log(`📁 File queue polling enabled (${config.queueDir})`);
  }

  // Start HTTP server
  const server = await createServer(service, config);
  await server.listen({ port: config.port, host: '0.0.0.0' });

  console.log(`\n🚀 A2A Agentic Loop Server running on http://0.0.0.0:${config.port}`);
  console.log(`
📡 Endpoints:
   POST /task    - Submit a single task
   POST /tasks   - Submit multiple tasks
   POST /chat    - Quick chat/test
   GET  /health  - Health check
   GET  /config  - View configuration

📋 Example usage:
   curl -X POST http://localhost:${config.port}/chat \\
     -H "Content-Type: application/json" \\
     -d '{"message": "Analyze the server.ts file for potential issues"}'
`);
}

main().catch(console.error);

export { AgentService, AgenticTask, AgenticResult };

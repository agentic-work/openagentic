#!/usr/bin/env npx tsx
/**
 * HAL Client - Send tasks to openagentic running on hal
 *
 * This client writes tasks to the shared synology queue and reads results back.
 * Works via file system - no network needed.
 *
 * Usage:
 *   npx tsx hal-client.ts chat "What potential issues exist in server.ts?"
 *   npx tsx hal-client.ts validate src/server.ts
 *   npx tsx hal-client.ts review src/plugins/admin.plugin.ts src/plugins/auth.plugin.ts
 */

import { existsSync, mkdirSync, writeFileSync, readFileSync, unlinkSync, readdirSync } from 'fs';
import { join } from 'path';
import { randomUUID } from 'crypto';

const QUEUE_DIR = '/mnt/synology/Code/company/openagentic/agentic/.a2a-queue/tasks';
const RESULTS_DIR = '/mnt/synology/Code/company/openagentic/agentic/.a2a-queue/results';

interface A2ATask {
  id: string;
  type: 'validate' | 'review' | 'test' | 'execute' | 'chat';
  prompt: string;
  files?: string[];
  context?: string;
  createdAt: string;
}

interface A2AResult {
  taskId: string;
  status: 'success' | 'error';
  response: string;
  thinking?: string;
  toolCalls?: Array<{ name: string; arguments: Record<string, unknown> }>;
  duration: number;
  tokens: { prompt: number; completion: number; total: number };
  completedAt: string;
}

// Ensure directories exist
[QUEUE_DIR, RESULTS_DIR].forEach(dir => {
  if (!existsSync(dir)) {
    mkdirSync(dir, { recursive: true });
  }
});

export async function sendTask(
  type: A2ATask['type'],
  prompt: string,
  files?: string[],
  context?: string,
  timeout = 300000  // 5 minutes
): Promise<A2AResult> {
  const task: A2ATask = {
    id: randomUUID(),
    type,
    prompt,
    files,
    context,
    createdAt: new Date().toISOString()
  };

  // Write task to queue
  const taskPath = join(QUEUE_DIR, `${task.id}.json`);
  writeFileSync(taskPath, JSON.stringify(task, null, 2));
  console.log(`📤 Task submitted: ${task.id}`);
  console.log(`   Type: ${type}`);
  console.log(`   Waiting for hal to process...`);

  // Wait for result
  const resultPath = join(RESULTS_DIR, `${task.id}.json`);
  const startTime = Date.now();

  while (Date.now() - startTime < timeout) {
    if (existsSync(resultPath)) {
      const result = JSON.parse(readFileSync(resultPath, 'utf-8')) as A2AResult;
      unlinkSync(resultPath);  // Clean up
      return result;
    }
    await new Promise(resolve => setTimeout(resolve, 1000));
    process.stdout.write('.');
  }

  // Timeout - clean up task if still in queue
  if (existsSync(taskPath)) {
    unlinkSync(taskPath);
  }

  throw new Error(`Task timeout after ${timeout}ms - is the a2a-worker running on hal?`);
}

// Convenience functions
export const validate = (files: string[], prompt?: string) =>
  sendTask('validate', prompt || `Validate these files for issues`, files);

export const review = (files: string[], prompt?: string) =>
  sendTask('review', prompt || `Review these files`, files);

export const test = (prompt: string, context?: string) =>
  sendTask('test', prompt, undefined, context);

export const chat = (prompt: string, files?: string[]) =>
  sendTask('chat', prompt, files);

export const execute = (prompt: string, files?: string[], context?: string) =>
  sendTask('execute', prompt, files, context);

// Check if worker is running
export function isWorkerRunning(): boolean {
  // Check for recent activity in results dir
  try {
    const files = readdirSync(RESULTS_DIR);
    return true;  // Directory exists, assume worker might be running
  } catch {
    return false;
  }
}

// Print result nicely
function printResult(result: A2AResult): void {
  const statusIcon = result.status === 'success' ? '✅' : '❌';

  console.log('\n' + '═'.repeat(80));
  console.log(`${statusIcon} RESULT from HAL (${result.duration}ms)`);
  console.log('═'.repeat(80));

  if (result.thinking) {
    console.log('\n💭 Thinking:');
    console.log(result.thinking.substring(0, 500) + (result.thinking.length > 500 ? '...' : ''));
  }

  console.log('\n📝 Response:');
  console.log(result.response);

  if (result.toolCalls && result.toolCalls.length > 0) {
    console.log('\n🔧 Tool Calls:');
    result.toolCalls.forEach(tc => {
      console.log(`   - ${tc.name}: ${JSON.stringify(tc.arguments).substring(0, 100)}`);
    });
  }

  console.log('\n📊 Tokens:', result.tokens.total);
  console.log('═'.repeat(80) + '\n');
}

// CLI
async function main(): Promise<void> {
  const args = process.argv.slice(2);

  if (args.length === 0 || args.includes('--help')) {
    console.log(`
HAL Client - Send tasks to openagentic on hal

Usage:
  npx tsx hal-client.ts <command> [args...]

Commands:
  chat <message>              Send a chat message
  validate <file> [files...]  Validate files
  review <file> [files...]    Review files
  test <prompt>               Run test analysis
  execute <prompt>            Execute a task

Examples:
  npx tsx hal-client.ts chat "What are the main issues in server.ts?"
  npx tsx hal-client.ts validate services/openagentic-api/src/server.ts
  npx tsx hal-client.ts review src/plugins/*.ts

Note: Make sure a2a-worker.ts is running on hal!
`);
    return;
  }

  const command = args[0];
  const rest = args.slice(1);

  try {
    let result: A2AResult;

    switch (command) {
      case 'chat':
        result = await chat(rest.join(' '));
        break;

      case 'validate':
        result = await validate(rest);
        break;

      case 'review':
        result = await review(rest);
        break;

      case 'test':
        result = await test(rest.join(' '));
        break;

      case 'execute':
        result = await execute(rest.join(' '));
        break;

      default:
        // Treat unknown command as chat
        result = await chat(args.join(' '));
    }

    printResult(result);

  } catch (error) {
    console.error('Error:', error instanceof Error ? error.message : error);
    process.exit(1);
  }
}

// Run if executed directly
if (import.meta.url === `file://${process.argv[1]}`) {
  main().catch(console.error);
}

export default { sendTask, validate, review, test, chat, execute, isWorkerRunning };

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
 * Parallel Executor Utility
 *
 * Provides utilities for executing independent operations in parallel
 * to maximize performance and reduce latency
 */

import type { Logger } from 'pino';

export interface ParallelTask<T> {
  name: string;
  execute: () => Promise<T>;
  critical?: boolean; // If true, failure will abort all tasks
  timeout?: number;   // Optional timeout in milliseconds
}

export interface ParallelResult<T> {
  name: string;
  success: boolean;
  result?: T;
  error?: any;
  duration: number;
}

/**
 * Execute multiple independent tasks in parallel
 */
export async function executeParallel<T = any>(
  tasks: ParallelTask<T>[],
  logger?: Logger
): Promise<ParallelResult<T>[]> {
  const startTime = Date.now();

  logger?.debug({
    taskCount: tasks.length,
    taskNames: tasks.map(t => t.name)
  }, 'Executing tasks in parallel');

  const promises = tasks.map(async (task): Promise<ParallelResult<T>> => {
    const taskStart = Date.now();

    try {
      // Add timeout wrapper if specified
      let promise = task.execute();
      if (task.timeout) {
        promise = withTimeout(promise, task.timeout, `Task ${task.name} timed out`);
      }

      const result = await promise;
      const duration = Date.now() - taskStart;

      logger?.debug({
        task: task.name,
        duration,
        success: true
      }, 'Parallel task completed');

      return {
        name: task.name,
        success: true,
        result,
        duration
      };

    } catch (error) {
      const duration = Date.now() - taskStart;

      logger?.error({
        task: task.name,
        error: error.message,
        duration,
        critical: task.critical
      }, 'Parallel task failed');

      // If critical task fails, throw immediately
      if (task.critical) {
        throw new Error(`Critical task '${task.name}' failed: ${error.message}`);
      }

      return {
        name: task.name,
        success: false,
        error,
        duration
      };
    }
  });

  const results = await Promise.all(promises);

  const totalDuration = Date.now() - startTime;
  const successCount = results.filter(r => r.success).length;

  logger?.info({
    totalDuration,
    taskCount: tasks.length,
    successCount,
    failureCount: tasks.length - successCount,
    averageDuration: Math.round(results.reduce((sum, r) => sum + r.duration, 0) / results.length)
  }, 'Parallel execution completed');

  return results;
}

/**
 * Execute tasks with dependencies (some parallel, some sequential)
 */
export async function executeWithDependencies<T = any>(
  taskGroups: ParallelTask<T>[][],
  logger?: Logger
): Promise<ParallelResult<T>[][]> {
  const allResults: ParallelResult<T>[][] = [];

  for (const [index, group] of taskGroups.entries()) {
    logger?.debug({
      groupIndex: index,
      groupSize: group.length
    }, 'Executing task group');

    const results = await executeParallel(group, logger);
    allResults.push(results);

    // Check if any critical task in group failed
    const criticalFailure = results.find(r => !r.success && group.find(t => t.name === r.name)?.critical);
    if (criticalFailure) {
      throw new Error(`Critical failure in group ${index}: ${criticalFailure.error?.message}`);
    }
  }

  return allResults;
}

/**
 * Batch database queries to reduce round trips
 */
export async function batchQueries<T>(
  queries: Array<() => Promise<T>>,
  batchSize: number = 10,
  logger?: Logger
): Promise<T[]> {
  const results: T[] = [];

  for (let i = 0; i < queries.length; i += batchSize) {
    const batch = queries.slice(i, i + batchSize);

    logger?.debug({
      batchIndex: Math.floor(i / batchSize),
      batchSize: batch.length,
      totalQueries: queries.length
    }, 'Executing query batch');

    const batchResults = await Promise.all(batch.map(q => q()));
    results.push(...batchResults);
  }

  return results;
}

/**
 * Execute tasks in parallel with a concurrency limit using Promise.allSettled.
 * Unlike executeParallel, this never throws on individual failures —
 * all results (fulfilled or rejected) are returned for the caller to handle.
 */
export async function executeParallelSettled<T = any>(
  tasks: ParallelTask<T>[],
  concurrency: number = 5,
  logger?: Logger
): Promise<ParallelResult<T>[]> {
  if (tasks.length === 0) return [];

  const startTime = Date.now();
  const results: ParallelResult<T>[] = new Array(tasks.length);
  let nextIndex = 0;

  logger?.debug({
    taskCount: tasks.length,
    concurrency,
    taskNames: tasks.map(t => t.name)
  }, '[PARALLEL] Executing tasks with concurrency limit');

  async function runNext(): Promise<void> {
    while (nextIndex < tasks.length) {
      const idx = nextIndex++;
      const task = tasks[idx];
      const taskStart = Date.now();

      try {
        let promise = task.execute();
        if (task.timeout) {
          promise = withTimeout(promise, task.timeout, `Task ${task.name} timed out`);
        }
        const result = await promise;
        results[idx] = {
          name: task.name,
          success: true,
          result,
          duration: Date.now() - taskStart
        };
      } catch (error: any) {
        results[idx] = {
          name: task.name,
          success: false,
          error,
          duration: Date.now() - taskStart
        };
        logger?.warn({
          task: task.name,
          error: error.message,
          duration: Date.now() - taskStart
        }, '[PARALLEL] Task failed');
      }
    }
  }

  // Launch `concurrency` number of worker loops
  const workers = Array.from(
    { length: Math.min(concurrency, tasks.length) },
    () => runNext()
  );
  await Promise.all(workers);

  const totalDuration = Date.now() - startTime;
  const successCount = results.filter(r => r.success).length;

  logger?.info({
    totalDuration,
    taskCount: tasks.length,
    concurrency,
    successCount,
    failureCount: tasks.length - successCount
  }, '[PARALLEL] Concurrency-limited execution completed');

  return results;
}

/**
 * Add timeout to a promise
 */
function withTimeout<T>(
  promise: Promise<T>,
  timeoutMs: number,
  errorMessage: string = 'Operation timed out'
): Promise<T> {
  return Promise.race([
    promise,
    new Promise<T>((_, reject) =>
      setTimeout(() => reject(new Error(errorMessage)), timeoutMs)
    )
  ]);
}

/**
 * Retry failed operations with exponential backoff
 */
export async function retryWithBackoff<T>(
  operation: () => Promise<T>,
  options: {
    maxRetries?: number;
    initialDelay?: number;
    maxDelay?: number;
    backoffFactor?: number;
    logger?: Logger;
  } = {}
): Promise<T> {
  const {
    maxRetries = 3,
    initialDelay = 100,
    maxDelay = 5000,
    backoffFactor = 2,
    logger
  } = options;

  let lastError: any;
  let delay = initialDelay;

  for (let attempt = 1; attempt <= maxRetries; attempt++) {
    try {
      return await operation();
    } catch (error) {
      lastError = error;

      if (attempt === maxRetries) {
        logger?.error({
          error: error.message,
          attempts: attempt
        }, 'Operation failed after all retries');
        throw error;
      }

      logger?.warn({
        error: error.message,
        attempt,
        nextDelay: delay
      }, 'Operation failed, retrying...');

      await new Promise(resolve => setTimeout(resolve, delay));
      delay = Math.min(delay * backoffFactor, maxDelay);
    }
  }

  throw lastError;
}
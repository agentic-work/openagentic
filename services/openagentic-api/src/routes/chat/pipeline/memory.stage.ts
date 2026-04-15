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
 * Memory Pipeline Stage — Thin wrapper around UserMemoryService.
 *
 * SYNC: getContext() is AWAITED before completion stage (no fire-and-forget).
 * ASYNC: ingest() runs fire-and-forget to store user message for future recall.
 */

import { PipelineStage, PipelineContext } from './pipeline.types.js';
import type { Logger } from 'pino';
import { getUserMemoryService } from '../../../services/UserMemoryService.js';

export class MemoryStage implements PipelineStage {
  name = 'memory';
  private logger: Logger;

  constructor(
    private cacheManager: any,
    private prisma: any,
    logger: any,
    private config?: { enabled?: boolean },
  ) {
    this.logger = logger.child({ stage: this.name });
  }

  async execute(context: PipelineContext): Promise<PipelineContext> {
    const startTime = Date.now();

    try {
      if (!context.config?.enableMemory && !this.config?.enabled) {
        this.logger.debug('Memory system disabled, skipping stage');
        return context;
      }

      const userId = context.user?.id;
      if (!userId) {
        this.logger.debug('No user ID, skipping memory stage');
        return context;
      }

      const query = context.request?.message || '';

      // Determine token budget based on model context window
      const tokenBudget = this.getTokenBudget(context);

      let memoryService: ReturnType<typeof getUserMemoryService> | null = null;
      try {
        memoryService = getUserMemoryService();
      } catch {
        this.logger.debug('UserMemoryService not initialized, skipping');
        return context;
      }

      // SYNCHRONOUS — must complete before completion stage
      const memoryBlock = await memoryService.getContext(userId, query, tokenBudget);

      if (memoryBlock) {
        context.systemPrompt = context.systemPrompt
          ? `${context.systemPrompt}\n\n${memoryBlock}`
          : memoryBlock;

        context.metadata = {
          ...context.metadata,
          memoryEnabled: true,
          memoryContextLength: memoryBlock.length,
        };

        context.emit('memory_status', {
          contextInjected: true,
          tokenEstimate: Math.ceil(memoryBlock.length / 4),
          processingTime: Date.now() - startTime,
        });
      }

      // Fire-and-forget: ingest user message for future recall
      if (query.length >= 30) {
        memoryService.ingest(userId, 'chat', context.session?.id, query, 0.6).catch(() => {});
      }

      this.logger.info({
        userId,
        hasContext: !!memoryBlock,
        executionTime: Date.now() - startTime,
      }, '[Memory] Stage completed');

      return context;

    } catch (error: any) {
      this.logger.error({ error: error.message, executionTime: Date.now() - startTime }, '[Memory] Stage failed');
      // Memory failures should not block the pipeline
      context.emit('warning', { message: 'Memory system unavailable', code: 'MEMORY_PROCESSING_FAILED' });
      return context;
    }
  }

  private getTokenBudget(context: PipelineContext): number {
    // Determine based on model context window
    const modelId = (context as any).model || context.config?.model || '';
    if (modelId.includes('claude') || modelId.includes('opus') || modelId.includes('sonnet')) return 1500;
    if (modelId.includes('gpt-4')) return 1000;
    if (modelId.includes('llama') || modelId.includes('qwen') || modelId.includes('mistral')) return 500;
    return 1000; // default
  }

  async rollback(context: PipelineContext): Promise<void> {
    delete context.memoryContext;
    if (context.metadata) {
      delete context.metadata.memoryEnabled;
      delete context.metadata.memoryContextLength;
    }
    this.logger.debug({ messageId: context.messageId }, '[Memory] Rollback completed');
  }
}

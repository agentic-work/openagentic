/**
 * conversation_memory node executor — stateful chat memory primitive.
 *
 * Wraps the engine's `conversationMemory` hook (Prisma-backed
 * ConversationMemoryService). Four operations: read / write / clear /
 * summarize. The executor stays pure — no Prisma import, no DB types
 * leaked — so unit tests can inject a mock hook and the service is
 * swappable at the engine layer.
 *
 * Gap-analysis 2026-05-14 P0 #2. Reference patterns:
 *   - Flowise BufferMemory + ConversationSummaryMemory
 *   - Langflow src/lfx/src/lfx/components/models_and_agents/memory.py
 *
 * Tenant isolation: the engine threads `ctx.tenantId` into every hook
 * call, so two tenants can use the same `memoryId` without seeing each
 * other's history (ConversationMemoryService filters by tenant_id in
 * every Prisma query).
 */

import type { WorkflowNode } from '../types.js';
import type { NodeExecutionContext } from '../types.js';

type Operation = 'read' | 'write' | 'clear' | 'summarize' | 'search';
const OPERATIONS: ReadonlySet<Operation> = new Set([
  'read',
  'write',
  'clear',
  'summarize',
  'search',
]);
const VALID_ROLES: ReadonlySet<string> = new Set(['user', 'assistant', 'system']);

export async function execute(
  node: WorkflowNode,
  input: unknown,
  ctx: NodeExecutionContext,
): Promise<unknown> {
  if (ctx.signal.aborted) throw new Error('aborted');

  const data = node.data as Record<string, unknown>;
  const operation = String(data.operation ?? 'read') as Operation;
  if (!OPERATIONS.has(operation)) {
    throw new Error(
      `conversation_memory: unknown operation '${operation}' — must be one of read | write | clear | summarize`,
    );
  }

  const memoryIdRaw = typeof data.memoryId === 'string' ? data.memoryId : '';
  const memoryId = memoryIdRaw.includes('{{')
    ? ctx.interpolateTemplate(memoryIdRaw, input).trim()
    : memoryIdRaw.trim();
  if (!memoryId) {
    throw new Error("conversation_memory: 'memoryId' is required");
  }

  if (!ctx.conversationMemory) {
    throw new Error(
      'conversation_memory: engine conversationMemory hook is not wired — workflow engine config error',
    );
  }
  const hook = ctx.conversationMemory;
  const tenantId = ctx.tenantId;

  switch (operation) {
    case 'write': {
      const role = typeof data.role === 'string' ? data.role : 'user';
      if (!VALID_ROLES.has(role)) {
        throw new Error(
          `conversation_memory: invalid role '${role}' — must be one of user | assistant | system`,
        );
      }
      const contentRaw = typeof data.content === 'string' ? data.content : '';
      const content = contentRaw.includes('{{')
        ? ctx.interpolateTemplate(contentRaw, input)
        : contentRaw;
      if (!content || !content.trim()) {
        throw new Error("conversation_memory: 'content' is required for write operation");
      }
      const metadata =
        data.metadata && typeof data.metadata === 'object' && !Array.isArray(data.metadata)
          ? (data.metadata as Record<string, unknown>)
          : undefined;
      const r = await hook.write({ tenantId, memoryId, role, content, metadata });
      ctx.logger.info(
        { nodeId: node.id, memoryId, role, total: r.total },
        '[conversation_memory] wrote message',
      );
      return { ...r, operation: 'write' as const };
    }

    case 'read': {
      const limit = typeof data.limit === 'number' && data.limit > 0 ? data.limit : 10;
      const r = await hook.read({ tenantId, memoryId, limit });
      ctx.logger.info(
        { nodeId: node.id, memoryId, count: r.count },
        '[conversation_memory] read messages',
      );
      return { ...r, operation: 'read' as const };
    }

    case 'clear': {
      const r = await hook.clear({ tenantId, memoryId });
      ctx.logger.info(
        { nodeId: node.id, memoryId, removedCount: r.removedCount },
        '[conversation_memory] cleared messages',
      );
      return { ...r, operation: 'clear' as const };
    }

    case 'summarize': {
      const summarizerModel =
        typeof data.summarizerModel === 'string' && data.summarizerModel
          ? data.summarizerModel
          : 'auto'; // Smart Router default — no hardcoded model literal.
      const summaryPrompt =
        typeof data.summaryPrompt === 'string' ? data.summaryPrompt : undefined;
      const r = await hook.summarize({ tenantId, memoryId, summarizerModel, summaryPrompt });
      ctx.logger.info(
        { nodeId: node.id, memoryId, messagesSummarized: r.messagesSummarized },
        '[conversation_memory] summarized messages',
      );
      return { ...r, operation: 'summarize' as const };
    }

    case 'search': {
      if (!hook.search) {
        throw new Error(
          'conversation_memory: engine conversationMemory.search hook is not wired',
        );
      }
      const queryRaw = typeof data.query === 'string' ? data.query : '';
      const query = queryRaw.includes('{{')
        ? ctx.interpolateTemplate(queryRaw, input)
        : queryRaw;
      if (!query || !query.trim()) {
        throw new Error("conversation_memory: 'query' is required for search operation");
      }
      const limit =
        typeof data.limit === 'number' && data.limit > 0 ? Math.min(data.limit, 50) : 5;
      const r = await hook.search({ tenantId, memoryId, query: query.trim(), limit });
      ctx.logger.info(
        { nodeId: node.id, memoryId, count: r.count },
        '[conversation_memory] semantic search',
      );
      return { ...r, operation: 'search' as const };
    }
  }
}

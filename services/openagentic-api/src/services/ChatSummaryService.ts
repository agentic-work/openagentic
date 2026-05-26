/**
 * ChatSummaryService — populate chat_sessions.summary +
 * chat_sessions.structured_summary as messages accrue.
 *
 * Bug 3 (2026-05-18): the columns existed in schema but nothing in the
 * chat pipeline ever wrote them. Admin sessions view + cross-session
 * memory retrieval over old sessions had no anchor text.
 *
 * Refresh policy:
 *   - Skip while message_count < MIN_MESSAGES_FOR_SUMMARY (5).
 *   - On every assistant persistence past that floor, regenerate via
 *     CompactionEngine.generateHeuristicSummary (NO LLM call — fast,
 *     deterministic, safe to call repeatedly).
 *   - Writes both columns atomically via prisma typed client.
 *   - Non-blocking: any failure logs warn and returns; never throws
 *     into the chat write path.
 */

import type { PrismaClient } from '@prisma/client';
import { CompactionEngine } from './context/CompactionEngine.js';

interface MinimalLogger {
  info: (...args: any[]) => void;
  warn: (...args: any[]) => void;
  debug: (...args: any[]) => void;
}

const MIN_MESSAGES_FOR_SUMMARY = 5;
const MESSAGE_TAIL_FOR_SUMMARY = 50;

export class ChatSummaryService {
  private readonly engine: CompactionEngine;

  constructor(
    private readonly prisma: Pick<PrismaClient, 'chatSession' | 'chatMessage'>,
    private readonly logger: MinimalLogger,
  ) {
    this.engine = new CompactionEngine();
  }

  async maybeRefreshSummary(sessionId: string): Promise<void> {
    try {
      const session = await (this.prisma as any).chatSession.findUnique({
        where: { id: sessionId },
        select: { id: true, message_count: true, user_id: true },
      });

      if (!session) {
        this.logger.debug({ sessionId }, '[ChatSummary] session not found — skipping');
        return;
      }

      if ((session.message_count ?? 0) < MIN_MESSAGES_FOR_SUMMARY) {
        return;
      }

      const messages = await (this.prisma as any).chatMessage.findMany({
        where: { session_id: sessionId },
        orderBy: { created_at: 'asc' },
        take: MESSAGE_TAIL_FOR_SUMMARY,
      });

      if (!messages || messages.length === 0) {
        return;
      }

      const structured = this.engine.generateHeuristicSummary(messages);
      const summaryText = structured.text || '';

      if (!summaryText) {
        return;
      }

      await (this.prisma as any).chatSession.update({
        where: { id: sessionId },
        data: {
          summary: summaryText,
          structured_summary: structured as any,
        },
      });

      // #1085 sidecar — fire-and-forget upsert into the user's per-user
      // Milvus memory so memory_search can recall "the chat we had last
      // Tuesday about Azure RGs" on later sessions. Failures swallowed —
      // the chat_sessions.summary write is the SoT, memory is best-effort.
      if (session.user_id) {
        void (async () => {
          try {
            const { getMilvusMemoryService } = await import('./MilvusMemoryService.js');
            await getMilvusMemoryService(this.logger as any).upsertUserMemory(session.user_id, {
              kind: 'session_summary',
              title: `Session ${sessionId} summary`,
              content: summaryText.slice(0, 4000),
            });
          } catch (err: any) {
            this.logger.warn(
              { err: err?.message ?? String(err), sessionId, userId: session.user_id },
              '[ChatSummary] memory upsert failed — summary still persisted',
            );
          }
        })();
      }
    } catch (err: any) {
      this.logger.warn(
        { err: err?.message, sessionId },
        '[ChatSummary] refresh failed (non-blocking)',
      );
    }
  }
}

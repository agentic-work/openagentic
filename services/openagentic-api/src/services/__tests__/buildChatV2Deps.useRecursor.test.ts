/**
 * Phase E.8.g+h — buildChatV2Deps recursor-default contract.
 *
 * After E.8.g+h, sub-agent dispatch ALWAYS goes through
 * `chatLoopRecursor` via `makeRunSubagentViaRecursorPerCall` unless the
 * caller injects an explicit `runSubagent` override. The legacy in-api
 * orchestrator wiring and the `useRecursor` strangler flag are both
 * gone.
 *
 * This file used to exercise the `useRecursor` flag toggle (Phase E.8.e);
 * after the rip it locks the recursor-default contract.
 *
 * Plan: docs/superpowers/plans/2026-05-10-chatmode-rip-implementation.md §E.8.g+h
 */
import { describe, it, expect, vi } from 'vitest';
import { buildChatV2Deps } from '../buildChatV2Deps.js';
import { RECURSOR_CTX_SLOTS } from '../makeRunSubagentViaRecursor.js';
import { EventSequencer } from '../../infra/event-sequencer.js';
import type {
  ChatLoopDeps,
  StreamEvent,
} from '../../routes/chat/pipeline/chat/types.js';

function makeLogger() {
  return { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() };
}

function makeStreamProvider() {
  return async function* () {
    const events: StreamEvent[] = [
      { type: 'text_delta', text: 'recursor-path ok' },
      { type: 'message_stop', stop_reason: 'end_turn' },
    ];
    for (const e of events) yield e;
  };
}

describe('buildChatV2Deps — recursor default (Phase E.8.g+h)', () => {
  it('default runSubagent dispatches via the recursor (no in-api orchestrator)', async () => {
    const recursorGetAgents = () => [
      {
        agent_type: 'general-purpose',
        body: 'You are a helper.',
        tools: [],
      },
    ];

    const deps = buildChatV2Deps({
      providerManager: { createCompletion: vi.fn() } as any,
      recursorGetAgents,
    });

    const parentDeps: ChatLoopDeps = {
      streamProvider: makeStreamProvider() as any,
      dispatch: vi.fn(),
    };
    const parentSequencer = new EventSequencer({ runId: 'run-flag' });
    const parentCtx: any = {
      emit: vi.fn(),
      logger: makeLogger(),
      sessionId: 'session-flag',
      userId: 'user-flag',
      [RECURSOR_CTX_SLOTS.parentDeps]: parentDeps,
      [RECURSOR_CTX_SLOTS.parentSequencer]: parentSequencer,
      [RECURSOR_CTX_SLOTS.parentTurnId]: 'turn-flag',
    };

    const result = await deps.runSubagent!(
      {
        role: 'general-purpose',
        prompt: 'do thing',
        description: 'short',
      },
      parentCtx,
    );

    expect(result.ok).toBe(true);
    expect(result.output ?? '').toContain('recursor-path ok');
  });

  it('opts.runSubagent (test override) wins over the default recursor path', async () => {
    const explicit = vi.fn(async () => ({
      ok: true,
      output: 'override',
      turns: 0,
      tokens: 0,
      durationMs: 0,
      toolsUsed: [],
    }));

    const deps = buildChatV2Deps({
      providerManager: { createCompletion: vi.fn() } as any,
      recursorGetAgents: () => [],
      runSubagent: explicit,
    });

    const result = await deps.runSubagent!(
      {
        role: 'general-purpose',
        prompt: 'do thing',
        description: 'short',
      },
      undefined,
    );
    expect(result.output).toBe('override');
    expect(explicit).toHaveBeenCalledTimes(1);
  });

  it('missing per-turn RECURSOR_CTX_SLOTS returns structured "not wired" error (degrades cleanly)', async () => {
    // The chat handler hasn't stamped RECURSOR_CTX_SLOTS yet — the
    // factory must surface a structured failure rather than crash the turn.
    const deps = buildChatV2Deps({
      providerManager: { createCompletion: vi.fn() } as any,
      recursorGetAgents: () => [
        {
          agent_type: 'general-purpose',
          body: 'helper',
          tools: [],
        },
      ],
    });

    const bareCtx: any = {
      emit: vi.fn(),
      logger: makeLogger(),
      sessionId: 's',
      userId: 'u',
      // No RECURSOR_CTX_SLOTS — the chat handler hasn't been updated yet.
    };

    const result = await deps.runSubagent!(
      {
        role: 'general-purpose',
        prompt: 'do thing',
        description: 'short',
      },
      bareCtx,
    );

    expect(result.ok).toBe(false);
    expect(result.error ?? '').toMatch(/not wired/i);
    expect(result.error ?? '').toMatch(/parentDeps|parentSequencer|parentTurnId/);
  });

  it('recursorGetAgents falls back to builtInDispatch.getBuiltInAgents when not explicitly provided', async () => {
    const agents = [
      {
        agent_type: 'general-purpose',
        body: 'You are a helper.',
        tools: [],
      },
    ];

    const deps = buildChatV2Deps({
      providerManager: { createCompletion: vi.fn() } as any,
      builtInDispatch: {
        getBuiltInAgents: () => agents as any,
      },
    });

    const parentDeps: ChatLoopDeps = {
      streamProvider: makeStreamProvider() as any,
      dispatch: vi.fn(),
    };
    const parentSequencer = new EventSequencer({ runId: 'fallback-run' });
    const parentCtx: any = {
      emit: vi.fn(),
      logger: makeLogger(),
      sessionId: 'fallback-session',
      userId: 'fallback-user',
      [RECURSOR_CTX_SLOTS.parentDeps]: parentDeps,
      [RECURSOR_CTX_SLOTS.parentSequencer]: parentSequencer,
      [RECURSOR_CTX_SLOTS.parentTurnId]: 'fallback-turn',
    };

    const result = await deps.runSubagent!(
      {
        role: 'general-purpose',
        prompt: 'do thing',
        description: 'short',
      },
      parentCtx,
    );

    expect(result.ok).toBe(true);
  });
});

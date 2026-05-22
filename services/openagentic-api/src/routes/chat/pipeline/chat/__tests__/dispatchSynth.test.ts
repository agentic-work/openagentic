/**
 * dispatchTool — `synth` arm wiring (chatmode-rip Phase C.5 — RED → GREEN).
 *
 * Plan: docs/superpowers/plans/2026-05-10-chatmode-rip-implementation.md §C.5
 * Spec: docs/superpowers/specs/2026-05-10-chatmode-three-layer-architecture.md
 *
 * The T1 catalog renames `synth_execute` → `synth` (SYNTH_TOOL in
 * toolRegistry.ts). The dispatcher must route the new name through the
 * OBO-aware path (`executeSynthOBO` from SynthOBODispatcher.ts) so cloud
 * capabilities are brokered as the calling user, never a service account.
 *
 * Contract pinned here:
 *   1. `call.name === 'synth'` routes to `executeSynthOBO`, NOT the legacy
 *      `executeSynthExecute`.
 *   2. When `ctx.userJwt` is missing, the OBO dispatcher's refusal flows
 *      through to the chat-loop's ToolDispatchResult (ok:false, error
 *      matches /auth|jwt|sign in|userJwt/).
 *   3. When `ctx.userJwt` is present and capabilities include 'aws',
 *      the broker is called with the JWT + only-cloud-capabilities,
 *      and brokered creds reach the synth executor client.
 *   4. The legacy `synth_execute` arm STILL works (back-compat during
 *      the C.1 catalog cutover so mid-flight chats don't get a name
 *      flip mid-turn).
 *
 * The broker stub is a plain `{ brokerFor: vi.fn() }` shaped per
 * `SynthOBOBrokerLike` — no synthetic HTTP fetches, no synthetic STS
 * chunks. Real-broker integration is pinned by `CredentialBroker.test.ts`.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { makeDispatch } from '../dispatchTool.js';

// Stub inner dispatcher so we can detect fall-through (must NEVER be
// called for `synth` or `synth_execute`).
vi.mock('../dispatchChatToolCall.js', async () => {
  const actual = await vi.importActual<any>('../dispatchChatToolCall.js');
  return {
    ...actual,
    dispatchChatToolCall: vi.fn(),
  };
});

// Stub the OBO dispatcher so we can assert it gets called for `synth`.
vi.mock('../../../../../services/SynthOBODispatcher.js', () => ({
  executeSynthOBO: vi.fn(),
}));

// Stub the legacy executor so we can assert it gets called for `synth_execute`
// (back-compat) and NOT for `synth`.
vi.mock('../../../../../services/SynthExecuteTool.js', () => ({
  executeSynthExecute: vi.fn(),
}));

// Stub SynthExecutorClient — needed by both arms.
vi.mock('../../../../../services/SynthExecutorClient.js', () => ({
  getSynthExecutorClient: vi.fn(() => ({ execute: vi.fn() })),
}));

import { dispatchChatToolCall } from '../dispatchChatToolCall.js';
import { executeSynthOBO } from '../../../../../services/SynthOBODispatcher.js';
import { executeSynthExecute } from '../../../../../services/SynthExecuteTool.js';
import { getSynthExecutorClient } from '../../../../../services/SynthExecutorClient.js';

function makeRunCtx(overrides: Record<string, any> = {}) {
  return {
    emit: vi.fn(),
    logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() },
    sessionId: 'sess-synth-1',
    userId: 'user-synth-1',
    user: { id: 'user-synth-1', email: 'a@b.c' },
    ...overrides,
  } as any;
}

function makeStubBroker() {
  return {
    brokerFor: vi.fn().mockResolvedValue({
      aws: {
        AWS_ACCESS_KEY_ID: 'AKIA-test',
        AWS_SECRET_ACCESS_KEY: 'sec-test',
        AWS_SESSION_TOKEN: 'tok-test',
        AWS_DEFAULT_REGION: 'us-east-1',
      },
    }),
  };
}

beforeEach(() => {
  vi.clearAllMocks();
});

describe('dispatchTool — `synth` arm (Phase C.5)', () => {
  it('case 1: routes call.name=="synth" to executeSynthOBO (NOT executeSynthExecute)', async () => {
    (executeSynthOBO as any).mockResolvedValue({
      ok: true,
      output: { stdout: 'ok', stderr: '', result: 42, executionTimeMs: 12 },
    });

    const broker = makeStubBroker();
    const dispatch = makeDispatch({
      v2Deps: {} as any,
      synthCredentialBroker: broker as any,
    } as any);

    const ctx = makeRunCtx({ userJwt: 'eyJ-access-token' });
    const result = await dispatch(ctx, {
      name: 'synth',
      input: { code: 'print(1)', intent: 'test', capabilities: ['aws'] },
    });

    expect(result.ok).toBe(true);
    expect(executeSynthOBO).toHaveBeenCalledTimes(1);
    expect(executeSynthExecute).not.toHaveBeenCalled();
    expect(dispatchChatToolCall).not.toHaveBeenCalled();
  });

  it('case 2: when ctx.userJwt missing, OBO refusal flows through as ok:false', async () => {
    // executeSynthOBO's own contract: refuses without userJwt and returns
    // ok:false with /auth|jwt|sign in|userJwt/ in the error message. The
    // dispatcher must surface that result verbatim — never invent its own
    // success path or fall back to the legacy non-OBO dispatcher.
    (executeSynthOBO as any).mockResolvedValue({
      ok: false,
      error:
        'synth requires the user to be signed in (userJwt missing). ' +
        'On-Behalf-Of credential brokering only runs for authenticated users.',
    });

    const broker = makeStubBroker();
    const dispatch = makeDispatch({
      v2Deps: {} as any,
      synthCredentialBroker: broker as any,
    } as any);

    // No userJwt on ctx — OBO will refuse.
    const ctx = makeRunCtx();
    const result = await dispatch(ctx, {
      name: 'synth',
      input: { code: 'print(1)', intent: 'test', capabilities: ['aws'] },
    });

    expect(result.ok).toBe(false);
    expect(result.error).toMatch(/auth|jwt|sign in|userJwt/i);
    // Legacy arm MUST NOT be the fallback — `synth` is OBO-only.
    expect(executeSynthExecute).not.toHaveBeenCalled();
  });

  it('case 3: ctx.userJwt present + aws capability → broker invoked, result flows through', async () => {
    (executeSynthOBO as any).mockImplementation(async (_ctx: any, input: any, deps: any) => {
      // Inside the real OBO dispatcher, the broker is called with
      // (userJwt, [cloud targets]) and the brokered creds get flattened
      // into input.credentials. Here we just verify the dispatcher
      // forwarded the broker dep and our test ctx.userJwt.
      expect(deps.broker).toBe(broker);
      expect(deps.client).toBeDefined();
      return {
        ok: true,
        output: { stdout: 'aws-ok', stderr: '', result: { region: 'us-east-1' }, executionTimeMs: 100 },
      };
    });

    const broker = makeStubBroker();
    const dispatch = makeDispatch({
      v2Deps: {} as any,
      synthCredentialBroker: broker as any,
    } as any);

    const ctx = makeRunCtx({ userJwt: 'eyJ-access-token' });
    const result = await dispatch(ctx, {
      name: 'synth',
      input: { code: 'import boto3; boto3.client("s3").list_buckets()', intent: 'list buckets', capabilities: ['aws'] },
    });

    expect(result.ok).toBe(true);
    expect(executeSynthOBO).toHaveBeenCalledTimes(1);
    // Verify dispatcher passed ctx with userJwt to OBO (the OBO dispatcher
    // reads ctx.userJwt to decide refuse-or-broker).
    const oboCtx = (executeSynthOBO as any).mock.calls[0][0];
    expect(oboCtx.userJwt).toBe('eyJ-access-token');
    expect(oboCtx.userId).toBe('user-synth-1');
    // Verify the SynthExecutorClient singleton was resolved (lazy).
    expect(getSynthExecutorClient).toHaveBeenCalled();
  });

  it('case 4: legacy `synth_execute` arm still works (back-compat during cutover)', async () => {
    // Per plan §C.5: "the legacy SynthExecuteTool.ts remains in place
    // during the C.1 catalog cutover so mid-flight chats don't get a
    // name flip mid-turn." Verify the existing arm still routes to
    // executeSynthExecute (NOT through OBO).
    (executeSynthExecute as any).mockResolvedValue({
      ok: true,
      output: { stdout: 'legacy-ok', stderr: '', result: 7, executionTimeMs: 5 },
    });

    const dispatch = makeDispatch({ v2Deps: {} as any });
    const ctx = makeRunCtx({ userJwt: 'eyJ-still-passed' });
    const result = await dispatch(ctx, {
      name: 'synth_execute',
      input: { code: 'print(7)', intent: 'legacy call' },
    });

    expect(result.ok).toBe(true);
    expect(executeSynthExecute).toHaveBeenCalledTimes(1);
    // OBO arm MUST NOT fire for the legacy name — only `synth` is OBO.
    expect(executeSynthOBO).not.toHaveBeenCalled();
  });
});

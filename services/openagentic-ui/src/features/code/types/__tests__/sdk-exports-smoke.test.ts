/**
 * Phase A smoke test — verifies @agentic-work/openagentic and
 * @agentic-work/llm-sdk export the subpaths the codemode UI needs.
 *
 * Plan: docs/plans/CODEMODE-PERMANENT-PLAN.md §4 Phase A. Phase G replaces
 * the openagentic `file:` dep with a thin published `@agentic-work/openagentic-sdk`
 * package; this smoke remains as the SDK boundary contract.
 */

import { describe, it, expect, expectTypeOf } from 'vitest';
import type { SDKMessage } from '@agentic-work/openagentic-sdk/types';
import type { SDKControlRequest } from '@agentic-work/openagentic-sdk/control';
import type { Options } from '@agentic-work/openagentic-sdk/runtime';
import { SDKMessageSchema } from '@agentic-work/openagentic-sdk/schemas';
import { SDKControlRequestInnerSchema } from '@agentic-work/openagentic-sdk/control-schemas';
import type { VdomNode, DiffOp, UiOpenFrame } from '@agentic-work/openagentic-sdk/vdom';
import { buildSlashDispatchFrames, parseSlashCommand } from '@agentic-work/openagentic-sdk/frames';
import { MessageStream } from '@agentic-work/llm-sdk/lib/MessageStream';

describe('openagentic SDK exports', () => {
  it('exposes core SDK types', () => {
    const m: SDKMessage = { type: 'system', subtype: 'init' } as SDKMessage;
    expect(m.type).toBe('system');
  });

  it('exposes a working schema', () => {
    expect(typeof SDKMessageSchema).toBe('function');
  });

  it('exposes the frame builder pure function', () => {
    const frames = buildSlashDispatchFrames('hello', { msgId: 'm1' });
    expect(frames.streamEvents.length).toBeGreaterThan(0);
    expect(frames.result.type).toBe('result');
    expect(frames.result.is_error).toBe(false);
  });

  it('parses slash commands', () => {
    expect(parseSlashCommand('/help')).toEqual({ name: 'help', args: '' });
  });

  it('control schema is callable', () => {
    expect(typeof SDKControlRequestInnerSchema).toBe('function');
  });

  it('compiles vdom + control + runtime types', () => {
    expectTypeOf<SDKControlRequest>().not.toBeNever();
    expectTypeOf<Options>().not.toBeNever();
    expectTypeOf<VdomNode>().not.toBeNever();
    expectTypeOf<DiffOp>().not.toBeNever();
    expectTypeOf<UiOpenFrame>().not.toBeNever();
  });
});

describe('llm-sdk exports', () => {
  it('exposes MessageStream from llm-sdk via /lib/MessageStream', () => {
    expect(typeof MessageStream).toBe('function');
  });
});

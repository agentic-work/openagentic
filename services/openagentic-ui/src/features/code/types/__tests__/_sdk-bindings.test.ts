/**
 * Phase B contract test for `_sdk-bindings.ts`.
 *
 * Plan: docs/plans/CODEMODE-PERMANENT-PLAN.md §4 Phase B.
 *
 * `_sdk-bindings.ts` is the single bridge between the SDK packages
 * (`@agentic-work/openagentic-sdk/*` and `@agentic-work/llm-sdk`) and the
 * codemode UI. Every wire-shape type the UI needs flows through this
 * module. This test asserts that every export is reachable and that the
 * type re-exports compile (i.e., the SDK paths are resolvable and
 * non-empty).
 *
 * Future SDK churn that breaks one of these re-exports causes this test
 * to fail at type-check time, surfacing the drift early.
 */

import { describe, it, expect, expectTypeOf } from 'vitest';
import * as bindings from '../_sdk-bindings';
import type {
  // Anthropic-shape (llm-sdk)
  Message,
  ContentBlock,
  TextBlock,
  ThinkingBlock,
  ToolUseBlock,
  ToolResultBlockParam,
  RedactedThinkingBlock,
  RawMessageStreamEvent,
  RawMessageStartEvent,
  RawMessageDeltaEvent,
  RawMessageStopEvent,
  RawContentBlockStartEvent,
  RawContentBlockDeltaEvent,
  RawContentBlockStopEvent,
  RawContentBlockDelta,
  TextDelta,
  ThinkingDelta,
  SignatureDelta,
  CitationsDelta,
  InputJSONDelta,
  ToolInputDelta,
  StopReason,
  // openagentic SDK
  SDKMessage,
  SDKAssistantMessage,
  SDKUserMessage,
  SDKSystemMessage,
  SDKResultMessage,
  SDKResultSuccess,
  SDKResultError,
  SDKPartialAssistantMessage,
  SDKCompactBoundaryMessage,
  SDKToolProgressMessage,
  SDKTaskStartedMessage,
  SDKTaskProgressMessage,
  SDKTaskNotificationMessage,
  SDKAPIRetryMessage,
  SDKLocalCommandOutputMessage,
  SDKHookStartedMessage,
  SDKHookProgressMessage,
  SDKHookResponseMessage,
  SDKAuthStatusMessage,
  SDKStatusMessage,
  SDKSessionStateChangedMessage,
  SDKFilesPersistedEvent,
  SDKToolUseSummaryMessage,
  SDKRateLimitEvent,
  SDKElicitationCompleteMessage,
  SDKPromptSuggestionMessage,
  SDKSystemInitDetail,
  PermissionMode,
  PermissionUpdate,
  // Control protocol
  SDKControlRequest,
  SDKControlResponse,
  SDKControlRequestInner,
  SDKControlPermissionRequest,
  SDKControlInterruptRequest,
  StdoutMessage,
  StdinMessage,
  // Runtime types
  Options,
  // Aliases (UI compat)
  StreamJsonEvent,
  ControlRequestEvent,
  CanUseToolRequest,
  SystemInitEvent,
  StreamEventWrapper,
  ResultEvent,
  ToolProgressEvent,
  AnthropicStreamEvent,
  MessageStart,
  MessageDelta,
  MessageStop,
  ContentBlockStart,
  ContentBlockDelta,
  ContentBlockStop,
  ContentBlockDeltaPayload,
  ToolResultBlock,
  // VDOM
  VdomNode,
  DiffOp,
  DiffOpSetProp,
  DiffOpReplaceNode,
  DiffOpAppendChild,
  DiffOpRemoveChild,
  UiOpenFrame,
  UiPatchFrame,
  UiCloseFrame,
  UiEventFrame,
  UiFrame,
} from '../_sdk-bindings';

describe('_sdk-bindings type re-exports', () => {
  it('llm-sdk core message types are non-never', () => {
    expectTypeOf<Message>().not.toBeNever();
    expectTypeOf<ContentBlock>().not.toBeNever();
    expectTypeOf<TextBlock>().not.toBeNever();
    expectTypeOf<ThinkingBlock>().not.toBeNever();
    expectTypeOf<ToolUseBlock>().not.toBeNever();
    expectTypeOf<RedactedThinkingBlock>().not.toBeNever();
    expectTypeOf<ToolResultBlockParam>().not.toBeNever();
  });

  it('llm-sdk streaming event types are non-never', () => {
    expectTypeOf<RawMessageStreamEvent>().not.toBeNever();
    expectTypeOf<RawMessageStartEvent>().not.toBeNever();
    expectTypeOf<RawMessageDeltaEvent>().not.toBeNever();
    expectTypeOf<RawMessageStopEvent>().not.toBeNever();
    expectTypeOf<RawContentBlockStartEvent>().not.toBeNever();
    expectTypeOf<RawContentBlockDeltaEvent>().not.toBeNever();
    expectTypeOf<RawContentBlockStopEvent>().not.toBeNever();
    expectTypeOf<RawContentBlockDelta>().not.toBeNever();
  });

  it('llm-sdk delta types are non-never (with rename alias)', () => {
    expectTypeOf<TextDelta>().not.toBeNever();
    expectTypeOf<ThinkingDelta>().not.toBeNever();
    expectTypeOf<SignatureDelta>().not.toBeNever();
    expectTypeOf<CitationsDelta>().not.toBeNever();
    expectTypeOf<InputJSONDelta>().not.toBeNever();
    expectTypeOf<ToolInputDelta>().not.toBeNever();
    // ToolInputDelta and InputJSONDelta must be the same type (alias).
    expectTypeOf<ToolInputDelta>().toEqualTypeOf<InputJSONDelta>();
  });

  it('llm-sdk stop reason includes the SDK 6 values', () => {
    expectTypeOf<StopReason>().not.toBeNever();
    const a: StopReason = 'end_turn';
    const b: StopReason = 'tool_use';
    const c: StopReason = 'max_tokens';
    const d: StopReason = 'pause_turn';
    const e: StopReason = 'stop_sequence';
    const f: StopReason = 'refusal';
    expect([a, b, c, d, e, f]).toHaveLength(6);
  });

  it('openagentic-sdk SDKMessage variants are non-never', () => {
    expectTypeOf<SDKMessage>().not.toBeNever();
    expectTypeOf<SDKAssistantMessage>().not.toBeNever();
    expectTypeOf<SDKUserMessage>().not.toBeNever();
    expectTypeOf<SDKSystemMessage>().not.toBeNever();
    expectTypeOf<SDKResultMessage>().not.toBeNever();
    expectTypeOf<SDKResultSuccess>().not.toBeNever();
    expectTypeOf<SDKResultError>().not.toBeNever();
    expectTypeOf<SDKPartialAssistantMessage>().not.toBeNever();
    expectTypeOf<SDKCompactBoundaryMessage>().not.toBeNever();
    expectTypeOf<SDKToolProgressMessage>().not.toBeNever();
    expectTypeOf<SDKTaskStartedMessage>().not.toBeNever();
    expectTypeOf<SDKTaskProgressMessage>().not.toBeNever();
    expectTypeOf<SDKTaskNotificationMessage>().not.toBeNever();
    expectTypeOf<SDKAPIRetryMessage>().not.toBeNever();
    expectTypeOf<SDKLocalCommandOutputMessage>().not.toBeNever();
    expectTypeOf<SDKHookStartedMessage>().not.toBeNever();
    expectTypeOf<SDKHookProgressMessage>().not.toBeNever();
    expectTypeOf<SDKHookResponseMessage>().not.toBeNever();
    expectTypeOf<SDKAuthStatusMessage>().not.toBeNever();
    expectTypeOf<SDKStatusMessage>().not.toBeNever();
    expectTypeOf<SDKSessionStateChangedMessage>().not.toBeNever();
    expectTypeOf<SDKFilesPersistedEvent>().not.toBeNever();
    expectTypeOf<SDKToolUseSummaryMessage>().not.toBeNever();
    expectTypeOf<SDKRateLimitEvent>().not.toBeNever();
    expectTypeOf<SDKElicitationCompleteMessage>().not.toBeNever();
    expectTypeOf<SDKPromptSuggestionMessage>().not.toBeNever();
    expectTypeOf<SDKSystemInitDetail>().not.toBeNever();
    expectTypeOf<PermissionMode>().not.toBeNever();
    expectTypeOf<PermissionUpdate>().not.toBeNever();
  });

  it('openagentic-sdk control types are non-never', () => {
    expectTypeOf<SDKControlRequest>().not.toBeNever();
    expectTypeOf<SDKControlResponse>().not.toBeNever();
    expectTypeOf<SDKControlRequestInner>().not.toBeNever();
    expectTypeOf<SDKControlPermissionRequest>().not.toBeNever();
    expectTypeOf<SDKControlInterruptRequest>().not.toBeNever();
    expectTypeOf<StdoutMessage>().not.toBeNever();
    expectTypeOf<StdinMessage>().not.toBeNever();
  });

  it('openagentic-sdk runtime Options is non-never', () => {
    expectTypeOf<Options>().not.toBeNever();
  });

  it('UI compat aliases are non-never', () => {
    expectTypeOf<StreamJsonEvent>().not.toBeNever();
    expectTypeOf<ControlRequestEvent>().not.toBeNever();
    expectTypeOf<CanUseToolRequest>().not.toBeNever();
    expectTypeOf<SystemInitEvent>().not.toBeNever();
    expectTypeOf<StreamEventWrapper>().not.toBeNever();
    expectTypeOf<ResultEvent>().not.toBeNever();
    expectTypeOf<ToolProgressEvent>().not.toBeNever();
    expectTypeOf<AnthropicStreamEvent>().not.toBeNever();
    expectTypeOf<MessageStart>().not.toBeNever();
    expectTypeOf<MessageDelta>().not.toBeNever();
    expectTypeOf<MessageStop>().not.toBeNever();
    expectTypeOf<ContentBlockStart>().not.toBeNever();
    expectTypeOf<ContentBlockDelta>().not.toBeNever();
    expectTypeOf<ContentBlockStop>().not.toBeNever();
    expectTypeOf<ContentBlockDeltaPayload>().not.toBeNever();
    expectTypeOf<ToolResultBlock>().not.toBeNever();
  });

  it('SystemInitEvent retains the platform-specific budget_cap_usd field', () => {
    const init: SystemInitEvent = {
      type: 'system',
      subtype: 'init',
      apiKeySource: 'user',
      openagentic_version: '0.6.3',
      cwd: '/tmp',
      tools: [],
      mcp_servers: [],
      model: 'claude-opus-4-5',
      permissionMode: 'default',
      slash_commands: [],
      output_style: 'default',
      skills: [],
      plugins: [],
      uuid: 'u',
      session_id: 's',
      budget_cap_usd: 5.0,
    };
    expect(init.budget_cap_usd).toBe(5.0);
  });

  it('VDOM types are non-never', () => {
    expectTypeOf<VdomNode>().not.toBeNever();
    expectTypeOf<DiffOp>().not.toBeNever();
    expectTypeOf<DiffOpSetProp>().not.toBeNever();
    expectTypeOf<DiffOpReplaceNode>().not.toBeNever();
    expectTypeOf<DiffOpAppendChild>().not.toBeNever();
    expectTypeOf<DiffOpRemoveChild>().not.toBeNever();
    expectTypeOf<UiOpenFrame>().not.toBeNever();
    expectTypeOf<UiPatchFrame>().not.toBeNever();
    expectTypeOf<UiCloseFrame>().not.toBeNever();
    expectTypeOf<UiEventFrame>().not.toBeNever();
    expectTypeOf<UiFrame>().not.toBeNever();
  });
});

describe('_sdk-bindings runtime re-exports', () => {
  it('exposes runtime guards from the openagentic/vdom SDK subpath', () => {
    expect(typeof bindings.isUiOpenFrame).toBe('function');
    expect(typeof bindings.isUiPatchFrame).toBe('function');
    expect(typeof bindings.isUiCloseFrame).toBe('function');
    expect(typeof bindings.isUiEventFrame).toBe('function');
    expect(typeof bindings.serializeUiFrame).toBe('function');
    expect(typeof bindings.parseUiFrame).toBe('function');
  });

  it('exposes SDKMessageSchema and SDKControlRequestInnerSchema (zod)', () => {
    expect(typeof bindings.SDKMessageSchema).toBe('function');
    expect(typeof bindings.SDKControlRequestInnerSchema).toBe('function');
  });

  it('exposes MessageStream from llm-sdk', () => {
    expect(typeof bindings.MessageStream).toBe('function');
  });

  it('runtime guards correctly identify a synthetic frame', () => {
    const open: UiOpenFrame = {
      type: 'ui_open',
      viewId: 'v1',
      command: '/help',
      vdom: { id: 'root', type: 'box', props: {}, children: [] },
    };
    expect(bindings.isUiOpenFrame(open)).toBe(true);
    expect(bindings.isUiPatchFrame(open)).toBe(false);

    const patch: UiPatchFrame = {
      type: 'ui_patch',
      viewId: 'v1',
      ops: [],
    };
    expect(bindings.isUiPatchFrame(patch)).toBe(true);

    const close: UiCloseFrame = { type: 'ui_close', viewId: 'v1' };
    expect(bindings.isUiCloseFrame(close)).toBe(true);

    const event: UiEventFrame = {
      type: 'ui_event',
      viewId: 'v1',
      nodeId: 'n1',
      kind: 'click',
      payload: {},
    };
    expect(bindings.isUiEventFrame(event)).toBe(true);
  });

  it('parseUiFrame round-trips a serialized frame', () => {
    const frame: UiOpenFrame = {
      type: 'ui_open',
      viewId: 'v1',
      command: '/help',
      vdom: { id: 'root', type: 'box', props: {}, children: [] },
    };
    const wire = bindings.serializeUiFrame(frame);
    const parsed = bindings.parseUiFrame(wire);
    expect(parsed).not.toBeNull();
    expect(parsed?.type).toBe('ui_open');
  });
});

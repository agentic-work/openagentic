/**
 * AnthropicStreamEvent.alias.test (UI mirror) — Phase A guard for the
 * model-stream re-export migration. See:
 * `docs/superpowers/plans/2026-05-01-sdk-stream-event-migration.md`.
 */

import { describe, test, expectTypeOf } from 'vitest';
import {
  type AnthropicMessageStartEvent,
  type AnthropicContentBlockStartEvent,
  type AnthropicContentBlockDeltaEvent,
  type AnthropicContentBlockStopEvent,
  type AnthropicMessageDeltaEvent,
  type AnthropicMessageStopEvent,
  type AnthropicPingEvent,
  type AnthropicErrorEvent,
  type AnthropicStreamEvent,
} from '../AnthropicStreamEvent';
import {
  type MessageStartEvent,
  type ContentBlockStartEvent,
  type ContentBlockDeltaEvent,
  type ContentBlockStopEvent,
  type MessageDeltaEvent,
  type MessageStopEvent,
  type ModelPingEvent,
  type ModelErrorEvent,
  type ModelStreamEvent,
} from '../agentic-events';

describe('Phase A — UI legacy Anthropic* model-stream events ≡ SDK shape', () => {
  test('AnthropicMessageStartEvent ≡ MessageStartEvent', () => {
    expectTypeOf<AnthropicMessageStartEvent>().toEqualTypeOf<MessageStartEvent>();
  });

  test('AnthropicContentBlockStartEvent ≡ ContentBlockStartEvent', () => {
    expectTypeOf<AnthropicContentBlockStartEvent>().toEqualTypeOf<ContentBlockStartEvent>();
  });

  test('AnthropicContentBlockDeltaEvent ≡ ContentBlockDeltaEvent', () => {
    expectTypeOf<AnthropicContentBlockDeltaEvent>().toEqualTypeOf<ContentBlockDeltaEvent>();
  });

  test('AnthropicContentBlockStopEvent ≡ ContentBlockStopEvent', () => {
    expectTypeOf<AnthropicContentBlockStopEvent>().toEqualTypeOf<ContentBlockStopEvent>();
  });

  test('AnthropicMessageDeltaEvent ≡ MessageDeltaEvent', () => {
    expectTypeOf<AnthropicMessageDeltaEvent>().toEqualTypeOf<MessageDeltaEvent>();
  });

  test('AnthropicMessageStopEvent ≡ MessageStopEvent', () => {
    expectTypeOf<AnthropicMessageStopEvent>().toEqualTypeOf<MessageStopEvent>();
  });

  test('AnthropicPingEvent ≡ ModelPingEvent', () => {
    expectTypeOf<AnthropicPingEvent>().toEqualTypeOf<ModelPingEvent>();
  });

  test('AnthropicErrorEvent ≡ ModelErrorEvent', () => {
    expectTypeOf<AnthropicErrorEvent>().toEqualTypeOf<ModelErrorEvent>();
  });

  test('AnthropicStreamEvent union ≡ ModelStreamEvent union', () => {
    expectTypeOf<AnthropicStreamEvent>().toEqualTypeOf<ModelStreamEvent>();
  });
});

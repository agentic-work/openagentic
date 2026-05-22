/**
 * AnthropicStreamEvent.alias.test — Phase A guard for the model-stream
 * re-export migration (`docs/superpowers/plans/2026-05-01-sdk-stream-event-migration.md`).
 *
 * The legacy `Anthropic*` model-stream events MUST be structurally
 * assignable to the SDK `agentic-events` types. After Phase A re-writes
 * the legacy file as re-exports, this test guards against shape drift
 * — if the SDK SoT changes a field, this test breaks immediately.
 *
 * Type-only assertions: we construct values typed as legacy aliases and
 * assign them to SDK types (and vice-versa). If the shapes diverge, the
 * compiler catches it at vitest TS-load time.
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
} from '../services/AnthropicStreamEvent.js';
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
} from '../services/agentic-events/index.js';

describe('Phase A — legacy Anthropic* model-stream events ≡ SDK shape', () => {
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

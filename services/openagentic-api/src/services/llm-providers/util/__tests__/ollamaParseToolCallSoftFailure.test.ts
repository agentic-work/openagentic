/**
 * isOllamaParseToolCallError — unit tests (#851, 2026-05-14).
 *
 * Live failure mode: gpt-oss:20b sometimes emits Harmony-channel
 * reasoning prose as `tool_calls[0].function.arguments` (a string, not
 * a JSON object). Ollama's own tool_call parser bails on the prose
 * and returns HTTP 500 with body:
 *
 *   {"error":"error parsing tool call: raw='We attempted wrong
 *    subscription id. We only have two subs...'"}
 *
 * Without recovery, OllamaProvider throws and chatLoop crashes with
 * PIPELINE_ERROR. The user sees a useless red banner instead of any
 * model output for the turn.
 *
 * Fix: detect this specific signature and let OllamaProvider yield
 * a soft turn-end (text content_block + message_stop with
 * stop_reason='end_turn') instead of throwing — chatLoop continues
 * cleanly, the user sees a real recovery message, and the no-progress
 * guard at #763 catches repeats on subsequent turns.
 */

import { describe, it, expect } from 'vitest';
import { isOllamaParseToolCallError } from '../ollamaParseToolCallSoftFailure.js';

describe('isOllamaParseToolCallError — #851 detection', () => {
  describe('returns true (recoverable) when', () => {
    it('matches the exact live capture from 2026-05-14 Q1', () => {
      const errorText =
        `{"error":"error parsing tool call: raw='We attempted wrong subscription id. ` +
        `We only have two subs. We need list resource groups per subscription. ` +
        `Use azure_list_resource_groups? Not defined. There is azure_list_nsgs, ` +
        `vms, aks, storage accounts...'"}`;
      expect(isOllamaParseToolCallError(500, errorText)).toBe(true);
    });

    it('matches a short error parsing tool call message', () => {
      expect(
        isOllamaParseToolCallError(
          500,
          '{"error":"error parsing tool call: bad json"}',
        ),
      ).toBe(true);
    });

    it('matches the bare error string (not wrapped in JSON)', () => {
      expect(
        isOllamaParseToolCallError(500, 'error parsing tool call: foo'),
      ).toBe(true);
    });

    it('is case-insensitive on the phrase', () => {
      expect(
        isOllamaParseToolCallError(500, 'Error Parsing Tool Call: foo'),
      ).toBe(true);
    });
  });

  describe('returns false (non-recoverable, must still throw) when', () => {
    it('status is not 500', () => {
      expect(
        isOllamaParseToolCallError(
          429,
          '{"error":"error parsing tool call: foo"}',
        ),
      ).toBe(false);
      expect(
        isOllamaParseToolCallError(
          400,
          '{"error":"error parsing tool call: foo"}',
        ),
      ).toBe(false);
    });

    it('errorText does not mention parsing tool calls (generic 500)', () => {
      expect(
        isOllamaParseToolCallError(500, '{"error":"runtime error: cuda OOM"}'),
      ).toBe(false);
      expect(
        isOllamaParseToolCallError(500, 'Internal Server Error'),
      ).toBe(false);
      expect(isOllamaParseToolCallError(500, '')).toBe(false);
    });

    it('errorText is null or undefined', () => {
      expect(isOllamaParseToolCallError(500, null as any)).toBe(false);
      expect(isOllamaParseToolCallError(500, undefined as any)).toBe(false);
    });

    it('mentions tool calls but not the parse-failure phrase', () => {
      // A plain "tool_calls invalid" error is a different bug — keep throwing.
      expect(
        isOllamaParseToolCallError(500, '{"error":"tool_calls invalid format"}'),
      ).toBe(false);
    });
  });
});

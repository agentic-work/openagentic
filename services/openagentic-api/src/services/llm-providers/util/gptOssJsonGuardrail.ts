/**
 * gptOssJsonGuardrail — #869 preventive (2026-05-15).
 *
 * Live failure mode (turn 8bb9151b on 0.7.1-3adb7527):
 *   gpt-oss:20b emitted `tool_calls[0].function.arguments` as
 *   `{"k=5","query":"azure get resource group inventory"}`. Ollama's
 *   parser rejected with `err=invalid character ',' after object key`.
 *   OllamaProvider's #851 soft-recovery then bailed.
 *
 * Pure helper: injects a strict-JSON reminder into the request messages
 * for gpt-oss + tools, before they reach Ollama. The reminder is marked
 * with a stable sentinel so re-injection is idempotent.
 *
 * Sits inline with the existing sanitize/normalize utilities. The marker
 * is part of the prose so semantic-cache layers (if any) see a stable
 * string to dedupe on.
 */

export const GPT_OSS_JSON_GUARDRAIL_MARKER = '[guardrail:gptoss-strict-json]';

const GUARDRAIL_TEXT =
  `${GPT_OSS_JSON_GUARDRAIL_MARKER} CRITICAL: tool_call arguments MUST be strict JSON. ` +
  'Use a COLON between key and value, NEVER an equals sign. Example: ' +
  '`{"k": 5, "query": "search text"}` ✓ — NOT `{"k=5", "query":"search text"}` ✗. ' +
  "Ollama's parser rejects the equals-sign shape and the turn fails.";

export interface GuardrailOptions {
  isGptOss: boolean;
  hasTools: boolean;
}

export function injectGptOssJsonGuardrail<T extends { role: string; content: string }>(
  messages: T[],
  opts: GuardrailOptions,
): T[] {
  if (!opts.isGptOss || !opts.hasTools) return messages;

  // Idempotency check — if any existing message already carries the marker, skip.
  const alreadyPresent = messages.some(
    (m) => m?.role === 'system' && typeof m?.content === 'string' && m.content.includes(GPT_OSS_JSON_GUARDRAIL_MARKER),
  );
  if (alreadyPresent) return messages;

  const reminder = { role: 'system', content: GUARDRAIL_TEXT } as unknown as T;

  // Find the last system message; insert reminder immediately after it.
  let lastSystemIdx = -1;
  for (let i = 0; i < messages.length; i++) {
    if (messages[i]?.role === 'system') {
      lastSystemIdx = i;
    } else {
      // System messages must come at the start — once we hit a non-system, stop.
      break;
    }
  }

  if (lastSystemIdx === -1) {
    // No system messages — prepend.
    return [reminder, ...messages];
  }

  return [
    ...messages.slice(0, lastSystemIdx + 1),
    reminder,
    ...messages.slice(lastSystemIdx + 1),
  ];
}

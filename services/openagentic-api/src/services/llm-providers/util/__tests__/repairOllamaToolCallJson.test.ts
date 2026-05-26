/**
 * repairOllamaToolCallJson — #869 (2026-05-15).
 *
 * Live failure mode (turn 8bb9151b on 0.7.1-3adb7527):
 *   gpt-oss:20b emitted `tool_calls[0].function.arguments` as
 *   `{"k=5","query":"azure get resource group inventory"}`.
 *   `k=5` is `key=value` style, not valid JSON. Ollama's parser
 *   rejects with `err=invalid character ',' after object key`.
 *
 * This utility parses Ollama's errorText, extracts the `raw='...'`
 * fragment, applies a small set of forgiving repairs, and returns
 * { repaired, parsed } if the repair makes the fragment valid JSON.
 * Returns null if extraction or repair fails.
 *
 * Used by OllamaProvider's #851 catch as diagnostic telemetry
 * (logs the repairable shape so we can verify the fix path before
 * wiring full retry-and-re-emit in a follow-up).
 */
import { describe, it, expect } from 'vitest';
import { repairOllamaToolCallJson } from '../repairOllamaToolCallJson.js';

describe('repairOllamaToolCallJson — #869 detection + repair', () => {
  it('repairs the exact live-drive shape: {"k=5","query":"..."}', () => {
    const errText =
      `error parsing tool call: raw='{"k=5","query":"azure get resource group inventory"}', err=invalid character ',' after object key`;
    const out = repairOllamaToolCallJson(errText);
    expect(out).not.toBeNull();
    expect(out?.parsed).toEqual({ k: 5, query: 'azure get resource group inventory' });
  });

  it('repairs single key=value with numeric: {"k=5"} → {"k":5}', () => {
    const errText = `error parsing tool call: raw='{"k=5"}', err=...`;
    const out = repairOllamaToolCallJson(errText);
    expect(out?.parsed).toEqual({ k: 5 });
  });

  it('repairs multiple key=value pairs with mixed types', () => {
    const errText =
      `error parsing tool call: raw='{"limit=10","filter=active","name=foo"}', err=...`;
    const out = repairOllamaToolCallJson(errText);
    expect(out?.parsed).toEqual({ limit: 10, filter: 'active', name: 'foo' });
  });

  it('preserves already-valid key:value pairs alongside key=value pairs', () => {
    const errText =
      `error parsing tool call: raw='{"k=5","query":"valid string","page":2}', err=...`;
    const out = repairOllamaToolCallJson(errText);
    expect(out?.parsed).toEqual({ k: 5, query: 'valid string', page: 2 });
  });

  it('returns null when raw fragment cannot be extracted', () => {
    expect(repairOllamaToolCallJson('some unrelated error')).toBeNull();
    expect(repairOllamaToolCallJson('error parsing tool call: but no raw clause')).toBeNull();
  });

  it('returns null when the fragment is irreparable (not just key=value)', () => {
    const errText =
      `error parsing tool call: raw='this is just reasoning prose, not JSON at all', err=...`;
    expect(repairOllamaToolCallJson(errText)).toBeNull();
  });

  it('passes through fragments that are already valid JSON', () => {
    const errText =
      `error parsing tool call: raw='{"k":5,"query":"already valid"}', err=trailing data or similar`;
    const out = repairOllamaToolCallJson(errText);
    expect(out?.parsed).toEqual({ k: 5, query: 'already valid' });
  });

  it('keeps quoted string values with = inside them untouched', () => {
    // The model emitted a real string that happens to contain "=" — must NOT misinterpret.
    const errText =
      `error parsing tool call: raw='{"query":"name=value pair search"}', err=...`;
    const out = repairOllamaToolCallJson(errText);
    expect(out?.parsed).toEqual({ query: 'name=value pair search' });
  });

  it('exposes a stable shape: { raw, repaired, parsed }', () => {
    const errText =
      `error parsing tool call: raw='{"k=5","query":"x"}', err=...`;
    const out = repairOllamaToolCallJson(errText);
    expect(out).toHaveProperty('raw');
    expect(out).toHaveProperty('repaired');
    expect(out).toHaveProperty('parsed');
    expect(out?.raw).toBe('{"k=5","query":"x"}');
    expect(out?.repaired).toBe('{"k":5,"query":"x"}');
    expect(out?.parsed).toEqual({ k: 5, query: 'x' });
  });
});

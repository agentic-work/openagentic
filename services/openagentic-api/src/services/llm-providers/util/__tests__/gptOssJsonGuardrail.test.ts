/**
 * gptOssJsonGuardrail — #869 preventive guardrail (2026-05-15).
 *
 * gpt-oss:20b occasionally emits `tool_call.arguments` as
 * `{"k=5","query":"..."}` (key=value JSON malformation). Ollama's parser
 * rejects with 500. The OllamaProvider #851 soft-recovery then bails.
 *
 * This pure helper injects a small strict-JSON reminder into the request
 * messages BEFORE they go to Ollama, preventing the failure mode upstream.
 *
 * Contract:
 *   - Only modifies messages array for gpt-oss models with tools attached.
 *   - Adds exactly ONE system message at the END of the existing system
 *     section (or prepends if no system messages exist).
 *   - Idempotent — running twice does not duplicate the reminder.
 *   - Pure — does not mutate input arrays.
 */
import { describe, it, expect } from 'vitest';
import { injectGptOssJsonGuardrail, GPT_OSS_JSON_GUARDRAIL_MARKER } from '../gptOssJsonGuardrail.js';

describe('injectGptOssJsonGuardrail — #869 preventive', () => {
  it('does NOT inject when isGptOss=false (other models)', () => {
    const messages = [{ role: 'system', content: 'be helpful' }, { role: 'user', content: 'hi' }];
    const out = injectGptOssJsonGuardrail(messages, { isGptOss: false, hasTools: true });
    expect(out).toEqual(messages);
  });

  it('does NOT inject when hasTools=false (no tool_call to malform)', () => {
    const messages = [{ role: 'system', content: 'be helpful' }, { role: 'user', content: 'hi' }];
    const out = injectGptOssJsonGuardrail(messages, { isGptOss: true, hasTools: false });
    expect(out).toEqual(messages);
  });

  it('injects a system message for gpt-oss + tools', () => {
    const messages = [{ role: 'system', content: 'be helpful' }, { role: 'user', content: 'hi' }];
    const out = injectGptOssJsonGuardrail(messages, { isGptOss: true, hasTools: true });
    expect(out.length).toBe(3);
    // Reminder should sit at position 1 (right after existing system) — or position 0 if no system
    const reminder = out.find(m => m.role === 'system' && m.content.includes(GPT_OSS_JSON_GUARDRAIL_MARKER));
    expect(reminder).toBeDefined();
    expect(reminder?.content).toContain('strict JSON');
  });

  it('mentions the exact failure shape so the model learns from it', () => {
    const out = injectGptOssJsonGuardrail([{ role: 'user', content: 'x' }], { isGptOss: true, hasTools: true });
    const reminder = out.find(m => m.role === 'system' && m.content.includes(GPT_OSS_JSON_GUARDRAIL_MARKER));
    expect(reminder?.content).toMatch(/key.*value|"k":/i);
    expect(reminder?.content).toMatch(/colon/i);
  });

  it('is idempotent — re-injecting does not duplicate', () => {
    const messages = [{ role: 'system', content: 'be helpful' }, { role: 'user', content: 'hi' }];
    const once = injectGptOssJsonGuardrail(messages, { isGptOss: true, hasTools: true });
    const twice = injectGptOssJsonGuardrail(once, { isGptOss: true, hasTools: true });
    const reminderCount = twice.filter(m => m.role === 'system' && m.content?.includes(GPT_OSS_JSON_GUARDRAIL_MARKER)).length;
    expect(reminderCount).toBe(1);
    expect(twice.length).toBe(once.length);
  });

  it('does NOT mutate the input messages array', () => {
    const messages = [{ role: 'system', content: 'be helpful' }, { role: 'user', content: 'hi' }];
    const original = JSON.stringify(messages);
    injectGptOssJsonGuardrail(messages, { isGptOss: true, hasTools: true });
    expect(JSON.stringify(messages)).toBe(original);
  });

  it('handles no-system-messages case — prepends reminder', () => {
    const messages = [{ role: 'user', content: 'hi' }];
    const out = injectGptOssJsonGuardrail(messages, { isGptOss: true, hasTools: true });
    expect(out[0].role).toBe('system');
    expect(out[0].content).toContain(GPT_OSS_JSON_GUARDRAIL_MARKER);
    expect(out[1]).toEqual(messages[0]);
  });
});

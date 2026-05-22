/**
 * #812 Sev-0 — Native Ollama `/api/chat` expects `tool_calls[].function.arguments`
 * as an OBJECT, not a JSON-string.
 *
 * The #806 outbound sanitizer was stringifying object args via JSON.stringify,
 * which broke the wire shape. On turn-2 after any tool call, Ollama responds
 * with HTTP 400:
 *
 *   {"error":"Value looks like object, but can't find closing '}' symbol"}
 *
 * because its parser sees a quoted JSON string where it expects an object.
 *
 * Contract pinned here:
 *  1. Object arguments stay as objects (the new sanitizer must not stringify)
 *  2. String arguments that parse as objects are HYDRATED back to objects
 *  3. String arguments that fail to parse become `{}` (object) — not `'{}'` string
 *  4. null/undefined/non-object args become `{}` (object)
 *  5. Function-call name+id preserved through sanitization
 */
import { describe, it, expect } from 'vitest'
import { sanitizeOutboundToolCallArgs } from '../OllamaProvider.js'

describe('#812 sanitizeOutboundToolCallArgs — Native Ollama wants objects', () => {
  it('leaves a valid object as an object (no stringify)', () => {
    const messages = [
      { role: 'assistant', tool_calls: [{ id: 'a1', function: { name: 'tool_search', arguments: { k: 5, query: 'azure list subscriptions' } } }] },
    ]
    sanitizeOutboundToolCallArgs(messages)
    expect(typeof messages[0].tool_calls[0].function.arguments).toBe('object')
    expect(messages[0].tool_calls[0].function.arguments).toEqual({ k: 5, query: 'azure list subscriptions' })
  })

  it('hydrates a valid JSON-string back to an object', () => {
    const messages = [
      { role: 'assistant', tool_calls: [{ id: 'a2', function: { name: 'tool_search', arguments: '{"k":5,"query":"azure list subscriptions"}' } }] },
    ]
    sanitizeOutboundToolCallArgs(messages)
    expect(typeof messages[0].tool_calls[0].function.arguments).toBe('object')
    expect(messages[0].tool_calls[0].function.arguments).toEqual({ k: 5, query: 'azure list subscriptions' })
  })

  it('replaces a malformed JSON-string with an empty OBJECT (not string)', () => {
    const messages = [
      { role: 'assistant', tool_calls: [{ id: 'a3', function: { name: 'tool_search', arguments: '{"k":5,"query":"oh n' } }] },
    ]
    sanitizeOutboundToolCallArgs(messages)
    expect(typeof messages[0].tool_calls[0].function.arguments).toBe('object')
    expect(messages[0].tool_calls[0].function.arguments).toEqual({})
  })

  it('replaces null/undefined args with an empty OBJECT (not string)', () => {
    const messages = [
      { role: 'assistant', tool_calls: [{ id: 'a4', function: { name: 'noop', arguments: null } }] },
      { role: 'assistant', tool_calls: [{ id: 'a5', function: { name: 'noop', arguments: undefined } }] },
    ]
    sanitizeOutboundToolCallArgs(messages)
    expect(typeof messages[0].tool_calls[0].function.arguments).toBe('object')
    expect(typeof messages[1].tool_calls[0].function.arguments).toBe('object')
    expect(messages[0].tool_calls[0].function.arguments).toEqual({})
    expect(messages[1].tool_calls[0].function.arguments).toEqual({})
  })

  it('preserves name + id when sanitizing', () => {
    const messages = [
      { role: 'assistant', tool_calls: [{ id: 'call_abc123', function: { name: 'azure_list_subscriptions', arguments: { tenant_id: 't1' } } }] },
    ]
    sanitizeOutboundToolCallArgs(messages)
    expect(messages[0].tool_calls[0].id).toBe('call_abc123')
    expect(messages[0].tool_calls[0].function.name).toBe('azure_list_subscriptions')
    expect(messages[0].tool_calls[0].function.arguments).toEqual({ tenant_id: 't1' })
  })

  it('is a no-op for messages without tool_calls', () => {
    const messages = [
      { role: 'user', content: 'hello' } as any,
      { role: 'tool', content: '{"result": true}' } as any,
      { role: 'assistant', content: 'just text', tool_calls: [] } as any,
    ]
    sanitizeOutboundToolCallArgs(messages)
    // No tool_calls field on user; tool_calls.length=0 on assistant — both unchanged.
    expect((messages[0] as any).tool_calls).toBeUndefined()
    expect((messages[2] as any).tool_calls).toEqual([])
  })
})

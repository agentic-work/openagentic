/**
 * Sev-1 — tests for the no-confab tool-failure reporting util.
 *
 * The live bug that motivated this module: chat showed three "Succeeded"
 * synth cards with fabricated JSON for an operation that never ran. The
 * unit tests below lock in the exact wire contract the LLM must see so
 * the regression can't reappear silently.
 */

import { describe, it, expect } from 'vitest';
import {
  isEmptyToolResult,
  formatToolFailureForLLM,
  formatToolResultForLLM,
} from '../services/ToolFailureReporting';

describe('isEmptyToolResult', () => {
  it('treats null / undefined as empty', () => {
    expect(isEmptyToolResult(null)).toBe(true);
    expect(isEmptyToolResult(undefined)).toBe(true);
  });

  it('treats whitespace-only strings as empty', () => {
    expect(isEmptyToolResult('')).toBe(true);
    expect(isEmptyToolResult('   ')).toBe(true);
    expect(isEmptyToolResult('\n\t  \n')).toBe(true);
  });

  it('treats empty array / empty object as empty', () => {
    expect(isEmptyToolResult([])).toBe(true);
    expect(isEmptyToolResult({})).toBe(true);
  });

  it('does NOT treat 0 / false as empty (legit values)', () => {
    expect(isEmptyToolResult(0)).toBe(false);
    expect(isEmptyToolResult(false)).toBe(false);
  });

  it('does NOT treat populated values as empty', () => {
    expect(isEmptyToolResult('ok')).toBe(false);
    expect(isEmptyToolResult([1])).toBe(false);
    expect(isEmptyToolResult({ a: 1 })).toBe(false);
    expect(isEmptyToolResult({ a: null })).toBe(false); // object has a key, non-empty
  });
});

describe('formatToolFailureForLLM', () => {
  it('produces the training-distribution <tool_error> wrapper', () => {
    const out = formatToolFailureForLLM({
      toolName: 'azure_activity_log_query',
      code: 'NO_RESULT',
      reason: 'Tool returned empty body',
    });
    expect(out).toContain('<tool_error code="NO_RESULT" tool="azure_activity_log_query">');
    expect(out).toContain('<reason>Tool returned empty body</reason>');
    expect(out).toContain('<directive>The tool did not succeed. DO NOT fabricate a result.');
    expect(out).toContain('</tool_error>');
  });

  it('inlines <context> JSON when provided', () => {
    const out = formatToolFailureForLLM({
      toolName: 't',
      code: 'EXECUTION_FAILED',
      reason: 'r',
      context: { status: 504, attempts: 2 },
    });
    expect(out).toContain('<context>{"status":504,"attempts":2}</context>');
  });

  it('omits the <context> line when no context given', () => {
    const out = formatToolFailureForLLM({ toolName: 't', code: 'TIMEOUT', reason: 'r' });
    expect(out).not.toContain('<context>');
  });

  it('carries an anti-confabulation directive verbatim (trained-to-respect string)', () => {
    // This exact phrasing is what the LLM trigger is designed around; if a
    // future edit drops "DO NOT fabricate" the confabulation regression
    // returns immediately.
    const out = formatToolFailureForLLM({ toolName: 't', code: 'NO_RESULT', reason: 'r' });
    expect(out).toMatch(/DO NOT fabricate a result/);
    expect(out).toMatch(/Acknowledge the failure to the user/);
    expect(out).toMatch(/suggest a concrete next step/);
  });
});

describe('formatToolResultForLLM', () => {
  it('passes a non-empty string through untouched and marks success', () => {
    const out = formatToolResultForLLM('t', 'hello world');
    expect(out.content).toBe('hello world');
    expect(out.isFailure).toBe(false);
  });

  it('JSON-stringifies non-string non-empty results', () => {
    const out = formatToolResultForLLM('t', { a: 1, b: 'x' });
    expect(out.content).toContain('"a": 1');
    expect(out.content).toContain('"b": "x"');
    expect(out.isFailure).toBe(false);
  });

  it('returns the <tool_error> block for null result (NO_RESULT code)', () => {
    const out = formatToolResultForLLM('azure_activity_log_query', null);
    expect(out.isFailure).toBe(true);
    expect(out.content).toContain('<tool_error code="NO_RESULT"');
    expect(out.content).toContain('tool="azure_activity_log_query"');
  });

  it('returns the <tool_error> block for empty array / empty object', () => {
    expect(formatToolResultForLLM('t', []).isFailure).toBe(true);
    expect(formatToolResultForLLM('t', {}).isFailure).toBe(true);
  });

  it('allows caller to customise failureCode + failureReason', () => {
    const out = formatToolResultForLLM('synth_execute', null, {
      failureCode: 'NO_RESULT_AFTER_APPROVAL',
      failureReason: 'Synth approved but sandbox returned empty body',
    });
    expect(out.content).toContain('code="NO_RESULT_AFTER_APPROVAL"');
    expect(out.content).toContain('Synth approved but sandbox returned empty body');
  });

  it('safely handles circular-reference results (cannot confabulate via partial JSON)', () => {
    const cyclic: any = { a: 1 };
    cyclic.self = cyclic;
    const out = formatToolResultForLLM('t', cyclic);
    expect(out.isFailure).toBe(true);
    expect(out.content).toContain('could not be serialized');
  });

  it('does NOT report 0 or false as failure (real values round-trip)', () => {
    expect(formatToolResultForLLM('t', 0).isFailure).toBe(false);
    expect(formatToolResultForLLM('t', false).isFailure).toBe(false);
    expect(formatToolResultForLLM('t', 0).content).toBe('0');
    expect(formatToolResultForLLM('t', false).content).toBe('false');
  });
});

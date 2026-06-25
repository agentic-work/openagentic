/**
 * AgentContract — typed input/output/toolFlow contracts for registered
 * agents (Pillar 3).
 *
 * Each registered agent in prisma.agent declares:
 *   input:        JSON-schema-ish shape the caller must send
 *   output:       JSON-schema-ish shape the agent promises to return
 *   allowedTools: list of MCP/native tools the agent is allowed to call
 *
 * Runtime validation hooks (validateAgentInput, validateAgentOutput,
 * guardToolCall) let the agent runner reject a malformed call before
 * any LLM tokens are spent, and reject a malformed return before it
 * propagates to downstream nodes. guardToolCall is the gate the
 * tool-dispatch path consults to enforce least-privilege.
 *
 * The schema dialect is intentionally thin (type / required / properties
 * / enum / items) — full JSON Schema is overkill for what agents
 * declare and we want zero-deps validation that runs in any sandbox.
 */
import { describe, it, expect } from 'vitest';
import {
  validateAgentInput,
  validateAgentOutput,
  guardToolCall,
  type AgentContract,
} from '../AgentContract';

const RESEARCHER: AgentContract = {
  input: {
    type: 'object',
    required: ['topic'],
    properties: {
      topic: { type: 'string' },
      depth: { type: 'string', enum: ['shallow', 'medium', 'deep'] },
    },
  },
  output: {
    type: 'object',
    required: ['summary', 'sources'],
    properties: {
      summary: { type: 'string' },
      sources: { type: 'array', items: { type: 'string' } },
    },
  },
  allowedTools: ['web_search', 'web_fetch'],
};

describe('AgentContract', () => {
  describe('validateAgentInput', () => {
    it('accepts a well-formed input', () => {
      const r = validateAgentInput(RESEARCHER, { topic: 'climate' });
      expect(r.ok).toBe(true);
      expect(r.errors).toEqual([]);
    });

    it('rejects missing required fields', () => {
      const r = validateAgentInput(RESEARCHER, { depth: 'shallow' });
      expect(r.ok).toBe(false);
      expect(r.errors.join(' ')).toMatch(/topic/);
    });

    it('rejects type mismatches', () => {
      const r = validateAgentInput(RESEARCHER, { topic: 42 });
      expect(r.ok).toBe(false);
      expect(r.errors.join(' ')).toMatch(/topic.*string/);
    });

    it('rejects enum violations', () => {
      const r = validateAgentInput(RESEARCHER, { topic: 'x', depth: 'extreme' });
      expect(r.ok).toBe(false);
      expect(r.errors.join(' ')).toMatch(/depth.*enum/);
    });

    it('returns ok=true when contract has no input schema (back-compat)', () => {
      const noSchema: AgentContract = { allowedTools: [] } as any;
      const r = validateAgentInput(noSchema, { anything: 'goes' });
      expect(r.ok).toBe(true);
    });
  });

  describe('validateAgentOutput', () => {
    it('accepts well-formed output', () => {
      const r = validateAgentOutput(RESEARCHER, {
        summary: 'climate change is real',
        sources: ['https://nasa.gov'],
      });
      expect(r.ok).toBe(true);
    });

    it('rejects array-element type mismatch', () => {
      const r = validateAgentOutput(RESEARCHER, {
        summary: 'x',
        sources: [123, 'http://ok'],
      });
      expect(r.ok).toBe(false);
      expect(r.errors.join(' ')).toMatch(/sources\[0\].*string/);
    });

    it('rejects missing required output fields', () => {
      const r = validateAgentOutput(RESEARCHER, { summary: 'x' });
      expect(r.ok).toBe(false);
      expect(r.errors.join(' ')).toMatch(/sources/);
    });
  });

  describe('guardToolCall', () => {
    it('allows tools in the allowedTools list', () => {
      const r = guardToolCall(RESEARCHER, 'web_search');
      expect(r.allowed).toBe(true);
    });

    it('blocks tools NOT in the allowedTools list', () => {
      const r = guardToolCall(RESEARCHER, 'k8s_apply_yaml');
      expect(r.allowed).toBe(false);
      expect(r.reason).toMatch(/not.*allowed/i);
    });

    it('blocks ALL tools when allowedTools is empty', () => {
      const noTools: AgentContract = { allowedTools: [] };
      expect(guardToolCall(noTools, 'web_search').allowed).toBe(false);
    });

    it('allows ALL tools when allowedTools contains "*" (escape hatch)', () => {
      const wildcard: AgentContract = { allowedTools: ['*'] };
      expect(guardToolCall(wildcard, 'anything').allowed).toBe(true);
    });
  });

  // Coverage parity for the validator's error branches (root-level
  // type mismatches): the dialect promises 5 types (string, number,
  // boolean, object, array) and each "expected X, got Y" error path
  // needs a regression line.
  describe('root-type mismatch error coverage', () => {
    it('rejects when output schema expects boolean and gets a string', () => {
      const c: AgentContract = {
        output: { type: 'boolean' },
        allowedTools: [],
      };
      const r = validateAgentOutput(c, 'truthy');
      expect(r.ok).toBe(false);
      expect(r.errors.join(' ')).toMatch(/boolean/);
    });

    it('rejects when output schema expects object and gets an array', () => {
      const c: AgentContract = {
        output: { type: 'object', required: ['k'] },
        allowedTools: [],
      };
      const r = validateAgentOutput(c, [1, 2, 3]);
      expect(r.ok).toBe(false);
      expect(r.errors.join(' ')).toMatch(/object/);
    });

    it('rejects when output schema expects array and gets an object', () => {
      const c: AgentContract = {
        output: { type: 'array', items: { type: 'string' } },
        allowedTools: [],
      };
      const r = validateAgentOutput(c, { not: 'array' });
      expect(r.ok).toBe(false);
      expect(r.errors.join(' ')).toMatch(/array/);
    });

    it('rejects when input schema expects number and gets a string', () => {
      const c: AgentContract = {
        input: { type: 'number' },
        allowedTools: [],
      };
      const r = validateAgentInput(c, 'forty-two');
      expect(r.ok).toBe(false);
      expect(r.errors.join(' ')).toMatch(/number/);
    });
  });
});

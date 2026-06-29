/**
 * PromptClassifier — cross-tenant / multi-admin-scope inventory detection.
 *
 * Live regression captured 2026-05-15 (Q1 drive on api `0.7.1-feffc58b`):
 *   Prompt: "show me my Azure subscriptions and what resource groups
 *            exist in each one — use the batch inventory tool"
 *   Pre-fix classification: single-system-read (FCA 0.85) → gpt-oss:20b wins
 *   Post-fix expectation:   *-agentic (FCA 0.90) → frontier-grade model wins
 *
 * Why the old classifier missed this:
 *   - parallelIntent regex needed an admin-boundary noun IMMEDIATELY after
 *     "each / every / across". "each one" used a pronoun referring back to
 *     "subscriptions" — no admin-boundary noun after "each", so the regex
 *     missed the structural fan-out signal.
 *   - The prompt mentions TWO plural admin-boundary nouns ("subscriptions"
 *     + "resource groups") — that pair is the structural tell-tale of a
 *     parent-child enumeration, but the score didn't capture it.
 *
 * Structural fix (no domain noun list — pure SHAPE detectors):
 *   (a) "each / every / across" followed by a pronoun OR followed by no
 *       noun at all (sentence boundary, punctuation) is treated as a
 *       structural fan-out signal when the prompt ALSO contains at least
 *       one plural admin-boundary noun anywhere upstream.
 *   (b) The admin-boundary noun set expands to include "resource group(s)"
 *       and "rg(s)" — structural admin-scope nouns, same as account /
 *       project / cluster / subscription.
 *   (c) When 2+ plural admin-boundary nouns appear in the same prompt
 *       (e.g. "subscriptions" + "resource groups"), that pair alone is
 *       a structural fan-out signal (parent-child inventory shape).
 *
 * These tests are RED against the current classifier and GREEN once the
 * minimal expansion lands. Constraints (per CLAUDE.md):
 *   - NO model literal assertions
 *   - NO domain noun lists in the assertions
 *   - assertions match /-agentic/ to allow any of the 5 agentic flavors
 */
import { describe, it, expect } from 'vitest';
import { classifyTaskType, type TaskType } from '../PromptClassifier.js';

describe('PromptClassifier — cross-tenant inventory (#874, 2026-05-15)', () => {
  describe('Q1 live regression — multi-admin-scope inventory must classify as *-agentic', () => {
    it('the exact Q1 prompt (Azure subs + RGs "in each one") → *-agentic', () => {
      const prompt =
        'show me my Azure subscriptions and what resource groups exist in each one — use the batch inventory tool';
      expect(classifyTaskType(prompt)).toMatch(/-agentic$/);
    });

    it('"list all my Azure RGs across all subscriptions" → *-agentic', () => {
      const prompt = 'list all my Azure RGs across all subscriptions';
      expect(classifyTaskType(prompt)).toMatch(/-agentic$/);
    });

    it('"show me what\'s in each AWS account" → *-agentic', () => {
      const prompt = "show me what's in each AWS account";
      expect(classifyTaskType(prompt)).toMatch(/-agentic$/);
    });

    it('"inventory every GCP project" → *-agentic', () => {
      const prompt = 'inventory every GCP project';
      expect(classifyTaskType(prompt)).toMatch(/-agentic$/);
    });
  });

  describe('elliptical "each <pronoun>" fan-out signal', () => {
    it('"list subscriptions and the resource groups in each of them" → *-agentic', () => {
      const prompt = 'list subscriptions and the resource groups in each of them';
      expect(classifyTaskType(prompt)).toMatch(/-agentic$/);
    });

    it('"show me my AWS accounts and the s3 buckets in each one" → *-agentic', () => {
      const prompt = 'show me my AWS accounts and the s3 buckets in each one';
      expect(classifyTaskType(prompt)).toMatch(/-agentic$/);
    });
  });

  describe('plural admin-boundary noun PAIR (parent-child structural shape)', () => {
    it('subscriptions + resource groups (plural pair) → *-agentic', () => {
      const prompt = 'enumerate my subscriptions and their resource groups';
      expect(classifyTaskType(prompt)).toMatch(/-agentic$/);
    });

    it('accounts + buckets (plural pair) → *-agentic', () => {
      const prompt = 'list all accounts with their buckets';
      expect(classifyTaskType(prompt)).toMatch(/-agentic$/);
    });
  });

  describe('regression guards — single-admin-scope reads must STAY cheap', () => {
    it('"list my azure subscriptions" stays single-system-read (no parent-child shape)', () => {
      expect(classifyTaskType('list my azure subscriptions')).toBe<TaskType>('single-system-read');
    });

    it('"show me my Azure subscriptions" stays single-system-read', () => {
      expect(classifyTaskType('show me my Azure subscriptions')).toBe<TaskType>('single-system-read');
    });

    it('"hi" stays pure-chat', () => {
      expect(classifyTaskType('hi')).toBe<TaskType>('pure-chat');
    });

    it('"what is 2+2" stays pure-chat', () => {
      expect(classifyTaskType('what is 2+2')).toBe<TaskType>('pure-chat');
    });
  });
});

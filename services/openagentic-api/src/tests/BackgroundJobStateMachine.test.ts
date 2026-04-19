import { describe, test, expect } from 'vitest';
import {
  isLegalTransition,
  appendTransition,
  isDueForResumption,
  isJobState,
  IllegalStateTransitionError,
  TERMINAL_STATES,
  type JobState,
  type StateTransition,
} from '../services/BackgroundJobStateMachine.js';

describe('BackgroundJobStateMachine (P8 task #113)', () => {
  describe('isLegalTransition', () => {
    test.each([
      ['queued',    'running'],
      ['queued',    'failed'],
      ['running',   'parked'],
      ['running',   'completed'],
      ['running',   'failed'],
      ['parked',    'resumable'],
      ['parked',    'failed'],
      ['resumable', 'running'],
      ['resumable', 'failed'],
    ] as Array<[JobState, JobState]>)('%s → %s is legal', (from, to) => {
      expect(isLegalTransition(from, to)).toBe(true);
    });

    test.each([
      ['completed', 'running'],      // terminal
      ['failed',    'running'],      // terminal
      ['queued',    'completed'],    // must go through running
      ['queued',    'parked'],       // must go through running
      ['running',   'resumable'],    // must go through parked first
      ['parked',    'running'],      // must transition to resumable first
      ['parked',    'completed'],    // can't skip running
      ['resumable', 'parked'],       // one-way flow
    ] as Array<[JobState, JobState]>)('%s → %s is illegal', (from, to) => {
      expect(isLegalTransition(from, to)).toBe(false);
    });

    test('self-transition (same → same) is illegal', () => {
      expect(isLegalTransition('running', 'running')).toBe(false);
      expect(isLegalTransition('queued', 'queued')).toBe(false);
    });
  });

  describe('appendTransition', () => {
    test('happy path appends a new transition with ts + optional reason', () => {
      const now = new Date('2026-04-18T12:00:00Z');
      const prior: StateTransition[] = [];
      const next = appendTransition(prior, 'queued', 'running', 'worker picked up job', now);
      expect(next).toHaveLength(1);
      expect(next[0]).toEqual({
        from: 'queued',
        to: 'running',
        ts: '2026-04-18T12:00:00.000Z',
        reason: 'worker picked up job',
      });
      // Does not mutate input
      expect(prior).toHaveLength(0);
    });

    test('multiple transitions accumulate in order', () => {
      const t1 = appendTransition([], 'queued', 'running');
      const t2 = appendTransition(t1, 'running', 'parked', 'waiting on AKS');
      const t3 = appendTransition(t2, 'parked', 'resumable');
      const t4 = appendTransition(t3, 'resumable', 'running');
      const t5 = appendTransition(t4, 'running', 'completed');
      expect(t5).toHaveLength(5);
      expect(t5.map((t) => `${t.from}->${t.to}`)).toEqual([
        'queued->running',
        'running->parked',
        'parked->resumable',
        'resumable->running',
        'running->completed',
      ]);
    });

    test('illegal transition throws IllegalStateTransitionError', () => {
      expect(() => appendTransition([], 'completed', 'running'))
        .toThrow(IllegalStateTransitionError);
      expect(() => appendTransition([], 'queued', 'parked'))
        .toThrow(IllegalStateTransitionError);
    });

    test('IllegalStateTransitionError exposes from + to for logging', () => {
      try {
        appendTransition([], 'failed', 'running');
        throw new Error('should have thrown');
      } catch (e) {
        expect(e).toBeInstanceOf(IllegalStateTransitionError);
        const err = e as IllegalStateTransitionError;
        expect(err.from).toBe('failed');
        expect(err.to).toBe('running');
      }
    });
  });

  describe('isDueForResumption', () => {
    const now = new Date('2026-04-18T12:00:00Z');

    test('parked job with past resume_at → due', () => {
      const past = new Date(now.getTime() - 60_000);
      expect(isDueForResumption({ status: 'parked', resume_at: past }, now)).toBe(true);
    });

    test('parked job with past ISO-string resume_at → due', () => {
      const past = new Date(now.getTime() - 60_000).toISOString();
      expect(isDueForResumption({ status: 'parked', resume_at: past }, now)).toBe(true);
    });

    test('parked job with future resume_at → not due', () => {
      const future = new Date(now.getTime() + 60_000);
      expect(isDueForResumption({ status: 'parked', resume_at: future }, now)).toBe(false);
    });

    test('parked job with no resume_at → not due (indefinite wait)', () => {
      expect(isDueForResumption({ status: 'parked', resume_at: null }, now)).toBe(false);
      expect(isDueForResumption({ status: 'parked' }, now)).toBe(false);
    });

    test('non-parked status → never due, even with past resume_at', () => {
      const past = new Date(now.getTime() - 60_000);
      expect(isDueForResumption({ status: 'running', resume_at: past }, now)).toBe(false);
      expect(isDueForResumption({ status: 'completed', resume_at: past }, now)).toBe(false);
      expect(isDueForResumption({ status: 'resumable', resume_at: past }, now)).toBe(false);
    });
  });

  describe('isJobState', () => {
    test('returns true for each valid state', () => {
      for (const state of ['queued', 'running', 'parked', 'resumable', 'completed', 'failed'] as const) {
        expect(isJobState(state)).toBe(true);
      }
    });

    test('returns false for invalid strings, numbers, null', () => {
      expect(isJobState('pending')).toBe(false);
      expect(isJobState('')).toBe(false);
      expect(isJobState('RUNNING')).toBe(false);   // case-sensitive
      expect(isJobState(null)).toBe(false);
      expect(isJobState(undefined)).toBe(false);
      expect(isJobState(42)).toBe(false);
    });
  });

  describe('TERMINAL_STATES', () => {
    test('completed + failed are terminal', () => {
      expect(TERMINAL_STATES.has('completed')).toBe(true);
      expect(TERMINAL_STATES.has('failed')).toBe(true);
    });
    test('non-terminal states are not terminal', () => {
      expect(TERMINAL_STATES.has('queued')).toBe(false);
      expect(TERMINAL_STATES.has('running')).toBe(false);
      expect(TERMINAL_STATES.has('parked')).toBe(false);
      expect(TERMINAL_STATES.has('resumable')).toBe(false);
    });
  });
});

import { describe, test, expect, vi } from 'vitest';
import pino from 'pino';
import {
  assertUserIdOrThrow,
  assertSameUserOrThrow,
  buildMilvusAuditEvent,
  defaultAuditSink,
  CrossUserAccessError,
  InvalidUserIdError,
} from '../services/MilvusAuditGuard.js';

const logger = pino({ level: 'silent' });

describe('MilvusAuditGuard — userId invariants (UC-A18 / P5 task #110)', () => {
  describe('assertUserIdOrThrow', () => {
    test('accepts a concrete user id', () => {
      expect(() => assertUserIdOrThrow('azure_696cf712-372c-4bb0-94c6-a881d8d033d9'))
        .not.toThrow();
    });

    test.each([
      ['empty string', ''],
      ['whitespace only', '   '],
      ['literal "*"', '*'],
      ['literal "all"', 'all'],
      ['literal "__system__"', '__system__'],
      ['literal "anonymous"', 'anonymous'],
      ['case-variant "ALL"', 'ALL'],
      ['case-variant "System__"', '__System__'],
    ])('rejects sentinel value (%s)', (_label, value) => {
      expect(() => assertUserIdOrThrow(value)).toThrow(InvalidUserIdError);
    });

    test.each([
      ['undefined', undefined],
      ['null', null],
      ['number 0', 0],
      ['number 1', 1],
      ['object', {}],
      ['array', []],
      ['boolean', true],
    ])('rejects non-string value (%s)', (_label, value) => {
      expect(() => assertUserIdOrThrow(value)).toThrow(InvalidUserIdError);
    });
  });

  describe('assertSameUserOrThrow', () => {
    test('allows self-read', () => {
      expect(() =>
        assertSameUserOrThrow({
          actorUserId: 'user-1',
          targetUserId: 'user-1',
        }),
      ).not.toThrow();
    });

    test('rejects cross-user when non-admin', () => {
      expect(() =>
        assertSameUserOrThrow({
          actorUserId: 'user-1',
          targetUserId: 'user-2',
        }),
      ).toThrow(CrossUserAccessError);
    });

    test('rejects cross-user when admin but allowAdmin is false', () => {
      expect(() =>
        assertSameUserOrThrow({
          actorUserId: 'admin-1',
          targetUserId: 'user-2',
          actorIsAdmin: true,
          allowAdmin: false,
        }),
      ).toThrow(CrossUserAccessError);
    });

    test('allows cross-user when actor is admin AND allowAdmin is true', () => {
      expect(() =>
        assertSameUserOrThrow({
          actorUserId: 'admin-1',
          targetUserId: 'user-2',
          actorIsAdmin: true,
          allowAdmin: true,
        }),
      ).not.toThrow();
    });

    test('rejects even admins when actor userId is a sentinel', () => {
      expect(() =>
        assertSameUserOrThrow({
          actorUserId: '__system__',
          targetUserId: 'user-2',
          actorIsAdmin: true,
          allowAdmin: true,
        }),
      ).toThrow(InvalidUserIdError);
    });

    test('CrossUserAccessError exposes actor + target for forensic logging', () => {
      try {
        assertSameUserOrThrow({
          actorUserId: 'user-alpha',
          targetUserId: 'user-beta',
        });
        throw new Error('should have thrown');
      } catch (e) {
        expect(e).toBeInstanceOf(CrossUserAccessError);
        const err = e as CrossUserAccessError;
        expect(err.actorUserId).toBe('user-alpha');
        expect(err.targetUserId).toBe('user-beta');
        expect(err.message).toContain('user-alpha');
        expect(err.message).toContain('user-beta');
      }
    });
  });

  describe('buildMilvusAuditEvent', () => {
    test('shapes a basic search event', () => {
      const ev = buildMilvusAuditEvent({
        actorUserId: 'user-1',
        action: 'search',
        collection: 'user_1_memories',
      });
      expect(ev.actorUserId).toBe('user-1');
      expect(ev.targetUserId).toBe('user-1'); // defaults to actor
      expect(ev.action).toBe('search');
      expect(ev.resource).toBe('milvus:user_1_memories');
      expect(ev.ts).toBeInstanceOf(Date);
    });

    test('preserves explicit targetUserId for cross-user rejects', () => {
      const ev = buildMilvusAuditEvent({
        actorUserId: 'user-alpha',
        targetUserId: 'user-beta',
        action: 'cross_user_reject',
        collection: 'user_beta_memories',
        details: { reason: 'probe-from-alpha' },
      });
      expect(ev.actorUserId).toBe('user-alpha');
      expect(ev.targetUserId).toBe('user-beta');
      expect(ev.action).toBe('cross_user_reject');
      expect(ev.details?.reason).toBe('probe-from-alpha');
    });
  });

  describe('defaultAuditSink', () => {
    test('logs via pino child logger (observable side effect)', () => {
      const sink = defaultAuditSink(logger);
      const ev = buildMilvusAuditEvent({
        actorUserId: 'user-1',
        action: 'search',
        collection: 'user_1_memories',
      });
      expect(() => sink(ev)).not.toThrow();
    });
  });
});

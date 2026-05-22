/**
 * TDD tests for croner-backed cron helpers in WorkflowScheduler.
 * C1-C6 acceptance criteria coverage.
 */

import { describe, it, expect } from 'vitest';
import { cronMatches, getNextCronTime } from '../WorkflowScheduler.js';

// ---------------------------------------------------------------------------
// C1 – basic field matching
// ---------------------------------------------------------------------------
describe('cronMatches — basic fields', () => {
  it('matches exact minute/hour (UTC)', () => {
    // 30 14 * * * → 14:30 UTC
    const date = new Date('2026-04-25T14:30:00.000Z');
    expect(cronMatches('30 14 * * *', date)).toBe(true);
  });

  it('does NOT match a different minute', () => {
    const date = new Date('2026-04-25T14:31:00.000Z');
    expect(cronMatches('30 14 * * *', date)).toBe(false);
  });

  it('matches wildcard minute/hour', () => {
    const date = new Date('2026-04-25T03:47:00.000Z');
    expect(cronMatches('* * * * *', date)).toBe(true);
  });

  it('step expressions work: */15 means every 15 minutes', () => {
    const d0 = new Date('2026-04-25T10:00:00.000Z');
    const d15 = new Date('2026-04-25T10:15:00.000Z');
    const d7 = new Date('2026-04-25T10:07:00.000Z');
    expect(cronMatches('*/15 * * * *', d0)).toBe(true);
    expect(cronMatches('*/15 * * * *', d15)).toBe(true);
    expect(cronMatches('*/15 * * * *', d7)).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// C2 – per-schedule timezone
// ---------------------------------------------------------------------------
describe('cronMatches — timezone arg (C2)', () => {
  it('honors America/New_York timezone offset', () => {
    // "0 9 * * *" = 09:00 local New York; in April (EDT=UTC-4) that is 13:00 UTC
    const utcDate = new Date('2026-04-25T13:00:00.000Z');
    expect(cronMatches('0 9 * * *', utcDate, 'America/New_York')).toBe(true);
    // 14:00 UTC = 10:00 EDT — should NOT match 09:00
    const wrong = new Date('2026-04-25T14:00:00.000Z');
    expect(cronMatches('0 9 * * *', wrong, 'America/New_York')).toBe(false);
  });

  it('defaults to UTC when no timezone supplied', () => {
    const utcDate = new Date('2026-04-25T09:00:00.000Z');
    expect(cronMatches('0 9 * * *', utcDate)).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// C3 – macro support
// ---------------------------------------------------------------------------
describe('cronMatches and getNextCronTime — macros (C3)', () => {
  it('@hourly fires at :00 each hour', () => {
    // Pass UTC timezone so macros expand relative to UTC
    const onHour = new Date('2026-04-25T10:00:00.000Z');
    const offHour = new Date('2026-04-25T10:01:00.000Z');
    expect(cronMatches('@hourly', onHour, 'UTC')).toBe(true);
    expect(cronMatches('@hourly', offHour, 'UTC')).toBe(false);
  });

  it('@daily fires at midnight UTC', () => {
    const midnight = new Date('2026-04-25T00:00:00.000Z');
    const notMidnight = new Date('2026-04-25T01:00:00.000Z');
    expect(cronMatches('@daily', midnight, 'UTC')).toBe(true);
    expect(cronMatches('@daily', notMidnight, 'UTC')).toBe(false);
  });

  it('@weekly fires at Sunday midnight UTC', () => {
    // 2026-04-26 is a Sunday
    const sundayMidnight = new Date('2026-04-26T00:00:00.000Z');
    expect(cronMatches('@weekly', sundayMidnight, 'UTC')).toBe(true);
  });

  it('@monthly fires at 00:00 on the 1st', () => {
    const firstOfMonth = new Date('2026-05-01T00:00:00.000Z');
    const secondOfMonth = new Date('2026-05-02T00:00:00.000Z');
    expect(cronMatches('@monthly', firstOfMonth, 'UTC')).toBe(true);
    expect(cronMatches('@monthly', secondOfMonth, 'UTC')).toBe(false);
  });

  it('@yearly / @annually fire on Jan 1 00:00 UTC', () => {
    const janFirst = new Date('2027-01-01T00:00:00.000Z');
    expect(cronMatches('@yearly', janFirst, 'UTC')).toBe(true);
    expect(cronMatches('@annually', janFirst, 'UTC')).toBe(true);
  });

  it('@reboot does NOT match any runtime date (no-op)', () => {
    const now = new Date();
    expect(cronMatches('@reboot', now, 'UTC')).toBe(false);
  });

  it('getNextCronTime works for @daily', () => {
    const from = new Date('2026-04-25T10:00:00.000Z');
    const next = getNextCronTime('@daily', from, 'UTC');
    expect(next.toISOString()).toBe('2026-04-26T00:00:00.000Z');
  });

  it('getNextCronTime works for @hourly', () => {
    const from = new Date('2026-04-25T10:30:00.000Z');
    const next = getNextCronTime('@hourly', from, 'UTC');
    expect(next.toISOString()).toBe('2026-04-25T11:00:00.000Z');
  });
});

// ---------------------------------------------------------------------------
// C4 – day-of-week names
// ---------------------------------------------------------------------------
describe('cronMatches — day names (C4)', () => {
  it('MON-FRI matches Monday', () => {
    // 2026-04-27 is a Monday
    const monday9am = new Date('2026-04-27T09:00:00.000Z');
    expect(cronMatches('0 9 * * MON-FRI', monday9am)).toBe(true);
  });

  it('MON-FRI does NOT match Saturday', () => {
    // 2026-04-25 is a Saturday
    const saturday9am = new Date('2026-04-25T09:00:00.000Z');
    expect(cronMatches('0 9 * * MON-FRI', saturday9am)).toBe(false);
  });

  it('MON-FRI does NOT match Sunday', () => {
    // 2026-04-26 is a Sunday
    const sunday9am = new Date('2026-04-26T09:00:00.000Z');
    expect(cronMatches('0 9 * * MON-FRI', sunday9am)).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// C5 – DST spring-forward: 0 2 * * * in America/Los_Angeles
// Skip check: on spring-forward night, 02:00 doesn't exist locally.
// The fix should ensure the expression fires once at 03:00 local (skipping 02:00).
// We verify via getNextCronTime: starting just before the gap, next run is 03:00.
// ---------------------------------------------------------------------------
describe('DST spring-forward (C5)', () => {
  it('0 2 * * * in America/Los_Angeles: next run on spring-forward night skips to 03:00', () => {
    // US DST spring-forward 2027: 2027-03-14, clocks go 01:59→03:00
    // Starting at 01:58 local (09:58 UTC, since PST=UTC-8), ask for next "2am" run.
    // On the spring-forward night, 2:00am doesn't exist so croner skips to 3:00am.
    const justBefore = new Date('2027-03-14T09:58:00.000Z'); // 01:58 PST
    const next = getNextCronTime('0 2 * * *', justBefore, 'America/Los_Angeles');
    // 3:00am PDT = UTC-7 → 10:00 UTC
    expect(next.toISOString()).toBe('2027-03-14T10:00:00.000Z');
  });

  it('0 2 * * * in UTC still fires exactly at 02:00 UTC (no DST in UTC)', () => {
    const from = new Date('2026-04-25T01:58:00.000Z');
    const next = getNextCronTime('0 2 * * *', from, 'UTC');
    expect(next.toISOString()).toBe('2026-04-25T02:00:00.000Z');
  });
});

// ---------------------------------------------------------------------------
// getNextCronTime — additional
// ---------------------------------------------------------------------------
describe('getNextCronTime — general', () => {
  it('advances to next minute when expression matches current+1', () => {
    const from = new Date('2026-04-25T10:00:00.000Z');
    const next = getNextCronTime('1 10 * * *', from);
    expect(next.toISOString()).toBe('2026-04-25T10:01:00.000Z');
  });

  it('returns next day for past daily expression', () => {
    // Already past 08:00 today
    const from = new Date('2026-04-25T10:00:00.000Z');
    const next = getNextCronTime('0 8 * * *', from);
    expect(next.toISOString()).toBe('2026-04-26T08:00:00.000Z');
  });
});

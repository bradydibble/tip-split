import { describe, it, expect } from 'vitest';
import { businessDate, defaultShift, isValidTimeZone, DEFAULT_TIMEZONE } from './business-date';

const PACIFIC = 'America/Los_Angeles';

// Helper: build a Date from a UTC instant so tests are independent of the
// machine's local timezone (CI runs in UTC).
const at = (iso: string) => new Date(iso);

describe('businessDate', () => {
  it('defaults to America/Los_Angeles', () => {
    expect(DEFAULT_TIMEZONE).toBe(PACIFIC);
  });

  it('reproduces the reported bug: 8 PM Pacific stays the same calendar day', () => {
    // 8:00 PM PDT on 2026-07-13 is 2026-07-14T03:00:00Z. The old UTC-based
    // code showed 2026-07-14; the business date must still be 2026-07-13.
    expect(businessDate(at('2026-07-14T03:00:00Z'), PACIFIC)).toBe('2026-07-13');
  });

  it('does not advance to the next day at closing time (1 AM Pacific)', () => {
    // 1:00 AM PDT on 2026-07-14 is 2026-07-14T08:00:00Z — still the prior
    // business day because the restaurant day rolls over at 3 AM.
    expect(businessDate(at('2026-07-14T08:00:00Z'), PACIFIC)).toBe('2026-07-13');
  });

  it('stays on the prior day just before the 3 AM rollover (2:59 AM Pacific)', () => {
    expect(businessDate(at('2026-07-14T09:59:00Z'), PACIFIC)).toBe('2026-07-13');
  });

  it('advances to the new day exactly at 3 AM Pacific', () => {
    expect(businessDate(at('2026-07-14T10:00:00Z'), PACIFIC)).toBe('2026-07-14');
  });

  it('stays on the new day after 3 AM Pacific', () => {
    expect(businessDate(at('2026-07-14T10:30:00Z'), PACIFIC)).toBe('2026-07-14');
    expect(businessDate(at('2026-07-14T19:00:00Z'), PACIFIC)).toBe('2026-07-14'); // noon
  });

  it('late evening Pacific stays on the same calendar day', () => {
    // 11:30 PM PDT on 2026-07-13 → 2026-07-14T06:30:00Z
    expect(businessDate(at('2026-07-14T06:30:00Z'), PACIFIC)).toBe('2026-07-13');
  });

  it('rolls back across a month boundary', () => {
    // 12:30 AM PDT on 2026-08-01 → 2026-08-01T07:30:00Z → prior day 2026-07-31
    expect(businessDate(at('2026-08-01T07:30:00Z'), PACIFIC)).toBe('2026-07-31');
  });

  it('rolls back across a year boundary', () => {
    // 1:00 AM PST on 2026-01-01 → 2026-01-01T09:00:00Z → 2025-12-31
    expect(businessDate(at('2026-01-01T09:00:00Z'), PACIFIC)).toBe('2025-12-31');
  });

  it('handles the spring-forward DST day correctly', () => {
    // 2026-03-08: clocks jump 2 AM PST → 3 AM PDT. 1:00 AM PST = 09:00Z (prior day),
    // 3:00 AM PDT = 10:00Z (new day, exactly at rollover).
    expect(businessDate(at('2026-03-08T09:00:00Z'), PACIFIC)).toBe('2026-03-07');
    expect(businessDate(at('2026-03-08T10:00:00Z'), PACIFIC)).toBe('2026-03-08');
  });

  it('works for other timezones (America/New_York)', () => {
    const NY = 'America/New_York';
    // 1:00 AM EDT on 2026-07-14 → 2026-07-14T05:00:00Z → prior day
    expect(businessDate(at('2026-07-14T05:00:00Z'), NY)).toBe('2026-07-13');
    // 3:00 AM EDT on 2026-07-14 → 2026-07-14T07:00:00Z → new day
    expect(businessDate(at('2026-07-14T07:00:00Z'), NY)).toBe('2026-07-14');
  });

  it('respects a custom rollover hour', () => {
    // With a 6 AM rollover, 5 AM Pacific still belongs to the prior day.
    // 5:00 AM PDT on 2026-07-14 → 2026-07-14T12:00:00Z
    expect(businessDate(at('2026-07-14T12:00:00Z'), PACIFIC, 6)).toBe('2026-07-13');
    expect(businessDate(at('2026-07-14T13:00:00Z'), PACIFIC, 6)).toBe('2026-07-14'); // 6 AM
  });
});

describe('defaultShift', () => {
  const LUNCH_CUTOFF = '15:00';

  it('is Dinner during late-night closing (before the 3 AM rollover)', () => {
    // 1:00 AM PDT — you are closing out dinner, not lunch.
    expect(defaultShift(at('2026-07-14T08:00:00Z'), PACIFIC, LUNCH_CUTOFF)).toBe('Dinner');
  });

  it('is Lunch in the morning after the rollover', () => {
    // 10:00 AM PDT → 2026-07-14T17:00:00Z
    expect(defaultShift(at('2026-07-14T17:00:00Z'), PACIFIC, LUNCH_CUTOFF)).toBe('Lunch');
  });

  it('is Dinner in the evening', () => {
    // 8:00 PM PDT → 2026-07-14T03:00:00Z (next UTC day, but 8 PM local)
    expect(defaultShift(at('2026-07-14T03:00:00Z'), PACIFIC, LUNCH_CUTOFF)).toBe('Dinner');
  });

  it('switches to Dinner exactly at the lunch cutoff', () => {
    // 3:00 PM PDT → 2026-07-14T22:00:00Z
    expect(defaultShift(at('2026-07-14T22:00:00Z'), PACIFIC, LUNCH_CUTOFF)).toBe('Dinner');
    // 2:59 PM PDT → 2026-07-14T21:59:00Z is still Lunch
    expect(defaultShift(at('2026-07-14T21:59:00Z'), PACIFIC, LUNCH_CUTOFF)).toBe('Lunch');
  });

  it('is Lunch just after the rollover (3:30 AM Pacific)', () => {
    // 3:30 AM PDT → 2026-07-14T10:30:00Z
    expect(defaultShift(at('2026-07-14T10:30:00Z'), PACIFIC, LUNCH_CUTOFF)).toBe('Lunch');
  });
});

describe('isValidTimeZone', () => {
  it('accepts valid IANA zones', () => {
    expect(isValidTimeZone('America/Los_Angeles')).toBe(true);
    expect(isValidTimeZone('America/New_York')).toBe(true);
    expect(isValidTimeZone('UTC')).toBe(true);
  });

  it('rejects invalid zones', () => {
    expect(isValidTimeZone('Not/AZone')).toBe(false);
    expect(isValidTimeZone('')).toBe(false);
    expect(isValidTimeZone('Pacific Time')).toBe(false);
  });
});

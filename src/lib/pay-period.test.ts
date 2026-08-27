import { describe, it, expect } from 'vitest';
import {
  PERIOD_LENGTH_DAYS,
  DEFAULT_PAY_PERIOD_ANCHOR,
  isValidDateStr,
  addDays,
  isSunday,
  isOnLattice,
  periodStartFor,
  periodEndExclusive,
  dayOfPeriod,
  periodStatus,
  periodRange,
  currentPeriodStart,
  formatPeriodLabel,
} from './pay-period';

const A = DEFAULT_PAY_PERIOD_ANCHOR; // 2026-08-23, a Sunday

describe('pay period lattice', () => {
  it('anchor is a Sunday on the lattice', () => {
    expect(isSunday(A)).toBe(true);
    expect(isOnLattice(A, A)).toBe(true);
  });

  it('maps every day of the anchor period to the anchor', () => {
    // 2026-08-23 (Sun) .. 2026-09-05 (Sat)
    for (let i = 0; i < PERIOD_LENGTH_DAYS; i++) {
      expect(periodStartFor(addDays(A, i), A)).toBe(A);
    }
  });

  it('starts the next period on the following lattice Sunday', () => {
    expect(periodStartFor('2026-08-24', A)).toBe('2026-08-23');
    expect(periodStartFor('2026-09-05', A)).toBe('2026-08-23');
    expect(periodStartFor('2026-09-06', A)).toBe('2026-09-06');
    expect(periodStartFor('2026-09-19', A)).toBe('2026-09-06');
    expect(periodStartFor('2026-09-20', A)).toBe('2026-09-20');
  });

  it('maps backward across the June 2026 boundary', () => {
    // 2026-05-31 (Sun) is 84 days before the anchor: 84 % 14 == 0
    expect(isOnLattice('2026-05-31', A)).toBe(true);
    expect(periodStartFor('2026-05-31', A)).toBe('2026-05-31');
    expect(periodStartFor('2026-06-13', A)).toBe('2026-05-31');
    expect(periodStartFor('2026-06-14', A)).toBe('2026-06-14');
  });

  it('keeps the lattice intact across the 2026-11-01 DST fall-back', () => {
    // 2026-10-18 (Sun) is 56 days after the anchor: 56 % 14 == 0
    expect(isOnLattice('2026-10-18', A)).toBe(true);
    expect(periodStartFor('2026-10-31', A)).toBe('2026-10-18');
    // DST-end Sunday is itself a period start; the day after maps to it
    expect(isOnLattice('2026-11-01', A)).toBe(true);
    expect(periodStartFor('2026-11-01', A)).toBe('2026-11-01');
    expect(periodStartFor('2026-11-02', A)).toBe('2026-11-01');
    // and the period after that still starts on a Sunday, not a Saturday
    expect(periodStartFor('2026-11-14', A)).toBe('2026-11-01');
    expect(periodStartFor('2026-11-15', A)).toBe('2026-11-15');
    expect(isSunday('2026-11-15')).toBe(true);
  });

  it('keeps the lattice intact across the year boundary', () => {
    // 2026-12-27 (Sun) is 126 days after the anchor: 126 % 14 == 0
    expect(isOnLattice('2026-12-27', A)).toBe(true);
    expect(periodStartFor('2026-12-31', A)).toBe('2026-12-27');
    expect(periodStartFor('2027-01-01', A)).toBe('2026-12-27');
    expect(periodStartFor('2027-01-09', A)).toBe('2026-12-27');
    expect(periodStartFor('2027-01-10', A)).toBe('2027-01-10');
  });

  it('rejects off-lattice dates', () => {
    expect(isOnLattice('2026-08-22', A)).toBe(false); // Saturday
    expect(isOnLattice('2026-08-16', A)).toBe(false); // Sunday, but 7 days before anchor
    expect(isOnLattice('2026-08-30', A)).toBe(false); // Sunday, but 7 days after anchor
  });
});

describe('period helpers', () => {
  it('computes exclusive ends', () => {
    expect(periodEndExclusive('2026-08-23')).toBe('2026-09-06');
    expect(periodEndExclusive('2026-12-27')).toBe('2027-01-10');
  });

  it('computes day of period', () => {
    expect(dayOfPeriod('2026-08-23', '2026-08-23')).toBe(1);
    expect(dayOfPeriod('2026-08-16', '2026-08-09')).toBe(8);
    expect(dayOfPeriod('2026-09-05', '2026-08-23')).toBe(14);
  });

  it('classifies status against today', () => {
    const today = '2026-08-16';
    expect(periodStatus('2026-08-09', today)).toBe('current');
    expect(periodStatus('2026-08-09', '2026-08-09')).toBe('current'); // day 1
    expect(periodStatus('2026-08-09', '2026-08-22')).toBe('current'); // day 14
    expect(periodStatus('2026-08-09', '2026-08-23')).toBe('past');
    expect(periodStatus('2026-07-26', today)).toBe('past');
    expect(periodStatus('2026-08-23', today)).toBe('upcoming');
    expect(periodStatus('2026-09-06', today)).toBe('upcoming');
  });

  it('generates the 2026 payroll range: June overlap through year end', () => {
    const starts = periodRange('2026-06-01', '2026-12-31', A);
    expect(starts[0]).toBe('2026-05-31'); // first period overlapping June 2026
    expect(starts[starts.length - 1]).toBe('2026-12-27'); // last start in 2026
    expect(starts).toHaveLength(16);
    // DST week must be present and unshifted
    expect(starts).toContain('2026-11-01');
    expect(starts).toContain('2026-11-15');
    // every start is a lattice Sunday
    for (const s of starts) expect(isOnLattice(s, A)).toBe(true);
  });

  it('resolves the current period from an injected now (Pacific)', () => {
    // 2026-11-01 01:00 PDT = 08:00Z — before the 3 AM rollover, business
    // date is still 2026-10-31, so the current period starts 2026-10-18.
    expect(
      currentPeriodStart(new Date('2026-11-01T08:00:00Z'), 'America/Los_Angeles', A),
    ).toBe('2026-10-18');
    // After the fall-back (09:00Z), 03:01 PST = 11:01Z — past the 3 AM
    // rollover, business date is 2026-11-01, a lattice start.
    expect(
      currentPeriodStart(new Date('2026-11-01T11:01:00Z'), 'America/Los_Angeles', A),
    ).toBe('2026-11-01');
    // Mid-August: today 2026-08-16 (Sun) → period 2026-08-09.
    // 2026-08-16 12:00 PDT = 19:00Z
    expect(
      currentPeriodStart(new Date('2026-08-16T19:00:00Z'), 'America/Los_Angeles', A),
    ).toBe('2026-08-09');
  });
});

describe('date string validation', () => {
  it('accepts real dates, rejects garbage and impossible dates', () => {
    expect(isValidDateStr('2026-08-23')).toBe(true);
    expect(isValidDateStr('2026-02-28')).toBe(true);
    expect(isValidDateStr('2026-02-30')).toBe(false);
    expect(isValidDateStr('2024-02-29')).toBe(true); // leap year
    expect(isValidDateStr('2026-13-01')).toBe(false);
    expect(isValidDateStr('2026-8-3')).toBe(false);
    expect(isValidDateStr('2026/08/23')).toBe(false);
    expect(isValidDateStr('')).toBe(false);
  });
});

describe('labels', () => {
  it('formats same-year periods', () => {
    expect(formatPeriodLabel('2026-08-23')).toBe('Aug 23 – Sep 5, 2026');
    expect(formatPeriodLabel('2026-08-09')).toBe('Aug 9 – Aug 22, 2026');
  });

  it('formats year-crossing periods', () => {
    expect(formatPeriodLabel('2026-12-27')).toBe('Dec 27, 2026 – Jan 9, 2027');
  });
});

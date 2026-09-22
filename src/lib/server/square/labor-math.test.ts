import { describe, it, expect } from 'vitest';
import {
  unpaidBreakMinutes,
  workedMinutes,
  shiftCostCents,
  shiftBusinessDate,
  salaryDailyCents,
  taxEstimateCents,
  minutesToHM,
  weekStartDateOf,
  otPremiumCents,
  weeklyOvertimeAllocation,
} from './labor-math';
import type { SquareWorkedShift } from './fixtures';

const BD = '2026-09-05';
const NOW = new Date('2026-09-05T13:00:00-07:00');

function shift(partial: Partial<SquareWorkedShift> = {}): SquareWorkedShift {
  return {
    id: 'SH-test',
    team_member_id: 'TM-x',
    location_id: 'LOC',
    start_at: `${BD}T10:00:00-07:00`,
    end_at: `${BD}T16:00:00-07:00`,
    status: 'CLOSED',
    wage: { hourly_rate: { amount: 1800, currency: 'USD' } },
    breaks: [],
    ...partial,
  };
}

describe('unpaidBreakMinutes', () => {
  it('sums unpaid breaks in minutes', () => {
    const s = shift({
      breaks: [
        { start_at: `${BD}T12:00:00-07:00`, end_at: `${BD}T12:30:00-07:00`, is_paid: false },
        { start_at: `${BD}T14:00:00-07:00`, end_at: `${BD}T14:10:00-07:00`, is_paid: false },
      ],
    });
    expect(unpaidBreakMinutes(s)).toBe(40);
  });

  it('ignores paid breaks', () => {
    const s = shift({
      breaks: [
        { start_at: `${BD}T12:00:00-07:00`, end_at: `${BD}T12:30:00-07:00`, is_paid: true },
      ],
    });
    expect(unpaidBreakMinutes(s)).toBe(0);
  });

  it('handles mixed paid and unpaid', () => {
    const s = shift({
      breaks: [
        { start_at: `${BD}T12:00:00-07:00`, end_at: `${BD}T12:15:00-07:00`, is_paid: true },
        { start_at: `${BD}T12:15:00-07:00`, end_at: `${BD}T12:45:00-07:00`, is_paid: false },
      ],
    });
    expect(unpaidBreakMinutes(s)).toBe(30);
  });
});

describe('workedMinutes', () => {
  it('computes span minutes for a closed shift', () => {
    expect(workedMinutes(shift())).toBe(360); // 10:00–16:00
  });

  it('deducts unpaid break time', () => {
    const s = shift({
      breaks: [
        { start_at: `${BD}T12:00:00-07:00`, end_at: `${BD}T12:30:00-07:00`, is_paid: false },
      ],
    });
    expect(workedMinutes(s)).toBe(330);
  });

  it('keeps paid break time as worked', () => {
    const s = shift({
      breaks: [
        { start_at: `${BD}T12:00:00-07:00`, end_at: `${BD}T12:30:00-07:00`, is_paid: true },
      ],
    });
    expect(workedMinutes(s)).toBe(360);
  });

  it('provisions an OPEN shift up to now', () => {
    const s = shift({
      start_at: `${BD}T10:00:00-07:00`,
      end_at: undefined,
      status: 'OPEN',
    });
    // 10:00 → 13:00 = 180 minutes
    expect(workedMinutes(s, NOW)).toBe(180);
  });

  it('handles an overnight shift (22:00 → 02:00 next day)', () => {
    const s = shift({
      start_at: `${BD}T22:00:00-07:00`,
      end_at: '2026-09-06T02:00:00-07:00',
    });
    expect(workedMinutes(s)).toBe(240);
  });

  it('returns 0 for a not-yet-started OPEN shift', () => {
    const s = shift({ start_at: '2026-09-05T15:00:00-07:00', end_at: undefined, status: 'OPEN' });
    expect(workedMinutes(s, NOW)).toBe(0);
  });
});

describe('shiftCostCents', () => {
  it('multiplies worked minutes by the shift rate', () => {
    // 6h × $18.00 = $108.00
    expect(shiftCostCents(shift())).toBe(10800);
  });

  it('accounts for unpaid breaks in cost', () => {
    const s = shift({
      breaks: [
        { start_at: `${BD}T12:00:00-07:00`, end_at: `${BD}T12:30:00-07:00`, is_paid: false },
      ],
    });
    // 5.5h × $18.00 = $99.00
    expect(shiftCostCents(s)).toBe(9900);
  });

  it('rounds fractional minutes to whole cents deterministically', () => {
    // $15.57/hr × 99 minutes = 2569.05 → 2569 cents
    const s = shift({
      start_at: `${BD}T10:00:00-07:00`,
      end_at: `${BD}T11:39:00-07:00`,
      wage: { hourly_rate: { amount: 1557, currency: 'USD' } },
    });
    expect(shiftCostCents(s)).toBe(2569);
  });

  it('costs 0 when the shift carries no rate', () => {
    const s = shift({ wage: undefined });
    expect(shiftCostCents(s)).toBe(0);
  });
});

describe('shiftBusinessDate', () => {
  it('uses the local start date', () => {
    expect(shiftBusinessDate(shift(), 'America/Los_Angeles')).toBe(BD);
  });

  it('attributes an overnight shift to the day it started', () => {
    const s = shift({ start_at: '2026-09-05T22:00:00-07:00', end_at: '2026-09-06T02:00:00-07:00' });
    expect(shiftBusinessDate(s, 'America/Los_Angeles')).toBe('2026-09-05');
  });
});

describe('salary & tax math', () => {
  it('allocates annual salary across the year', () => {
    // $62,400 / 365 = 171.0136... → 171 dollars... 6240000/365 = 17095.89 → 17096 cents
    expect(salaryDailyCents(6240000)).toBe(17096);
    expect(salaryDailyCents(4000000)).toBe(10959);
  });

  it('estimates employer tax on the wage base', () => {
    expect(taxEstimateCents(100000, 12)).toBe(12000);
    expect(taxEstimateCents(100000, 0)).toBe(0);
  });

  it('formats minutes as H:MM', () => {
    expect(minutesToHM(360)).toBe('6:00');
    expect(minutesToHM(215)).toBe('3:35');
    expect(minutesToHM(45)).toBe('0:45');
  });
});

describe('weekStartDateOf', () => {
  it('buckets a Wednesday into its Sunday week start (SUN config)', () => {
    // 2026-09-09 is a Wednesday; SUN-week start is 2026-09-06
    expect(weekStartDateOf('2026-09-09', 'SUN')).toBe('2026-09-06');
  });

  it('keeps Sunday itself as the week start', () => {
    expect(weekStartDateOf('2026-09-06', 'SUN')).toBe('2026-09-06');
  });

  it('buckets Saturday into the preceding Sunday', () => {
    expect(weekStartDateOf('2026-09-12', 'SUN')).toBe('2026-09-06');
  });

  it('supports MON-start weeks', () => {
    // 2026-09-06 (Sun) belongs to the week starting Mon 2026-08-31
    expect(weekStartDateOf('2026-09-06', 'MON')).toBe('2026-08-31');
  });

  it('crosses month and year boundaries', () => {
    // 2027-01-01 is a Friday; SUN-week start 2026-12-27
    expect(weekStartDateOf('2027-01-01', 'SUN')).toBe('2026-12-27');
  });
});

describe('otPremiumCents', () => {
  it('premiums at half-rate on OT minutes', () => {
    // 60 min OT at $18/hr → 0.5 × 1800 = $9.00
    expect(otPremiumCents(1800, 60)).toBe(900);
  });

  it('is zero with no OT minutes', () => {
    expect(otPremiumCents(1800, 0)).toBe(0);
  });
});

describe('weeklyOvertimeAllocation', () => {
  it('no OT under the weekly threshold', () => {
    const r = weeklyOvertimeAllocation([
      { businessDate: '2026-09-06', minutes: 1500 },
      { businessDate: '2026-09-07', minutes: 900 }, // total 2400 = exactly 40h
    ]);
    expect(r.otMinutes).toEqual([0, 0]);
    expect(r.totalOtMinutes).toBe(0);
  });

  it('OT accrues on the shift crossing 40h, chronologically', () => {
    const r = weeklyOvertimeAllocation([
      { businessDate: '2026-09-09', minutes: 300 }, // Wed — walked THIRD chronologically
      { businessDate: '2026-09-06', minutes: 2100 }, // Sun — first: cum 2100
      { businessDate: '2026-09-07', minutes: 420 }, // Mon — second: cum 2520 → OT 120
    ]);
    // Chronology: sun (0 OT), mon (120 OT: crosses 2400), wed (300 OT: past threshold).
    // Aligned to INPUT order: [wed, sun, mon]
    expect(r.otMinutes).toEqual([300, 0, 120]);
    expect(r.totalOtMinutes).toBe(420);
  });

  it('a single monster week fully OTs the last shift', () => {
    const r = weeklyOvertimeAllocation([
      { businessDate: '2026-09-06', minutes: 2400 },
      { businessDate: '2026-09-10', minutes: 600 }, // all OT
    ]);
    expect(r.otMinutes).toEqual([0, 600]);
    expect(r.totalOtMinutes).toBe(600);
  });
});

// ============================================================================
// ***  READ-ONLY SQUARE MODULE — NO WRITES TO THE SQUARE ACCOUNT, EVER.  ***
//  Writing to Square (create/update/delete/modify) is FORBIDDEN without
//  the operator's explicit written approval. This module may only FETCH data.
// ============================================================================
//
// Pure labor-cost math — no DB, no IO. All functions take plain shift shapes
// and return minutes/cents. Heavily unit-tested; the Shifts-API shapes here
// were verified against production 2026-09-06.

import { localParts } from '../../business-date';
import type { SquareWorkedShift } from './fixtures';

/** Minutes of UNPAID break time on a shift (paid breaks are worked time). */
export function unpaidBreakMinutes(shift: SquareWorkedShift): number {
  let mins = 0;
  for (const b of shift.breaks ?? []) {
    if (b.is_paid) continue;
    const start = new Date(b.start_at).getTime();
    const end = new Date(b.end_at).getTime();
    if (end > start) mins += (end - start) / 60_000;
  }
  return Math.round(mins);
}

/**
 * Minutes worked on a shift. CLOSED shifts bill start→end minus unpaid
 * breaks. OPEN shifts (still clocked in) bill start→`now` minus completed
 * unpaid breaks — a provisional figure recomputed on every sync until the
 * shift closes.
 */
export function workedMinutes(shift: SquareWorkedShift, now: Date = new Date()): number {
  const start = new Date(shift.start_at).getTime();
  const end = shift.end_at ? new Date(shift.end_at).getTime() : now.getTime();
  if (end <= start) return 0;
  const gross = (end - start) / 60_000;
  return Math.max(0, Math.round(gross - unpaidBreakMinutes(shift)));
}

/** Labor cost of a shift: worked minutes × hourly rate (integer cents). */
export function shiftCostCents(shift: SquareWorkedShift, now: Date = new Date()): number {
  const rate = shift.wage?.hourly_rate?.amount ?? 0;
  return Math.round((workedMinutes(shift, now) * rate) / 60);
}

/**
 * The business date a shift belongs to: the LOCAL calendar date of its
 * start time in the restaurant's timezone. An 18:00→02:00 dinner shift
 * belongs to the day it started, per the spec's business-day rules.
 */
export function shiftBusinessDate(shift: SquareWorkedShift, timeZone: string): string {
  const p = localParts(new Date(shift.start_at), timeZone);
  const mm = String(p.month).padStart(2, '0');
  const dd = String(p.day).padStart(2, '0');
  return `${p.year}-${mm}-${dd}`;
}

/** Daily salary allocation: annual salary spread evenly across the year. */
export function salaryDailyCents(salaryAnnualCents: number): number {
  return Math.round(salaryAnnualCents / 365);
}

/** Employer-tax estimate on top of the wage base (configurable %). */
export function taxEstimateCents(wageBaseCents: number, taxPct: number): number {
  return Math.round((wageBaseCents * taxPct) / 100);
}

/** Format minutes as `H:MM` hours for display. */
export function minutesToHM(mins: number): string {
  const h = Math.floor(mins / 60);
  const m = mins % 60;
  return `${h}:${String(m).padStart(2, '0')}`;
}

// ── Overtime (workweek bucketing) ────────────────────────────────────────────

const DAY_ORDER = ['SUN', 'MON', 'TUE', 'WED', 'THU', 'FRI', 'SAT'] as const;
export type DayCode = (typeof DAY_ORDER)[number];

/**
 * The week-start business date (YYYY-MM-DD) a business date belongs to,
 * given the workweek start day from Square's workweek config. Example with
 * SUN weeks: 2026-09-09 (Wed) → week of 2026-09-06.
 */
export function weekStartDateOf(
  businessDate: string,
  weekStartDay: DayCode,
): string {
  const startIndex = DAY_ORDER.indexOf(weekStartDay);
  const d = new Date(`${businessDate}T12:00:00Z`); // noon UTC = same civil date
  const dow = d.getUTCDay(); // 0=Sun … 6=Sat
  const back = (dow - startIndex + 7) % 7;
  d.setUTCDate(d.getUTCDate() - back);
  const mm = String(d.getUTCMonth() + 1).padStart(2, '0');
  const dd = String(d.getUTCDate()).padStart(2, '0');
  return `${d.getUTCFullYear()}-${mm}-${dd}`;
}

/** Overtime premium owed on OT minutes: 0.5 × rate × minutes (the straight 1.0× is already counted). */
export function otPremiumCents(hourlyRateCents: number, otMinutes: number): number {
  return Math.round((otMinutes * hourlyRateCents * 0.5) / 60);
}

/**
 * Distribute a person's weekly minutes into straight vs overtime, walking
 * shifts in chronological order (FIFO hours): minutes beyond the weekly
 * threshold accrue as OT on the shift that crosses into them.
 *
 * Returns OT minutes PER SHIFT, aligned to the INPUT array order (sorting
 * happens internally by businessDate), plus the weekly OT total.
 */
export function weeklyOvertimeAllocation(
  shifts: { businessDate: string; minutes: number }[],
  weeklyThresholdMinutes: number = 2400,
): { otMinutes: number[]; totalOtMinutes: number } {
  const order = shifts
    .map((s, i) => ({ i, d: s.businessDate, m: s.minutes }))
    .sort((a, b) => a.d.localeCompare(b.d));

  const otMinutes: number[] = new Array(shifts.length).fill(0);
  let cumulative = 0;
  let totalOtMinutes = 0;

  for (const { i, m } of order) {
    const before = cumulative;
    cumulative += m;
    const otStart = Math.max(before, weeklyThresholdMinutes);
    const ot = cumulative > otStart ? Math.min(m, cumulative - otStart) : 0;
    otMinutes[i] = ot;
    totalOtMinutes += ot;
  }

  return { otMinutes, totalOtMinutes };
}

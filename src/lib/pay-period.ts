// Pay period arithmetic.
//
// A pay period is 14 consecutive business dates starting on a "lattice
// Sunday": a Sunday S is on the lattice iff (S − anchor) mod 14d == 0, where
// the anchor is itself a Sunday (default 2026-08-23).
//
// Implementation contract (see TipSplit-PRD.md, Phase 1.5):
//   - Pure calendar-day arithmetic on YYYY-MM-DD strings, done in UTC day
//     space (Date.UTC + setUTCDate). This is the same discipline as
//     businessDate() in $lib/business-date.
//   - NEVER construct a local Date and NEVER add 14 * 86400000 ms: 2026-11-01
//     is both a lattice start and the PDT→PST transition, and millisecond
//     math silently shifts every period from mid-November on.
//   - The lattice is timezone-independent. Only "which period is current"
//     needs a zone, and that resolution happens at the call site via
//     businessDate(now, settings.timezone).
//   - Every function is a pure function of its arguments (no hidden
//     new Date()), so the whole module is testable with literals.

import { businessDate } from './business-date';

export const PERIOD_LENGTH_DAYS = 14;

/** Default pay period anchor: a Sunday. Period 2026-08-23 → 2026-09-05. */
export const DEFAULT_PAY_PERIOD_ANCHOR = '2026-08-23';

export type PeriodStatus = 'past' | 'current' | 'upcoming';

const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

/** True for a well-formed YYYY-MM-DD string (calendar validity included). */
export function isValidDateStr(s: string): boolean {
  if (!DATE_RE.test(s)) return false;
  const [y, m, d] = s.split('-').map(Number);
  const dt = new Date(Date.UTC(y, m - 1, d));
  return (
    dt.getUTCFullYear() === y &&
    dt.getUTCMonth() === m - 1 &&
    dt.getUTCDate() === d
  );
}

/** Days from a to b (positive if b is after a). Calendar-day exact. */
function daysBetween(a: string, b: string): number {
  const [ay, am, ad] = a.split('-').map(Number);
  const [by, bm, bd] = b.split('-').map(Number);
  return Math.round(
    (Date.UTC(by, bm - 1, bd) - Date.UTC(ay, am - 1, ad)) / 86400000,
  );
}

/** Add n calendar days (n may be negative) to a YYYY-MM-DD string. */
export function addDays(date: string, n: number): string {
  const [y, m, d] = date.split('-').map(Number);
  const dt = new Date(Date.UTC(y, m - 1, d));
  dt.setUTCDate(dt.getUTCDate() + n);
  return (
    dt.getUTCFullYear() +
    '-' +
    String(dt.getUTCMonth() + 1).padStart(2, '0') +
    '-' +
    String(dt.getUTCDate()).padStart(2, '0')
  );
}

/** True if the date is a Sunday. */
export function isSunday(date: string): boolean {
  const [y, m, d] = date.split('-').map(Number);
  return new Date(Date.UTC(y, m - 1, d)).getUTCDay() === 0;
}

/** True if `date` is a period start on the lattice defined by `anchor`. */
export function isOnLattice(date: string, anchor: string): boolean {
  if (!isSunday(date)) return false;
  const diff = daysBetween(anchor, date);
  return diff % PERIOD_LENGTH_DAYS === 0;
}

/**
 * The period start (a lattice Sunday) that contains `date`.
 * Pure calendar arithmetic; DST-proof by construction.
 */
export function periodStartFor(date: string, anchor: string): string {
  const diff = daysBetween(anchor, date);
  const offset = ((diff % PERIOD_LENGTH_DAYS) + PERIOD_LENGTH_DAYS) % PERIOD_LENGTH_DAYS;
  return addDays(date, -offset);
}

/** Exclusive end of the period: start + 14 days. Use `date < end` in queries. */
export function periodEndExclusive(start: string): string {
  return addDays(start, PERIOD_LENGTH_DAYS);
}

/** 1-based day of the period (1..14) for a date inside the period. */
export function dayOfPeriod(date: string, start: string): number {
  return daysBetween(start, date) + 1;
}

export function periodStatus(start: string, today: string): PeriodStatus {
  const end = periodEndExclusive(start);
  if (today < start) return 'upcoming';
  if (today >= end) return 'past';
  return 'current';
}

/**
 * All period starts overlapping the inclusive range [from, to], ascending.
 * The first start is the period containing `from`; generation stops at the
 * last start ≤ `to`.
 */
export function periodRange(from: string, to: string, anchor: string): string[] {
  const starts: string[] = [];
  let s = periodStartFor(from, anchor);
  while (s <= to) {
    starts.push(s);
    s = addDays(s, PERIOD_LENGTH_DAYS);
  }
  return starts;
}

/**
 * The current period start for `now` in `timeZone`: resolve the business
 * date first (3 AM rollover), then the lattice.
 */
export function currentPeriodStart(
  now: Date,
  timeZone: string,
  anchor: string,
): string {
  return periodStartFor(businessDate(now, timeZone), anchor);
}

/**
 * Human label for a period, e.g. "Aug 9 – Aug 22, 2026" (or
 * "Dec 27, 2026 – Jan 9, 2027" across a year boundary).
 * Formatted in UTC so the calendar date is never shifted by the host TZ.
 */
export function formatPeriodLabel(start: string): string {
  const end = addDays(start, PERIOD_LENGTH_DAYS - 1);
  const [sy, sm, sd] = start.split('-').map(Number);
  const [ey, em, ed] = end.split('-').map(Number);
  const monthDay = (y: number, m: number, d: number) =>
    new Intl.DateTimeFormat('en-US', {
      timeZone: 'UTC',
      month: 'short',
      day: 'numeric',
    }).format(new Date(Date.UTC(y, m - 1, d)));
  if (sy === ey) return `${monthDay(sy, sm, sd)} – ${monthDay(ey, em, ed)}, ${sy}`;
  return `${monthDay(sy, sm, sd)}, ${sy} – ${monthDay(ey, em, ed)}, ${ey}`;
}

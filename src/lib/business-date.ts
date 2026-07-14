// Business-day date handling.
//
// A restaurant's "business day" is not the same as the calendar day: service
// that runs past midnight still belongs to the previous day's books. We roll
// the business date over at 3 AM local time, so late-night close-outs record
// against the day the shift started rather than jumping to tomorrow.
//
// All wall-clock reasoning is done in a configurable IANA timezone (default
// America/Los_Angeles) so the app is correct regardless of the server's own
// clock — the previous code used UTC and showed tomorrow's date after ~5 PM
// Pacific.

export const DEFAULT_TIMEZONE = 'America/Los_Angeles';

/** Hour (local time) at which the business day rolls over to the next date. */
export const DEFAULT_ROLLOVER_HOUR = 3;

export interface LocalParts {
  year: number;   // full year, e.g. 2026
  month: number;  // 1-12
  day: number;    // 1-31
  hour: number;   // 0-23
  minute: number; // 0-59
}

/** Wall-clock parts of `now` as observed in `timeZone`. */
export function localParts(now: Date, timeZone: string): LocalParts {
  const parts = new Intl.DateTimeFormat('en-US', {
    timeZone,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    hourCycle: 'h23', // 00-23; avoids the "24" that hour12:false can emit at midnight
  }).formatToParts(now);
  const get = (type: string) => parts.find((p) => p.type === type)!.value;
  return {
    year: parseInt(get('year'), 10),
    month: parseInt(get('month'), 10),
    day: parseInt(get('day'), 10),
    hour: parseInt(get('hour'), 10),
    minute: parseInt(get('minute'), 10),
  };
}

function pad2(n: number): string {
  return String(n).padStart(2, '0');
}

/**
 * The current business date (YYYY-MM-DD) in `timeZone`. Between midnight and
 * `rolloverHour` local time the date is still the previous calendar day.
 *
 * Day subtraction is done as pure calendar arithmetic (via UTC on the plain
 * Y/M/D components), so month/year boundaries and DST transitions are handled
 * without offset math.
 */
export function businessDate(
  now: Date,
  timeZone: string,
  rolloverHour: number = DEFAULT_ROLLOVER_HOUR,
): string {
  const { year, month, day, hour } = localParts(now, timeZone);
  let y = year;
  let m = month;
  let d = day;
  if (hour < rolloverHour) {
    const prev = new Date(Date.UTC(year, month - 1, day));
    prev.setUTCDate(prev.getUTCDate() - 1);
    y = prev.getUTCFullYear();
    m = prev.getUTCMonth() + 1;
    d = prev.getUTCDate();
  }
  return `${y}-${pad2(m)}-${pad2(d)}`;
}

/**
 * Which shift to default the tip-entry form to, based on the wall clock in
 * `timeZone`. Between the lunch cutoff and the 3 AM rollover (i.e. dinner
 * service and the late-night close-out) it's Dinner; the rest of the day is
 * Lunch.
 */
export function defaultShift(
  now: Date,
  timeZone: string,
  lunchCutoff: string,
  rolloverHour: number = DEFAULT_ROLLOVER_HOUR,
): 'Lunch' | 'Dinner' {
  const { hour, minute } = localParts(now, timeZone);
  const [cutoffH, cutoffM] = (lunchCutoff || '15:00').split(':').map(Number);
  const afterLunchCutoff = hour > cutoffH || (hour === cutoffH && minute >= cutoffM);
  const beforeRollover = hour < rolloverHour;
  return afterLunchCutoff || beforeRollover ? 'Dinner' : 'Lunch';
}

/** True if `tz` is an IANA timezone the runtime understands. */
export function isValidTimeZone(tz: string): boolean {
  if (!tz) return false;
  try {
    new Intl.DateTimeFormat('en-US', { timeZone: tz });
    return true;
  } catch {
    return false;
  }
}

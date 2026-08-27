import type { PageServerLoad } from './$types';
import { error, redirect } from '@sveltejs/kit';
import db from '$lib/server/db';
import { requireManager, getSettings } from '$lib/server/auth';
import {
  isValidDateStr,
  isOnLattice,
  periodStartFor,
  periodStatus,
  periodRange,
  formatPeriodLabel,
  dayOfPeriod,
  PERIOD_LENGTH_DAYS,
  DEFAULT_PAY_PERIOD_ANCHOR,
} from '$lib/pay-period';
import { businessDate, DEFAULT_TIMEZONE } from '$lib/business-date';
import { getPeriodReport, getPeriodTotals } from '$lib/server/pay-period-report';

// Reportable range: back to the first period overlapping June 2026,
// forward to the last period starting in the current year.
const RANGE_FROM = '2026-06-01';

export const load: PageServerLoad = ({ locals, params, url }) => {
  requireManager(locals);

  const settings = getSettings();
  const anchor = settings.pay_period_anchor ?? DEFAULT_PAY_PERIOD_ANCHOR;
  const tz = settings.timezone ?? DEFAULT_TIMEZONE;
  const today = businessDate(new Date(), tz);
  const yearEnd = `${today.slice(0, 4)}-12-31`;

  const raw = String(params.period ?? '');
  if (!isValidDateStr(raw)) error(404, 'Unknown pay period');

  // Off-lattice dates (e.g. a hand-typed Monday) canonicalize to the
  // containing period instead of erroring.
  const start = isOnLattice(raw, anchor) ? raw : periodStartFor(raw, anchor);

  const range = periodRange(RANGE_FROM, yearEnd, anchor);
  const first = range[0];
  const last = range[range.length - 1];
  if (start < first) redirect(303, `/admin/tips/${first}`);
  if (start > last) redirect(303, `/admin/tips/${last}`);

  const includeVoided = url.searchParams.get('v') === '1';
  const report = getPeriodReport(db, start, { includeVoided });
  const totals = getPeriodTotals(db, range, { includeVoided });

  const idx = range.indexOf(start);
  const status = periodStatus(start, today);

  return {
    periodStart: start,
    label: formatPeriodLabel(start),
    status,
    today,
    dayOfPeriod: status === 'current' ? dayOfPeriod(today, start) : null,
    periodLength: PERIOD_LENGTH_DAYS,
    range,
    index: idx,
    prev: idx > 0 ? range[idx - 1] : null,
    next: idx < range.length - 1 ? range[idx + 1] : null,
    totals: Object.fromEntries(totals),
    report,
    timeZone: tz,
  };
};

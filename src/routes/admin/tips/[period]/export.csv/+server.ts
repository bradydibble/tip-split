import type { RequestHandler } from './$types';
import { error, redirect, text } from '@sveltejs/kit';
import db from '$lib/server/db';
import { requireManager, getSettings } from '$lib/server/auth';
import {
  isValidDateStr,
  isOnLattice,
  periodStartFor,
  periodRange,
  formatPeriodLabel,
  DEFAULT_PAY_PERIOD_ANCHOR,
} from '$lib/pay-period';
import { businessDate, DEFAULT_TIMEZONE } from '$lib/business-date';
import { getPeriodReport, buildReportCsv } from '$lib/server/pay-period-report';

const RANGE_FROM = '2026-06-01';

// GET /admin/tips/[period]/export.csv — manager-gated CSV download.
// (A layout guard cannot protect a +server.ts handler, so the gate is here.)
export const GET: RequestHandler = ({ request, locals, params }) => {
  requireManager(locals);

  const settings = getSettings();
  const anchor = settings.pay_period_anchor ?? DEFAULT_PAY_PERIOD_ANCHOR;
  const tz = settings.timezone ?? DEFAULT_TIMEZONE;
  const today = businessDate(new Date(), tz);
  const yearEnd = `${today.slice(0, 4)}-12-31`;

  const raw = String(params.period ?? '');
  if (!isValidDateStr(raw)) error(404, 'Unknown pay period');
  const start = isOnLattice(raw, anchor) ? raw : periodStartFor(raw, anchor);

  const range = periodRange(RANGE_FROM, yearEnd, anchor);
  if (start < range[0] || start > range[range.length - 1]) {
    redirect(303, `/admin/tips/${start > range[range.length - 1] ? range[range.length - 1] : range[0]}/export.csv`);
  }

  const report = getPeriodReport(db, start, {
    includeVoided: request.url.includes('v=1'),
  });

  const csv = buildReportCsv({
    periodStart: start,
    rows: report.rows,
    voidedExcludedCount: report.voidedExcludedCount,
    generatedAt: new Date(),
    timeZone: tz,
  });

  const label = formatPeriodLabel(start).replace(/[^\w-]+/g, '_');
  return text(csv, {
    headers: {
      'Content-Type': 'text/csv; charset=utf-8',
      'Content-Disposition': `attachment; filename="tipsplit_${start}_${label}.csv"`,
    },
  });
};

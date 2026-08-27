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
  DEFAULT_PAY_PERIOD_ANCHOR,
} from '$lib/pay-period';
import { businessDate, DEFAULT_TIMEZONE } from '$lib/business-date';
import { getStaffPeriodDetail } from '$lib/server/pay-period-report';

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
  const start = isOnLattice(raw, anchor) ? raw : periodStartFor(raw, anchor);

  const range = periodRange(RANGE_FROM, yearEnd, anchor);
  if (start < range[0] || start > range[range.length - 1]) {
    redirect(303, `/admin/tips/${start > range[range.length - 1] ? range[range.length - 1] : range[0]}`);
  }

  const code = String(params.code ?? '');
  const detail = getStaffPeriodDetail(db, start, code, {
    includeVoided: url.searchParams.get('v') === '1',
  });
  if (!detail) error(404, 'Staff member not found');

  return {
    periodStart: start,
    label: formatPeriodLabel(start),
    status: periodStatus(start, today),
    includeVoided: url.searchParams.get('v') === '1',
    detail,
  };
};

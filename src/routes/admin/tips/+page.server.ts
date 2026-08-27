import type { PageServerLoad } from './$types';
import { redirect } from '@sveltejs/kit';
import { requireManager, getSettings } from '$lib/server/auth';
import { currentPeriodStart, DEFAULT_PAY_PERIOD_ANCHOR } from '$lib/pay-period';
import { DEFAULT_TIMEZONE } from '$lib/business-date';

// /admin/tips → canonical URL for the current period.
export const load: PageServerLoad = ({ locals }) => {
  requireManager(locals);

  const settings = getSettings();
  const anchor = settings.pay_period_anchor ?? DEFAULT_PAY_PERIOD_ANCHOR;
  const tz = settings.timezone ?? DEFAULT_TIMEZONE;

  const start = currentPeriodStart(new Date(), tz, anchor);
  redirect(303, `/admin/tips/${start}`);
};

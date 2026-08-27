import type { Actions, PageServerLoad } from './$types';
import { fail, redirect } from '@sveltejs/kit';
import db from '$lib/server/db';
import { getSettings } from '$lib/server/auth';
import { isValidTimeZone, DEFAULT_TIMEZONE } from '$lib/business-date';
import { isValidDateStr, isSunday, DEFAULT_PAY_PERIOD_ANCHOR } from '$lib/pay-period';

export const load: PageServerLoad = ({ locals }) => {
  if (!locals.user) redirect(303, '/');
  if (locals.user.role !== 'manager') redirect(303, '/calculate');
  return { settings: getSettings() };
};

export const actions: Actions = {
  saveSettings: async ({ request, locals }) => {
    if (!locals.user || locals.user.role !== 'manager') {
      return fail(403, { error: 'Manager access required' });
    }

    const fd = await request.formData();

    const ccFeeRate   = parseFloat(String(fd.get('cc_fee_rate')   ?? ''));
    const kitchenPct  = parseFloat(String(fd.get('kitchen_pct')   ?? ''));
    const barLiquorPct = parseFloat(String(fd.get('bar_liquor_pct') ?? ''));
    const busserRate  = parseFloat(String(fd.get('busser_rate')   ?? ''));

    if (isNaN(ccFeeRate)    || ccFeeRate    < 0 || ccFeeRate    > 100)
      return fail(400, { error: 'CC fee rate must be between 0 and 100' });
    if (isNaN(kitchenPct)   || kitchenPct   < 0 || kitchenPct   > 100)
      return fail(400, { error: 'Kitchen % must be between 0 and 100' });
    if (isNaN(barLiquorPct) || barLiquorPct < 0 || barLiquorPct > 100)
      return fail(400, { error: 'Bar liquor % must be between 0 and 100' });
    if (isNaN(busserRate)   || busserRate   < 0)
      return fail(400, { error: 'Busser rate must be $0 or more' });
    if (kitchenPct + barLiquorPct > 100)
      return fail(400, { error: 'Kitchen % and bar liquor % cannot exceed 100% combined' });

    const timezone = String(fd.get('timezone') ?? DEFAULT_TIMEZONE);
    if (!isValidTimeZone(timezone))
      return fail(400, { error: 'Invalid timezone' });

    // Pay period anchor: the first Sunday of the lattice. Must be a real
    // calendar Sunday — a wrong anchor silently shifts every payroll period.
    const anchor = String(fd.get('pay_period_anchor') ?? DEFAULT_PAY_PERIOD_ANCHOR);
    if (!isValidDateStr(anchor) || !isSunday(anchor))
      return fail(400, { error: 'Pay period anchor must be a Sunday (YYYY-MM-DD)' });

    const updates: [string, string][] = [
      ['cc_fee_rate',                  String(ccFeeRate)],
      ['kitchen_pct',                  String(kitchenPct)],
      ['bar_liquor_pct',               String(barLiquorPct)],
      ['busser_rate',                  String(busserRate)],
      ['lunch_cutoff',                 String(fd.get('lunch_cutoff') ?? '15:00')],
      ['timezone',                     timezone],
      ['restaurant_name',              String(fd.get('restaurant_name') ?? '')],
      ['google_sheets_spreadsheet_id', String(fd.get('google_sheets_spreadsheet_id') ?? '')],
      ['google_sheets_sheet_name',     String(fd.get('google_sheets_sheet_name') ?? '')],
      ['pay_period_anchor',            anchor],
    ];

    const upsert = db.prepare(
      'INSERT INTO settings (key, value) VALUES (?,?) ON CONFLICT(key, location_id) DO UPDATE SET value=excluded.value'
    );
    const saveAll = db.transaction(() => {
      for (const [k, v] of updates) upsert.run(k, v);
    });
    saveAll();

    return { success: true };
  },
};

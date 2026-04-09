import type { Actions, PageServerLoad } from './$types';
import { fail, redirect } from '@sveltejs/kit';
import db from '$lib/server/db';
import { getSettings } from '$lib/server/auth';

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

    if (isNaN(ccFeeRate)    || ccFeeRate    < 0 || ccFeeRate    > 100)
      return fail(400, { error: 'CC fee rate must be between 0 and 100' });
    if (isNaN(kitchenPct)   || kitchenPct   < 0 || kitchenPct   > 100)
      return fail(400, { error: 'Kitchen % must be between 0 and 100' });
    if (isNaN(barLiquorPct) || barLiquorPct < 0 || barLiquorPct > 100)
      return fail(400, { error: 'Bar liquor % must be between 0 and 100' });
    if (kitchenPct + barLiquorPct > 100)
      return fail(400, { error: 'Kitchen % and bar liquor % cannot exceed 100% combined' });

    const updates: [string, string][] = [
      ['cc_fee_rate',                  String(ccFeeRate)],
      ['kitchen_pct',                  String(kitchenPct)],
      ['bar_liquor_pct',               String(barLiquorPct)],
      ['lunch_cutoff',                 String(fd.get('lunch_cutoff') ?? '15:00')],
      ['restaurant_name',              String(fd.get('restaurant_name') ?? '')],
      ['google_sheets_spreadsheet_id', String(fd.get('google_sheets_spreadsheet_id') ?? '')],
      ['google_sheets_sheet_name',     String(fd.get('google_sheets_sheet_name') ?? '')],
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

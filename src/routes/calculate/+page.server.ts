import type { Actions, PageServerLoad } from './$types';
import { fail, redirect } from '@sveltejs/kit';
import db from '$lib/server/db';
import { getSettings } from '$lib/server/auth';
import { calculate, dollarsToCents } from '$lib/calculator';
import type { StaffRow } from '$lib/server/db';

export const load: PageServerLoad = ({ locals }) => {
  if (!locals.user) redirect(303, '/');

  const staff = db.prepare(
    'SELECT * FROM staff WHERE active = 1 AND location_id = 1 ORDER BY role, name'
  ).all() as StaffRow[];

  const settings = getSettings();
  const today = new Date().toISOString().split('T')[0];
  const cutoffHour = parseInt(settings.lunch_cutoff?.split(':')[0] ?? '15', 10);
  // Convert Pacific time: UTC-7 (PDT) or UTC-8 (PST) — approximate with UTC-7
  const pacificHour = (new Date().getUTCHours() - 7 + 24) % 24;
  const defaultShift = pacificHour >= cutoffHour ? 'Dinner' : 'Lunch';

  return { staff, settings, today, defaultShift, user: locals.user };
};

export const actions: Actions = {
  calculate: async ({ request, locals }) => {
    if (!locals.user) redirect(303, '/');

    const fd = await request.formData();
    const date        = String(fd.get('date') ?? '');
    const shift       = String(fd.get('shift') ?? '');
    const grossRaw    = String(fd.get('gross_tips') ?? '');
    const liquorRaw   = String(fd.get('liquor_sales') ?? '0');
    const includedIds = new Set(fd.getAll('included').map(String));

    if (!date) return fail(400, { error: 'Date is required' });
    if (!['Lunch', 'Dinner'].includes(shift)) return fail(400, { error: 'Select a shift' });
    if (!grossRaw) return fail(400, { error: 'Enter gross tips' });

    const grossTipsCents   = dollarsToCents(grossRaw);
    const liquorSalesCents = dollarsToCents(liquorRaw || '0');

    if (isNaN(grossTipsCents) || grossTipsCents < 0) {
      return fail(400, { error: 'Invalid tip amount' });
    }

    const allStaff = db.prepare(
      'SELECT * FROM staff WHERE active = 1 AND location_id = 1'
    ).all() as StaffRow[];

    const staff = allStaff.filter(s => includedIds.has(String(s.id)));
    if (staff.length === 0) return fail(400, { error: 'Select at least one staff member' });

    const settings = getSettings();
    const config = {
      ccFeeRate:    parseFloat(settings.cc_fee_rate)    / 100,
      kitchenPct:   parseFloat(settings.kitchen_pct)    / 100,
      barLiquorPct: parseFloat(settings.bar_liquor_pct) / 100,
    };

    const result = calculate({
      grossTipsCents,
      liquorSalesCents,
      staff: staff.map(s => ({ id: s.id, name: s.name, role: s.role })),
      config,
    });

    const insertCalc = db.prepare(`
      INSERT INTO tip_calculations
        (date, shift, gross_tips_cents, liquor_sales_cents, cc_fee_rate, kitchen_pct,
         bar_liquor_pct, cc_fees_cents, tips_after_fees_cents, kitchen_pool_cents,
         bar_pool_cents, foh_pool_cents)
      VALUES (?,?,?,?,?,?,?,?,?,?,?,?)
    `);

    const insertDist = db.prepare(`
      INSERT INTO tip_distributions
        (calculation_id, staff_id, name, role, foh_share_cents,
         bar_pool_share_cents, kitchen_share_cents, total_cents)
      VALUES (?,?,?,?,?,?,?,?)
    `);

    const calcId = db.transaction(() => {
      const { lastInsertRowid } = insertCalc.run(
        date, shift, result.grossTipsCents, result.liquorSalesCents,
        config.ccFeeRate, config.kitchenPct, config.barLiquorPct,
        result.ccFeesCents, result.tipsAfterFeesCents,
        result.kitchenPoolCents, result.barPoolCents, result.fohPoolCents
      );
      for (const d of result.distributions) {
        insertDist.run(
          lastInsertRowid, d.staffId, d.name, d.role,
          d.fohShareCents, d.barPoolShareCents, d.kitchenShareCents, d.totalCents
        );
      }
      return lastInsertRowid;
    })();

    redirect(303, `/calculate/${calcId}`);
  },

  addStaff: async ({ request, locals }) => {
    if (!locals.user) redirect(303, '/');

    const fd = await request.formData();
    const name = String(fd.get('name') ?? '').trim();
    const role = String(fd.get('role') ?? '');

    if (!name) return fail(400, { addError: 'Name is required' });
    if (!['FOH', 'Kitchen', 'Bar'].includes(role)) return fail(400, { addError: 'Invalid role' });

    const { lastInsertRowid } = db.prepare(
      'INSERT INTO staff (name, role) VALUES (?, ?)'
    ).run(name, role);

    return { addedId: Number(lastInsertRowid), addedName: name };
  },
};

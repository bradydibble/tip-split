import type { Actions, PageServerLoad } from './$types';
import { fail, redirect } from '@sveltejs/kit';
import db from '$lib/server/db';
import { getSettings } from '$lib/server/auth';
import { calculate, dollarsToCents } from '$lib/calculator';
import { businessDate, defaultShift, DEFAULT_TIMEZONE } from '$lib/business-date';
import { isValidDateStr, addDays } from '$lib/pay-period';
import { nextStaffCode } from '$lib/server/staff-code';
import type { StaffRow } from '$lib/server/db';
import { readRoleAssignments, STAFF_ROLES, type StaffRole } from '$lib/staff-role-selection';

export const load: PageServerLoad = ({ locals }) => {
  if (!locals.user) redirect(303, '/');

  const staff = db.prepare(
    'SELECT * FROM staff WHERE active = 1 AND location_id = 1 ORDER BY role, name'
  ).all() as StaffRow[];

  const settings = getSettings();
  const timeZone = settings.timezone ?? DEFAULT_TIMEZONE;
  const now = new Date();
  // Business day, not calendar day: late-night close-outs stay on the prior
  // date until 3 AM local time (see $lib/business-date).
  const today = businessDate(now, timeZone);
  const shift = defaultShift(now, timeZone, settings.lunch_cutoff ?? '15:00');

  return { staff, settings, today, defaultShift: shift, user: locals.user };
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
    const roleAssignments = readRoleAssignments(fd, includedIds);

    if (!date) return fail(400, { error: 'Date is required' });
    if (!['Lunch', 'Dinner'].includes(shift)) return fail(400, { error: 'Select a shift' });
    if (!grossRaw) return fail(400, { error: 'Enter gross tips' });
    if (!roleAssignments.ok && roleAssignments.error === 'missing')
      return fail(400, { error: 'Role required for each selected staff' });
    if (!roleAssignments.ok)
      return fail(400, { error: 'Invalid role' });

    const settings = getSettings();
    const timeZone = settings.timezone ?? DEFAULT_TIMEZONE;
    if (!isValidDateStr(date)) return fail(400, { error: 'Invalid date' });
    if (date < '2000-01-01' || date > '2099-12-31')
      return fail(400, { error: 'Date must be between 2000 and 2099' });
    if (date > addDays(businessDate(new Date(), timeZone), 90))
      return fail(400, { error: 'Date cannot be more than 90 days in the future' });

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
    if (staff.length !== includedIds.size)
      return fail(400, { error: 'One or more selected staff members are unavailable' });

    // Each role is addressed by staff ID, so database and visual ordering
    // cannot move a role assignment to another person.
    const staffWithRoles = staff.map((s) => ({
      id: s.id,
      name: s.name,
      role: roleAssignments.roles.get(String(s.id)) as StaffRole,
    }));

    const config = {
      ccFeeRate:       parseFloat(settings.cc_fee_rate)    / 100,
      kitchenPct:      parseFloat(settings.kitchen_pct)    / 100,
      barLiquorPct:    parseFloat(settings.bar_liquor_pct) / 100,
      busserRateCents: dollarsToCents(settings.busser_rate ?? '20'),
    };

    const result = calculate({
      grossTipsCents,
      liquorSalesCents,
      staff: staffWithRoles,
      config,
    });

    const insertCalc = db.prepare(`
      INSERT INTO tip_calculations
        (date, shift, gross_tips_cents, liquor_sales_cents, cc_fee_rate, kitchen_pct,
         bar_liquor_pct, cc_fees_cents, tips_after_fees_cents, kitchen_pool_cents,
         bar_pool_cents, busser_pool_cents, foh_pool_cents)
      VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?)
    `);

    const insertDist = db.prepare(`
      INSERT INTO tip_distributions
        (calculation_id, staff_id, staff_code, name, role, foh_share_cents,
         bar_pool_share_cents, kitchen_share_cents, busser_share_cents, total_cents)
      VALUES (?, ?, (SELECT staff_code FROM staff WHERE id = ?), ?, ?, ?, ?, ?, ?, ?)
    `);

    const calcId = db.transaction(() => {
      const { lastInsertRowid } = insertCalc.run(
        date, shift, result.grossTipsCents, result.liquorSalesCents,
        config.ccFeeRate, config.kitchenPct, config.barLiquorPct,
        result.ccFeesCents, result.tipsAfterFeesCents,
        result.kitchenPoolCents, result.barPoolCents, result.busserPoolCents, result.fohPoolCents
      );
      for (const d of result.distributions) {
        insertDist.run(
          lastInsertRowid, d.staffId, d.staffId, d.name, d.role,
          d.fohShareCents, d.barPoolShareCents, d.kitchenShareCents, d.busserShareCents, d.totalCents
        );
        // Phase 2 — persist the per-shift role on shift_assignments so the
        // adjustment audit can resolve "what role did this person perform".
        db.prepare(
          'INSERT INTO shift_assignments (staff_id, date, shift, effective_role) VALUES (?, ?, ?, ?)'
        ).run(d.staffId, date, shift, d.role);
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
    if (!STAFF_ROLES.includes(role as StaffRole)) return fail(400, { addError: 'Invalid role' });

    // Code claimed inside the insert transaction (rolls back on failure).
    const { lastInsertRowid } = db.transaction(() => {
      const code = nextStaffCode();
      return db.prepare('INSERT INTO staff (name, role, staff_code) VALUES (?, ?, ?)').run(name, role, code);
    })();

    return { addedId: Number(lastInsertRowid), addedName: name };
  },
};

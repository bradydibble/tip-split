import type { Actions, PageServerLoad } from './$types';
import { error, fail, redirect } from '@sveltejs/kit';
import db from '$lib/server/db';
import type { CalcRow, DistRow, ExportLogRow } from '$lib/server/db';
import { getSettings } from '$lib/server/auth';
import { appendToSheet } from '$lib/server/sheets';

export const load: PageServerLoad = ({ locals, params }) => {
  if (!locals.user) redirect(303, '/');

  const calc = db.prepare(
    'SELECT * FROM tip_calculations WHERE id = ?'
  ).get(params.id) as CalcRow | undefined;

  if (!calc) error(404, 'Calculation not found');

  const distributions = db.prepare(
    'SELECT * FROM tip_distributions WHERE calculation_id = ?'
  ).all(params.id) as DistRow[];

  const exportLog = db.prepare(
    'SELECT * FROM export_log WHERE calculation_id = ? ORDER BY exported_at DESC'
  ).all(params.id) as ExportLogRow[];

  return { calc, distributions, exportLog };
};

export const actions: Actions = {
  void: async ({ params, locals }) => {
    if (!locals.user || locals.user.role !== 'manager') return fail(403, { error: 'Manager access required' });

    const calc = db.prepare('SELECT * FROM tip_calculations WHERE id = ?').get(params.id) as CalcRow | undefined;
    if (!calc) return fail(404, { error: 'Not found' });
    if (calc.voided) return fail(400, { error: 'Already voided' });

    db.prepare('UPDATE tip_calculations SET voided = 1 WHERE id = ?').run(params.id);

    // Append VOID row to Google Sheets if configured
    const settings = getSettings();
    const spreadsheetId = settings.google_sheets_spreadsheet_id;
    const credJson = process.env.GOOGLE_SERVICE_ACCOUNT_JSON;

    if (spreadsheetId && credJson) {
      try {
        await appendToSheet(
          spreadsheetId,
          settings.google_sheets_sheet_name || 'Tip History',
          [['VOID', calc.date, calc.shift, `Calculation #${calc.id} voided`]],
          credJson
        );
      } catch {
        // Don't block void if Sheets export fails
      }
    }

    redirect(303, '/history');
  },

  adjust: async ({ params, locals, request }) => {
    if (!locals.user || locals.user.role !== 'manager')
      return fail(403, { error: 'Manager access required' });

    const fd = await request.formData();
    const staffId = parseInt(String(fd.get('staffId') ?? ''), 10);
    const adjustmentPercent = parseFloat(String(fd.get('adjustment') ?? ''));
    const reason = String(fd.get('reason') ?? '').trim() || null;

    if (!Number.isFinite(adjustmentPercent))
      return fail(400, { error: 'Invalid adjustment' });

    const calc = db.prepare('SELECT * FROM tip_calculations WHERE id = ?').get(params.id) as CalcRow | undefined;
    if (!calc) return fail(404, { error: 'Not found' });
    if (calc.voided) return fail(400, { error: 'Cannot adjust a voided calculation' });

    // Load this calculation's distributions (the role column is the
    // per-shift effective role, snapshot at calc time).
    const dists = db.prepare(
      'SELECT * FROM tip_distributions WHERE calculation_id = ? ORDER BY id'
    ).all(params.id) as DistRow[];
    const targetDist = dists.find(d => d.staff_id === staffId);
    if (!targetDist) return fail(400, { error: 'Staff member not in this calculation' });

    // Refuse compounding: a row that's already been adjusted cannot be
    // adjusted again — the second adjust would base its percentage on
    // the already-reduced total, silently magnifying the cut. Void +
    // re-enter the calculation if the prior adjustment was wrong.
    if (targetDist.adjustment_cents !== 0)
      return fail(409, { error: 'This person already has an adjustment for this shift. Void the calculation and re-enter it to change it.' });

    const baseTotal = targetDist.total_cents;
    const adjustedTotal = Math.max(0, Math.round(baseTotal * (1 + adjustmentPercent / 100)));
    const withheld = baseTotal - adjustedTotal;
    if (withheld === 0) return fail(400, { error: 'Zero adjustment' });

    // Pool = others in the SAME role for this shift. If solo, redistribute
    // downstream to everyone else (proportional to their current totals).
    const targetRole = targetDist.role;
    let pool = dists.filter(d => d.staff_id !== staffId && d.role === targetRole);
    if (pool.length === 0) pool = dists.filter(d => d.staff_id !== staffId);
    if (pool.length === 0) return fail(400, { error: 'No other staff to redistribute to' });
    const poolTotal = pool.reduce((s, d) => s + d.total_cents, 0);
    if (poolTotal === 0) return fail(400, { error: 'Recipients have zero pool' });

    const userId = locals.user!.id;
    db.transaction(() => {
      // 1) Apply the adjustment to the target distribution (3 args / 3 ?).
      db.prepare('UPDATE tip_distributions SET total_cents = ?, adjustment_cents = ? WHERE id = ?')
        .run(adjustedTotal, -withheld, targetDist.id);

      // 2) Redistribute the withheld cents proportionally. The LAST
      //    recipient absorbs the rounding residual so the sum reconciles
      //    to the penny with `withheld`.
      let distributed = 0;
      const targetIds: number[] = [];
      const amounts: number[] = [];
      pool.forEach((d, i) => {
        const isLast = i === pool.length - 1;
        const share = isLast ? withheld - distributed
                             : Math.round(d.total_cents / poolTotal * withheld);
        distributed += share;
        db.prepare('UPDATE tip_distributions SET total_cents = ? WHERE id = ?')
          .run(d.total_cents + share, d.id);
        if (d.staff_id != null) { targetIds.push(d.staff_id); amounts.push(share); }
      });

      // 3) Audit row. Best-effort shift_assignment linkage: create a
      //    stub assignment if one doesn't exist for this (staff,date,shift)
      //    trio (legacy rows or seeded demo data may lack one).
      let saId = (db.prepare(
        'SELECT id FROM shift_assignments WHERE staff_id = ? AND date = ? AND shift = ?'
      ).get(staffId, calc.date, calc.shift) as { id?: number } | undefined)?.id;
      if (!saId) {
        const info = db.prepare(
          'INSERT INTO shift_assignments (staff_id, date, shift, effective_role) VALUES (?, ?, ?, ?)'
        ).run(staffId, calc.date, calc.shift, targetRole);
        saId = Number(info.lastInsertRowid);
      }
      db.prepare(
        `INSERT INTO adjustment_logs
           (shift_assignment_id, user_id, adjustment_cents, reason, created_at,
            redistribution_target_ids, redistribution_amounts)
         VALUES (?, ?, ?, ?, ?, ?, ?)`
      ).run(saId, userId, -withheld, reason, Math.floor(Date.now() / 1000),
            targetIds.join(','), amounts.join(','));
    })();

    redirect(303, `/calculate/${params.id}`);
  },
};
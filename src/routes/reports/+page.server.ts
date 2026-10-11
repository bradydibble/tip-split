import type { Actions, PageServerLoad } from './$types';
import { fail, redirect } from '@sveltejs/kit';
import db from '$lib/server/db';
import { getSettings } from '$lib/server/auth';
import { DEFAULT_TIMEZONE } from '$lib/business-date';
import { calculate } from '$lib/calculator';
import { resyncReport } from '$lib/server/square/resync';
import { localToUtc } from '$lib/server/square/shift-import';
import type { ShiftReportRow, ShiftReportAttendanceRow } from '$lib/server/db';

export const load: PageServerLoad = ({ locals, url }) => {
  if (!locals.user) redirect(303, '/');

  const businessDate = url.searchParams.get('date');
  const shiftType = url.searchParams.get('shift') as 'Lunch' | 'Dinner' | null;

  const settings = getSettings();
  const timeZone = settings.timezone ?? DEFAULT_TIMEZONE;

  // Get all reports for the selected date (or today if none selected)
  const targetDate = businessDate || new Date().toISOString().slice(0, 10);

  const reports = db.prepare(
    `SELECT * FROM shift_reports
     WHERE business_date = ?
     ORDER BY shift_type`
  ).all(targetDate) as ShiftReportRow[];

  // If a specific report is selected, load its attendance
  let selectedReport: ShiftReportRow | null = null;
  let attendance: (ShiftReportAttendanceRow & { staff_name?: string })[] = [];

  if (reports.length > 0) {
    const report =
      shiftType
        ? reports.find((r) => r.shift_type === shiftType) ?? reports[0]
        : reports[0];

    if (report) {
      selectedReport = report;
      attendance = db.prepare(`
        SELECT a.*, s.name as staff_name
        FROM shift_report_attendance a
        LEFT JOIN staff s ON s.square_team_member_id = a.square_team_member_id
        WHERE a.shift_report_id = ?
        ORDER BY a.inclusion_state, a.name_snapshot
      `).all(report.id) as (ShiftReportAttendanceRow & { staff_name?: string })[];
    }
  }

  // All active staff for the "add unscheduled" picker
  const allActiveStaff = db.prepare(
    `SELECT id, name, role, square_team_member_id, default_tip_split_role, role_mapping_state
     FROM staff WHERE active = 1 AND location_id = 1
     ORDER BY name`
  ).all() as {
    id: number; name: string; role: string;
    square_team_member_id: string | null;
    default_tip_split_role: string | null;
    role_mapping_state: string | null;
  }[];

  // Get the set of staff IDs already in the selected report's attendance
  const attendanceStaffIds = new Set(attendance.map(a => a.staff_id).filter(Boolean));

  return {
    reports,
    selectedReport,
    attendance,
    targetDate,
    timeZone,
    user: locals.user,
    allActiveStaff: allActiveStaff.filter(s => !attendanceStaffIds.has(s.id)),
  };
};

export const actions: Actions = {
  confirmRole: async ({ request, locals }) => {
    if (!locals.user) redirect(303, '/');

    const fd = await request.formData();
    const attendanceId = String(fd.get('attendance_id') ?? '');
    const role = String(fd.get('role') ?? '');

    if (!['FOH', 'BAR', 'BUSSER', 'KITCHEN', 'EXCLUDED'].includes(role)) {
      return fail(400, { error: 'Invalid role' });
    }

    const row = db.prepare('SELECT id FROM shift_report_attendance WHERE id = ?').get(attendanceId);
    if (!row) return fail(404, { error: 'Attendance record not found' });

    // Check report is not finalized
    const report = db.prepare(`
      SELECT r.state FROM shift_report_attendance a
      JOIN shift_reports r ON r.id = a.shift_report_id
      WHERE a.id = ?
    `).get(attendanceId) as { state: string } | undefined;

    if (report?.state === 'FINALIZED') {
      return fail(400, { error: 'Cannot modify a finalized report' });
    }

    db.prepare(`
      UPDATE shift_report_attendance SET
        selected_role = ?, role_confirmed = 1, confirmed_by = ?, confirmed_at = datetime('now')
      WHERE id = ?
    `).run(role, locals.user.id, attendanceId);

    return { confirmed: true };
  },

  resync: async ({ request, locals }) => {
    if (!locals.user) redirect(303, '/');

    const fd = await request.formData();
    const reportId = parseInt(String(fd.get('report_id') ?? ''), 10);
    if (!reportId) return fail(400, { error: 'Report ID required' });

    const report = db.prepare(
      'SELECT * FROM shift_reports WHERE id = ?'
    ).get(reportId) as ShiftReportRow | undefined;
    if (!report) return fail(404, { error: 'Report not found' });

    const settings = getSettings();
    const timeZone = settings.timezone ?? DEFAULT_TIMEZONE;

    // Compute window bounds for the report
    const lunchOpen = localToUtc(report.business_date, '11:00', timeZone);
    const lunchClose = localToUtc(report.business_date, '15:00', timeZone);
    const dinnerClose = localToUtc(report.business_date, '21:00', timeZone);

    const windowStart = report.shift_type === 'Lunch' ? lunchOpen : lunchClose;
    const windowEnd = report.shift_type === 'Lunch' ? lunchClose : dinnerClose;

    const result = await resyncReport(
      reportId,
      report.location_id,
      timeZone,
      windowStart,
      windowEnd,
    );

    if (result.outcome === 'refused_finalized') {
      return fail(400, { error: 'Cannot re-sync a finalized report' });
    }
    if (result.outcome === 'error') {
      return fail(500, { error: result.error ?? 'Re-sync failed' });
    }

    return { resync: result };
  },

  finalize: async ({ request, locals }) => {
    if (!locals.user) redirect(303, '/');

    const fd = await request.formData();
    const reportId = parseInt(String(fd.get('report_id') ?? ''), 10);
    if (!reportId) return fail(400, { error: 'Report ID required' });

    const report = db.prepare('SELECT * FROM shift_reports WHERE id = ?').get(reportId) as ShiftReportRow | undefined;
    if (!report) return fail(404, { error: 'Report not found' });
    if (report.state === 'FINALIZED') return fail(400, { error: 'Already finalized' });

    // Get confirmed attendance
    const attendance = db.prepare(`
      SELECT * FROM shift_report_attendance
      WHERE shift_report_id = ? AND role_confirmed = 1 AND selected_role != 'EXCLUDED'
        AND inclusion_state != 'REMOVED' AND inclusion_state != 'EXCLUDED'
    `).all(reportId) as ShiftReportAttendanceRow[];

    // Require at least one confirmed participant
    if (attendance.length === 0) {
      return fail(400, { error: 'Confirm at least one participant before finalizing' });
    }

    // Check all INCLUDED staff are confirmed
    const unconfirmed = db.prepare(`
      SELECT COUNT(*) AS n FROM shift_report_attendance
      WHERE shift_report_id = ? AND inclusion_state = 'INCLUDED' AND role_confirmed = 0
    `).get(reportId) as { n: number };
    if (unconfirmed.n > 0) {
      return fail(400, { error: `${unconfirmed.n} participant(s) need role confirmation` });
    }

    const settings = getSettings();
    const totalTips = report.square_tips_cents + report.manual_tips_cents;
    const totalLiquor = report.square_liquor_sales_cents + report.manual_liquor_cents;

    // Build staff list for the calculator from confirmed attendance
    const staffWithRoles = attendance.map((a) => {
      // Translate EXCLUDED role: never sent to calculator
      const role = a.selected_role === 'EXCLUDED' ? null : a.selected_role;
      // Map to calculator's role format
      const calcRole =
        role === 'BAR' ? 'Bar' :
        role === 'KITCHEN' ? 'Kitchen' :
        role === 'BUSSER' ? 'Busser' :
        'FOH';
      return {
        id: a.staff_id ?? 0,
        name: a.name_snapshot,
        role: calcRole as 'FOH' | 'Bar' | 'Kitchen' | 'Busser',
      };
    }).filter((s) => s.id > 0);

    const config = {
      ccFeeRate: parseFloat(settings.cc_fee_rate) / 100,
      kitchenPct: parseFloat(settings.kitchen_pct) / 100,
      barLiquorPct: parseFloat(settings.bar_liquor_pct) / 100,
      busserRateCents: Math.round(parseFloat(settings.busser_rate ?? '20') * 100),
    };

    const result = calculate({
      grossTipsCents: totalTips,
      liquorSalesCents: totalLiquor,
      staff: staffWithRoles,
      config,
    });

    // Create the tip calculation and link the report to it
    const calcId = db.transaction(() => {
      const { lastInsertRowid } = db.prepare(`
        INSERT INTO tip_calculations
          (date, shift, gross_tips_cents, liquor_sales_cents, cc_fee_rate, kitchen_pct,
           bar_liquor_pct, cc_fees_cents, tips_after_fees_cents, kitchen_pool_cents,
           bar_pool_cents, busser_pool_cents, foh_pool_cents)
        VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?)
      `).run(
        report.business_date, report.shift_type,
        result.grossTipsCents, result.liquorSalesCents,
        config.ccFeeRate, config.kitchenPct, config.barLiquorPct,
        result.ccFeesCents, result.tipsAfterFeesCents,
        result.kitchenPoolCents, result.barPoolCents,
        result.busserPoolCents, result.fohPoolCents,
      );
      const newCalcId = Number(lastInsertRowid);

      for (const d of result.distributions) {
        db.prepare(`
          INSERT INTO tip_distributions
            (calculation_id, staff_id, staff_code, name, role, foh_share_cents,
             bar_pool_share_cents, kitchen_share_cents, busser_share_cents, total_cents)
          VALUES (?, ?, (SELECT staff_code FROM staff WHERE id = ?), ?, ?, ?, ?, ?, ?, ?)
        `).run(
          newCalcId, d.staffId, d.staffId, d.name, d.role,
          d.fohShareCents, d.barPoolShareCents, d.kitchenShareCents,
          d.busserShareCents, d.totalCents,
        );
      }

      // Link the report to the calculation and finalize
      db.prepare(`
        UPDATE shift_reports SET
          state = 'FINALIZED', final_calculation_id = ?, updated_at = datetime('now')
        WHERE id = ?
      `).run(newCalcId, reportId);

      return newCalcId;
    })();

    redirect(303, `/calculate/${calcId}`);
  },

  adjustManual: async ({ request, locals }) => {
    if (!locals.user) redirect(303, '/');

    const fd = await request.formData();
    const reportId = parseInt(String(fd.get('report_id') ?? ''), 10);
    const manualTips = Math.round(parseFloat(String(fd.get('manual_tips') ?? '0')) * 100);
    const manualLiquor = Math.round(parseFloat(String(fd.get('manual_liquor') ?? '0')) * 100);

    if (isNaN(manualTips) || isNaN(manualLiquor)) {
      return fail(400, { error: 'Invalid manual adjustment values' });
    }

    const report = db.prepare('SELECT state FROM shift_reports WHERE id = ?').get(reportId) as { state: string } | undefined;
    if (!report) return fail(404, { error: 'Report not found' });
    if (report.state === 'FINALIZED') return fail(400, { error: 'Cannot adjust a finalized report' });

    db.prepare(`
      UPDATE shift_reports SET manual_tips_cents = ?, manual_liquor_cents = ?, updated_at = datetime('now')
      WHERE id = ?
    `).run(manualTips, manualLiquor, reportId);

    return { adjusted: true };
  },

  addUnscheduled: async ({ request, locals }) => {
    if (!locals.user) redirect(303, '/');

    const fd = await request.formData();
    const reportId = parseInt(String(fd.get('report_id') ?? ''), 10);
    const staffId = parseInt(String(fd.get('staff_id') ?? ''), 10);

    if (!reportId || !staffId) return fail(400, { error: 'Report ID and staff ID required' });

    const report = db.prepare('SELECT state FROM shift_reports WHERE id = ?').get(reportId) as { state: string } | undefined;
    if (!report) return fail(404, { error: 'Report not found' });
    if (report.state === 'FINALIZED') return fail(400, { error: 'Cannot modify a finalized report' });

    const staff = db.prepare('SELECT id, name, role, square_team_member_id, default_tip_split_role, role_mapping_state FROM staff WHERE id = ?').get(staffId) as
      | { id: number; name: string; role: string; square_team_member_id: string | null; default_tip_split_role: string | null; role_mapping_state: string | null }
      | undefined;
    if (!staff) return fail(404, { error: 'Staff not found' });

    // Check if already in attendance
    if (staff.square_team_member_id) {
      const existing = db.prepare(
        'SELECT id FROM shift_report_attendance WHERE shift_report_id = ? AND square_team_member_id = ?'
      ).get(reportId, staff.square_team_member_id);
      if (existing) return fail(400, { error: `${staff.name} is already in the report` });
    }

    const defaultRole = staff.default_tip_split_role as 'FOH' | 'BAR' | 'BUSSER' | 'KITCHEN' | 'EXCLUDED' | null;
    const inclusionState = staff.role_mapping_state === 'EXCLUDED' || defaultRole === 'EXCLUDED'
      ? 'EXCLUDED'
      : staff.role_mapping_state === 'NEEDS_REVIEW'
        ? 'NEEDS_REVIEW'
        : 'INCLUDED';

    db.prepare(`
      INSERT INTO shift_report_attendance
        (shift_report_id, staff_id, square_team_member_id, square_scheduled_shift_id,
         scheduled_job_id, scheduled_job_title, name_snapshot,
         default_role, inclusion_state)
      VALUES (?, ?, ?, NULL, NULL, 'Manual addition', ?, ?, ?)
    `).run(
      reportId, staff.id, staff.square_team_member_id ?? '',
      staff.name, defaultRole, inclusionState,
    );

    return { addedUnscheduled: staff.name };
  },
};

// ============================================================================
// ***  READ-ONLY SQUARE MODULE — NO WRITES TO THE SQUARE ACCOUNT, EVER.  ***
//  Writing to Square (create/update/delete/modify) is FORBIDDEN without
//  the operator's explicit written approval. This module may only FETCH data.
// ============================================================================
//
// Re-sync from Square — refreshes an unfinalized report with fresh data.
//
// Implements spec §"Report states and idempotency" → Re-sync:
//   1. Fetch fresh scheduled shifts, payments, orders, and catalog classification.
//   2. Save a new immutable sync snapshot with request ranges, record IDs,
//      counts, values, and timestamp.
//   3. Update generated attendance. Preserve explicitly confirmed roles when
//      the person remains scheduled. Flag changed, removed, or newly added
//      staff for re-confirmation.
//   4. Recompute Square-derived tips and liquor sales. Preserve manual
//      adjustments as separate, visible fields.
//   5. Refuse to overwrite a finalized report.

import db from '../db';
import { listPayments, searchOrders, searchScheduledShifts, listCatalog } from './client';
import { partitionShifts, buildAttendance } from './shift-import';
import {
  buildCategoryTree,
  descendantClosure,
  computeLiquorVariationIds,
  classifyOrders,
  sumTips,
} from './catalog';
import { getLiquorCategoryId } from './config';

export type ResyncOutcome =
  | 'updated'
  | 'refused_finalized'
  | 'error';

export interface ResyncResult {
  outcome: ResyncOutcome;
  syncRunId: number | null;
  squareTipsCents: number;
  squareLiquorCents: number;
  attendanceChanges: {
    added: number;
    removed: number;
    rolePreserved: number;
    needsReconfirm: number;
  };
  paymentsCount: number;
  ordersCount: number;
  error?: string;
}

/**
 * Re-sync an unfinalized report from Square.
 *
 * Refuses to overwrite a FINALIZED report. Returns `refused_finalized`.
 */
export async function resyncReport(
  reportId: number,
  locationId: string,
  timeZone: string,
  windowStartUtc: string,
  windowEndUtc: string,
): Promise<ResyncResult> {
  const report = db.prepare(
    'SELECT state, business_date, shift_type, manual_tips_cents, manual_liquor_cents FROM shift_reports WHERE id = ?'
  ).get(reportId) as
    | { state: string; business_date: string; shift_type: 'Lunch' | 'Dinner'; manual_tips_cents: number; manual_liquor_cents: number }
    | undefined;

  if (!report) {
    return { outcome: 'error', syncRunId: null, squareTipsCents: 0, squareLiquorCents: 0, attendanceChanges: { added: 0, removed: 0, rolePreserved: 0, needsReconfirm: 0 }, paymentsCount: 0, ordersCount: 0, error: 'Report not found' };
  }

  if (report.state === 'FINALIZED') {
    return { outcome: 'refused_finalized', syncRunId: null, squareTipsCents: 0, squareLiquorCents: 0, attendanceChanges: { added: 0, removed: 0, rolePreserved: 0, needsReconfirm: 0 }, paymentsCount: 0, ordersCount: 0, error: 'Cannot re-sync a finalized report' };
  }

  const syncTs = new Date().toISOString();
  const bd = report.business_date;

  // 1. Create a sync run record
  const syncRunResult = db.prepare(`
    INSERT INTO square_sync_runs
      (shift_report_id, window_start_utc, window_end_utc, started_at, status)
    VALUES (?, ?, ?, ?, 'running')
  `).run(reportId, windowStartUtc, windowEndUtc, syncTs);
  const syncRunId = Number(syncRunResult.lastInsertRowid);

  try {
    // 2. Fetch fresh data from Square
    const { payments } = await listPayments(locationId, windowStartUtc, windowEndUtc);
    const { orders } = await searchOrders(locationId, windowStartUtc, windowEndUtc);
    const dayStart = `${bd}T00:00:00-07:00`;
    const dayEnd = `${bd}T23:59:59-07:00`;
    const { scheduled_shifts } = await searchScheduledShifts(locationId, dayStart, dayEnd);
    const { objects: catalogObjects } = await listCatalog();

    // 3. Compute Square tips
    const squareTipsCents = sumTips(payments);

    // 4. Compute liquor sales
    const tree = buildCategoryTree(catalogObjects);
    const liquorCatId = getLiquorCategoryId();
    let squareLiquorCents = 0;
    if (liquorCatId) {
      const closure = descendantClosure(tree, liquorCatId);
      const variationIds = computeLiquorVariationIds(tree, closure);
      const agg = classifyOrders(orders, tree, variationIds, closure);
      squareLiquorCents = agg.totalLiquorCents;
    }

    // 5. Reconcile attendance
    const { lunch, dinner } = partitionShifts(scheduled_shifts, timeZone);
    const shifts = report.shift_type === 'Lunch' ? lunch : dinner;
    const newAttendance = buildAttendance(shifts);

    // Get existing attendance to preserve confirmed roles
    const existingAttendance = db.prepare(
      'SELECT * FROM shift_report_attendance WHERE shift_report_id = ?'
    ).all(reportId) as {
      id: number; square_team_member_id: string; selected_role: string | null;
      role_confirmed: number; inclusion_state: string;
    }[];

    const existingMap = new Map(existingAttendance.map((a) => [a.square_team_member_id, a]));
    const newIds = new Set(newAttendance.map((a) => a.squareTeamMemberId));

    let added = 0, removed = 0, rolePreserved = 0, needsReconfirm = 0;

    db.transaction(() => {
      // Remove attendance for staff no longer scheduled (but keep as REMOVED for audit)
      for (const existing of existingAttendance) {
        if (!newIds.has(existing.square_team_member_id)) {
          db.prepare(
            'UPDATE shift_report_attendance SET inclusion_state = ? WHERE id = ?'
          ).run('REMOVED', existing.id);
          removed++;
        }
      }

      // Upsert new/changed attendance
      for (const att of newAttendance) {
        const existing = existingMap.get(att.squareTeamMemberId);
        if (existing) {
          // Person remains scheduled
          if (existing.role_confirmed) {
            // Preserve confirmed role
            rolePreserved++;
          } else {
            // Was unconfirmed, still needs confirmation
            needsReconfirm++;
          }
          // Update job/title if changed
          db.prepare(`
            UPDATE shift_report_attendance SET
              scheduled_job_id = ?, scheduled_job_title = ?, name_snapshot = ?,
              default_role = ?, inclusion_state = ?
            WHERE id = ?
          `).run(
            att.scheduledJobId, att.scheduledJobTitle, att.nameSnapshot,
            att.defaultRole, att.inclusionState, existing.id,
          );
        } else {
          // New attendee — insert
          db.prepare(`
            INSERT INTO shift_report_attendance
              (shift_report_id, staff_id, square_team_member_id, square_scheduled_shift_id,
               scheduled_job_id, scheduled_job_title, name_snapshot,
               default_role, inclusion_state)
            VALUES (?, (SELECT id FROM staff WHERE square_team_member_id = ?), ?, ?, ?, ?, ?, ?, ?)
          `).run(
            reportId, att.squareTeamMemberId, att.squareTeamMemberId,
            att.squareScheduledShiftId, att.scheduledJobId, att.scheduledJobTitle,
            att.nameSnapshot, att.defaultRole, att.inclusionState,
          );
          added++;
        }
      }

      // 6. Update report with new Square values (preserve manual adjustments)
      db.prepare(`
        UPDATE shift_reports SET
          square_tips_cents = ?,
          square_liquor_sales_cents = ?,
          latest_sync_run_id = ?,
          updated_at = datetime('now')
        WHERE id = ?
      `).run(squareTipsCents, squareLiquorCents, syncRunId, reportId);

      // 7. Record per-record audit rows (payments + order lines)
      for (const p of payments) {
        db.prepare(`
          INSERT INTO square_report_records
            (sync_run_id, record_kind, square_id, relevant_timestamp, cents_contribution, classification, result)
          VALUES (?, 'payment', ?, ?, ?, ?, 'counted')
        `).run(syncRunId, p.id, p.created_at, p.tip_money.amount, 'tip_money');
      }

      // 8. Complete the sync run
      db.prepare(`
        UPDATE square_sync_runs SET
          completed_at = ?, status = 'completed',
          counts_json = ?
        WHERE id = ?
      `).run(
        new Date().toISOString(),
        JSON.stringify({ payments: payments.length, orders: orders.length, shifts: scheduled_shifts.length }),
        syncRunId,
      );
    })();

    return {
      outcome: 'updated',
      syncRunId,
      squareTipsCents,
      squareLiquorCents,
      attendanceChanges: { added, removed, rolePreserved, needsReconfirm },
      paymentsCount: payments.length,
      ordersCount: orders.length,
    };
  } catch (e) {
    // Mark the sync run as failed
    db.prepare(`
      UPDATE square_sync_runs SET completed_at = ?, status = 'failed', error_summary = ?
      WHERE id = ?
    `).run(new Date().toISOString(), e instanceof Error ? e.message : 'unknown error', syncRunId);

    return {
      outcome: 'error',
      syncRunId,
      squareTipsCents: 0,
      squareLiquorCents: 0,
      attendanceChanges: { added: 0, removed: 0, rolePreserved: 0, needsReconfirm: 0 },
      paymentsCount: 0,
      ordersCount: 0,
      error: e instanceof Error ? e.message : 'unknown error',
    };
  }
}
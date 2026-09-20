// ============================================================================
// ***  READ-ONLY SQUARE MODULE — NO WRITES TO THE SQUARE ACCOUNT, EVER.  ***
//  Writing to Square (create/update/delete/modify) is FORBIDDEN without
//  the operator's explicit written approval. This module may only FETCH data.
// ============================================================================
//
// Labor sync: pulls ACTUAL worked shifts (clock in/out) from the Square
// Shifts API and upserts them into `labor_shifts`. Cost figures are
// recomputed on every sync; shifts still in progress (OPEN) carry
// provisional costs that firm up once they close.

import db from '../db';
import { searchWorkedShifts, listWorkweekConfigs } from './client';
import {
  unpaidBreakMinutes,
  workedMinutes,
  shiftCostCents,
  shiftBusinessDate,
} from './labor-math';

export interface LaborSyncResult {
  fetched: number;
  created: number;
  updated: number;
  openShifts: number;
  totalCostCents: number;
  provisionalCostCents: number;
  declaredCashTipsCents: number;
  weekStartDay: string | null;
}

/**
 * Persist the account's workweek start day (from Square's workweek config)
 * so overtime aggregation can read it synchronously offline.
 */
async function persistWeekStartDay(): Promise<string | null> {
  try {
    const { workweek_configs } = await listWorkweekConfigs();
    const cfg = workweek_configs[0];
    if (cfg?.start_of_week) {
      db.prepare(
        `INSERT INTO settings (key, value) VALUES ('labor_week_start_day', ?)
         ON CONFLICT(key, location_id) DO UPDATE SET value = excluded.value`
      ).run(cfg.start_of_week);
      return cfg.start_of_week;
    }
  } catch {
    // Non-fatal — aggregation falls back to the stored/default SUN.
  }
  return null;
}

/**
 * Pull worked shifts for a date range and upsert into labor_shifts.
 * The range should be expressed as UTC RFC-3339 instants covering the
 * business dates you care about (callers compute it from the location tz).
 */
export async function syncLaborShifts(
  locationId: string,
  timeZone: string,
  startAt: string,
  endAt: string,
): Promise<LaborSyncResult> {
  const weekStartDay = await persistWeekStartDay();
  const { shifts } = await searchWorkedShifts(locationId, timeZone, startAt, endAt);
  const now = new Date();
  const syncedTs = now.toISOString();

  let created = 0;
  let updated = 0;
  let openShifts = 0;
  let totalCostCents = 0;
  let provisionalCostCents = 0;
  let declaredCashTipsCents = 0;

  db.transaction(() => {
    const upsert = db.prepare(`
      INSERT INTO labor_shifts
        (square_shift_id, team_member_id, business_date, start_at, end_at,
         hourly_rate_cents, job_id, job_title, pay_type,
         worked_minutes, unpaid_break_minutes, cost_cents, provisional,
         declared_cash_tips_cents, status, synced_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      ON CONFLICT(square_shift_id) DO UPDATE SET
        end_at = excluded.end_at,
        hourly_rate_cents = excluded.hourly_rate_cents,
        job_id = excluded.job_id,
        job_title = excluded.job_title,
        pay_type = excluded.pay_type,
        worked_minutes = excluded.worked_minutes,
        unpaid_break_minutes = excluded.unpaid_break_minutes,
        cost_cents = excluded.cost_cents,
        provisional = excluded.provisional,
        declared_cash_tips_cents = excluded.declared_cash_tips_cents,
        status = excluded.status,
        synced_at = excluded.synced_at
    `);

    for (const sh of shifts) {
      const existing = db.prepare(
        'SELECT id FROM labor_shifts WHERE square_shift_id = ?'
      ).get(sh.id);

      // Pay type: SALARY when the staff record says so, else the shift's job
      const staffRow = db.prepare(
        'SELECT pay_type FROM staff WHERE square_team_member_id = ?'
      ).get(sh.team_member_id) as { pay_type: string | null } | undefined;
      const payType = staffRow?.pay_type === 'SALARY' ? 'SALARY' : 'HOURLY';

      const mins = workedMinutes(sh, now);
      const cost = shiftCostCents(sh, now);
      const isOpen = sh.status === 'OPEN';
      const tips = sh.declared_cash_tip_money?.amount ?? 0;

      upsert.run(
        sh.id,
        sh.team_member_id,
        shiftBusinessDate(sh, timeZone),
        sh.start_at,
        sh.end_at ?? null,
        sh.wage?.hourly_rate?.amount ?? 0,
        sh.wage?.job_id ?? null,
        sh.wage?.title ?? null,
        payType,
        mins,
        unpaidBreakMinutes(sh),
        cost,
        isOpen ? 1 : 0,
        tips,
        sh.status,
        syncedTs,
      );

      if (existing) updated++; else created++;
      if (isOpen) { openShifts++; provisionalCostCents += cost; }
      totalCostCents += cost;
      declaredCashTipsCents += tips;
    }
  })();

  return {
    fetched: shifts.length,
    created,
    updated,
    openShifts,
    totalCostCents,
    provisionalCostCents,
    declaredCashTipsCents,
    weekStartDay,
  };
}

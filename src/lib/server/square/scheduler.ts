// ============================================================================
// ***  READ-ONLY SQUARE MODULE — NO WRITES TO THE SQUARE ACCOUNT, EVER.  ***
//  Writing to Square (create/update/delete/modify) is FORBIDDEN without
//  the operator's explicit written approval. This module may only FETCH data.
// ============================================================================
//
// Report scheduler — timezone-aware automatic report generation.
//
// Implements spec §"Business windows":
//   - Lunch draft at 15:05 local time.
//   - Dinner draft 5 minutes after the configured close.
//   - Dinner always begins at 15:00.
//   - A closing time that crosses midnight belongs to the dinner business date.
//   - Daily dinner-close override takes precedence over weekly hours.
//
// The scheduler evaluates at least once per minute (the route handler triggers
// it). Creating a report is idempotent — retrying the same due job reopens or
// updates the same unfinalized report, never duplicates it.

import db from '../db';
import { localParts, businessDate, DEFAULT_TIMEZONE } from '../../business-date';
import { createOrGetReport } from './shift-import';

export interface SchedulerEvaluation {
  /** Business date evaluated for. */
  businessDate: string;
  /** Actions taken (reports created or skipped). */
  actions: SchedulerAction[];
  /** Errors encountered. */
  errors: string[];
}

export interface SchedulerAction {
  shiftType: 'Lunch' | 'Dinner';
  reportId: number | null;
  created: boolean;
  reason: string;
}

// ── Close time resolution ───────────────────────────────────────────────────

export interface DayOfWeekHours {
  open: string;  // "HH:MM" local
  close: string; // "HH:MM" local
}

export interface WeeklyHours {
  [dayOfWeek: string]: DayOfWeekHours | undefined;
}

/**
 * Parse the weekly business hours JSON stored in square_connections.
 * Square uses MON, TUE, WED, THU, FRI, SAT, SUN.
 */
export function parseWeeklyHours(json: string | null): WeeklyHours {
  if (!json) return {};
  try {
    const parsed = JSON.parse(json) as {
      periods: { day_of_week: string; start_local_time: string; end_local_time: string }[];
    };
    const hours: WeeklyHours = {};
    for (const p of parsed.periods) {
      hours[p.day_of_week] = {
        open: p.start_local_time.slice(0, 5),
        close: p.end_local_time.slice(0, 5),
      };
    }
    return hours;
  } catch {
    return {};
  }
}

/**
 * Get the dinner close time for a business date. Checks for a daily
 * override first, then falls back to the weekly schedule for the
 * weekday of the business date.
 *
 * Returns null if no close time can be determined.
 */
export function getDinnerClose(
  locationId: string,
  businessDateStr: string,
  weeklyHours: WeeklyHours
): { closeLocal: string; source: 'override' | 'weekly_hours' } | null {
  // Check for daily override
  const override = db.prepare(
    'SELECT close_local FROM dinner_close_overrides WHERE location_id = ? AND business_date = ?'
  ).get(locationId, businessDateStr) as { close_local: string } | undefined;

  if (override) {
    return { closeLocal: override.close_local, source: 'override' };
  }

  // Fall back to weekly hours for the day of week
  const date = new Date(`${businessDateStr}T12:00:00Z`);
  const dayOfWeek = new Intl.DateTimeFormat('en-US', { weekday: 'short' }).format(date).toUpperCase();

  const hours = weeklyHours[dayOfWeek];
  if (hours) {
    return { closeLocal: hours.close, source: 'weekly_hours' };
  }

  return null;
}

// ── Due-report detection ────────────────────────────────────────────────────

export interface DueReports {
  lunch: boolean;
  dinner: boolean;
  businessDate: string;
  dinnerCloseLocal: string | null;
  dinnerCloseSource: 'weekly_hours' | 'override' | null;
}

/**
 * Evaluate which reports are due for the current time in the location's
 * timezone.
 *
 * Lunch is due at 15:05 local time.
 * Dinner is due 5 minutes after the configured close.
 *
 * Does NOT create reports — just determines what's due.
 */
export function evaluateDue(
  now: Date,
  timeZone: string,
  locationId: string,
  weeklyHours: WeeklyHours
): DueReports {
  const bizDate = businessDate(now, timeZone);
  const parts = localParts(now, timeZone);
  const currentTimeMin = parts.hour * 60 + parts.minute;

  // Lunch: due at 15:05 local → minute 905
  const LUNCH_DUE_MIN = 15 * 60 + 5; // 905
  const lunchDue = currentTimeMin >= LUNCH_DUE_MIN;

  // Dinner: due 5 min after close
  const closeInfo = getDinnerClose(locationId, bizDate, weeklyHours);
  let dinnerDue = false;

  if (closeInfo) {
    const [closeH, closeM] = closeInfo.closeLocal.split(':').map(Number);
    const closeMin = closeH * 60 + closeM;
    const dinnerDueMin = closeMin + 5;

    // Handle midnight-crossing close (e.g., close at 02:00)
    if (closeMin <= 15 * 60) {
      // Close is after midnight — dinner is due the next calendar day
      // but belongs to this business date. Compare against current time
      // accounting for the rollover.
      // If current time is past midnight (before 3AM rollover):
      if (parts.hour < 3) {
        dinnerDue = currentTimeMin >= dinnerDueMin || true;
      } else {
        // Before midnight — dinner is due the next day after close+5
        dinnerDue = false; // Will be due after midnight
      }
    } else {
      dinnerDue = currentTimeMin >= dinnerDueMin;
    }
  }

  return {
    lunch: lunchDue,
    dinner: dinnerDue,
    businessDate: bizDate,
    dinnerCloseLocal: closeInfo?.closeLocal ?? null,
    dinnerCloseSource: closeInfo?.source ?? null,
  };
}

// ── Scheduler tick ──────────────────────────────────────────────────────────

/**
 * Run one scheduler evaluation cycle. Checks which reports are due for the
 * configured location and creates them if they don't already exist.
 *
 * Called by the scheduler API endpoint on each tick (every ~1 minute).
 */
export async function runSchedulerTick(now: Date = new Date()): Promise<SchedulerEvaluation> {
  const actions: SchedulerAction[] = [];
  const errors: string[] = [];

  // Get the configured location
  const conn = db.prepare(
    'SELECT * FROM square_connections LIMIT 1'
  ).get() as
    | { square_location_id: string; timezone: string; weekly_hours_json: string | null }
    | undefined;

  if (!conn) {
    return {
      businessDate: businessDate(now, DEFAULT_TIMEZONE),
      actions,
      errors: ['No Square connection configured'],
    };
  }

  const timeZone = conn.timezone || DEFAULT_TIMEZONE;
  const weeklyHours = parseWeeklyHours(conn.weekly_hours_json);
  const due = evaluateDue(now, timeZone, conn.square_location_id, weeklyHours);

  // Check existing reports to avoid recreating finalized ones
  const existingReports = db.prepare(
    `SELECT shift_type, state FROM shift_reports
     WHERE location_id = ? AND business_date = ?`
  ).all(conn.square_location_id, due.businessDate) as
    { shift_type: string; state: string }[];

  const existingTypes = new Set(existingReports.map((r) => r.shift_type));
  const finalizedTypes = new Set(
    existingReports.filter((r) => r.state === 'FINALIZED').map((r) => r.shift_type)
  );

  // Lunch
  if (due.lunch && !finalizedTypes.has('Lunch')) {
    try {
      const result = await createOrGetReport(
        {
          locationId: conn.square_location_id,
          businessDate: due.businessDate,
          shiftType: 'Lunch',
          source: 'auto',
          scheduledInstantUtc: now.toISOString(),
          closeSource: 'weekly_hours',
        },
        timeZone,
        { fetchShifts: true }
      );
      actions.push({
        shiftType: 'Lunch',
        reportId: result.reportId,
        created: result.created,
        reason: existingTypes.has('Lunch') ? 'Already exists (updated)' : 'Created by scheduler',
      });
    } catch (e) {
      errors.push(`Lunch: ${e instanceof Error ? e.message : 'unknown error'}`);
    }
  }

  // Dinner
  if (due.dinner && !finalizedTypes.has('Dinner') && due.dinnerCloseLocal) {
    try {
      const result = await createOrGetReport(
        {
          locationId: conn.square_location_id,
          businessDate: due.businessDate,
          shiftType: 'Dinner',
          source: 'auto',
          scheduledInstantUtc: now.toISOString(),
          closeSource: due.dinnerCloseSource ?? 'weekly_hours',
        },
        timeZone,
        { fetchShifts: true }
      );
      actions.push({
        shiftType: 'Dinner',
        reportId: result.reportId,
        created: result.created,
        reason: existingTypes.has('Dinner') ? 'Already exists (updated)' : 'Created by scheduler',
      });
    } catch (e) {
      errors.push(`Dinner: ${e instanceof Error ? e.message : 'unknown error'}`);
    }
  }

  return {
    businessDate: due.businessDate,
    actions,
    errors,
  };
}

// ── Dinner close override ───────────────────────────────────────────────────

/**
 * Set a daily dinner-close override. Requires a reason for audit.
 */
export function setDinnerCloseOverride(
  locationId: string,
  businessDate: string,
  closeLocal: string,
  actorUserId: number,
  reason: string
): void {
  if (!reason.trim()) throw new Error('Reason is required for dinner-close override');

  db.prepare(`
    INSERT INTO dinner_close_overrides (location_id, business_date, close_local, actor, reason)
    VALUES (?, ?, ?, ?, ?)
    ON CONFLICT(location_id, business_date) DO UPDATE SET
      close_local = excluded.close_local,
      actor = excluded.actor,
      reason = excluded.reason,
      created_at = datetime('now')
  `).run(locationId, businessDate, closeLocal, actorUserId, reason);
}
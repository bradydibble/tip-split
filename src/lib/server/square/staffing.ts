// ============================================================================
// ***  READ-ONLY SQUARE MODULE — NO WRITES TO THE SQUARE ACCOUNT, EVER.  ***
//  Writing to Square (create/update/delete/modify) is FORBIDDEN without
//  the operator's explicit written approval. This module may only FETCH data.
// ============================================================================
//
// Shift staffing resolver — answers "who is scheduled to work this
// business date + shift window?" for the calculate screen.
//
// Resolution order:
//   1. An existing shift report for (location, business_date, shift_type)
//      whose attendance has been generated — the reviewed record wins.
//   2. Otherwise a live, read-only fetch of published+assigned Square
//      scheduled shifts, partitioned into the requested business window.
//      Nothing is persisted here; the scheduler owns report creation.
//
// The result is advisory: the calculate screen uses it to DEFAULT the
// staff list and selection. The user can always remove people (missed
// work) or add people (covers) — the submit path is unchanged.

import db from '../db';
import { loadSquareConfig } from './config';
import { searchScheduledShifts } from './client';
import {
  partitionShifts,
  businessDayWindowUtc,
  shiftLocalParts,
  LUNCH_BOUNDARY_HOUR,
  LUNCH_BOUNDARY_MINUTE,
} from './shift-import';
import type { SquareScheduledShift } from './fixtures';

/** A scheduled person resolved to a local roster row. */
export interface StaffedPerson {
  staffId: number;
  name: string;
  staffCode: string | null;
  /** Role derived from the job this person is scheduled to work that day
   *  (TipSplit uppercase vocabulary); roster default only when the shift
   *  carries no job. Null when neither resolves (manager review). */
  suggestedRole: 'FOH' | 'BAR' | 'BUSSER' | 'KITCHEN' | null;
  /** The Square job title the person is scheduled to work, if known. */
  scheduledJobTitle: string | null;
}

/** Someone scheduled in Square with no matching local roster row. */
export interface UnmatchedScheduledPerson {
  name: string | null;
  scheduledJobTitle: string | null;
}

export type StaffingSource =
  | 'shift_report'    // served from a generated shift report's attendance
  | 'square_live'     // live read-only fetch of scheduled shifts
  | 'not_configured'  // no Square token
  | 'no_location'     // token present but no location selected
  | 'no_schedule';    // location selected, nothing published for this window

export interface ShiftStaffing {
  /** True when staffing data exists for the requested date + shift. */
  available: boolean;
  source: StaffingSource;
  /** Roster-resolved scheduled people (already filtered to includable). */
  staffed: StaffedPerson[];
  /** Scheduled in Square but absent from the local roster. */
  notInRoster: UnmatchedScheduledPerson[];
  /** Scheduled but role-mapped EXCLUDED (e.g. salaried managers). */
  excluded: UnmatchedScheduledPerson[];
}

interface SquareConnection {
  square_location_id: string;
  timezone: string;
}

const EMPTY = (source: StaffingSource): ShiftStaffing => ({
  available: false,
  source,
  staffed: [],
  notInRoster: [],
  excluded: [],
});

/**
 * Who is staffed for a business date + shift window.
 *
 * Never throws for expected conditions (unconfigured, no schedule).
 * Unexpected failures (network, Square API errors) DO throw — the API
 * route catches those, logs the real error server-side, and answers
 * with a safe "no staffing data" fallback.
 */
export async function getShiftStaffing(
  businessDateStr: string,
  shiftType: 'Lunch' | 'Dinner'
): Promise<ShiftStaffing> {
  const config = loadSquareConfig();
  if (!config.configured) return EMPTY('not_configured');

  // The connection row carries the selected Square location and its
  // timezone; the settings key is the same value's mirror.
  const conn = db.prepare(
    'SELECT square_location_id, timezone FROM square_connections LIMIT 1'
  ).get() as SquareConnection | undefined;

  const locationId = conn?.square_location_id || config.locationId;
  if (!locationId) return EMPTY('no_location');
  const timeZone = conn?.timezone || config.timezone;

  // 1) Reviewed shift report for this window — attendance already generated.
  const report = db.prepare(
    `SELECT id FROM shift_reports
     WHERE location_id = ? AND business_date = ? AND shift_type = ? AND state != 'VOIDED'`
  ).get(locationId, businessDateStr, shiftType) as { id: number } | undefined;

  if (report) {
    const rows = db.prepare(`
      SELECT a.inclusion_state, a.name_snapshot, a.scheduled_job_title,
             a.default_role, a.selected_role,
             s.id AS roster_id, s.name AS roster_name, s.staff_code,
             s.role_mapping_state
      FROM shift_report_attendance a
      LEFT JOIN staff s ON s.id = a.staff_id
      WHERE a.shift_report_id = ?
    `).all(report.id) as Array<{
      inclusion_state: string;
      name_snapshot: string;
      scheduled_job_title: string | null;
      default_role: string | null;
      selected_role: string | null;
      roster_id: number | null;
      roster_name: string | null;
      staff_code: string | null;
      role_mapping_state: string | null;
    }>;

    // An empty report (created without a schedule fetch) is not staffing
    // data — fall through to the live fetch instead of answering "nobody".
    if (rows.length > 0) return staffingFromReportAttendance(rows);
  }

  // 2) Live read-only fetch. Nothing is persisted by this path.
  const { startUtc, endUtc } = businessDayWindowUtc(businessDateStr, timeZone);
  const { scheduled_shifts } = await searchScheduledShifts(locationId, startUtc, endUtc);
  // A shift that spans the Lunch/Dinner boundary staffs BOTH windows —
  // someone scheduled 12:00–21:00 worked the lunch service and the dinner
  // service. (Single-window midpoint assignment would drop them from the
  // window their shift started in.)
  const { lunch, dinner } = partitionShifts(scheduled_shifts, timeZone, {
    allowDualAssignment: true,
  });
  const windowShifts = shiftType === 'Lunch' ? lunch : dinner;

  // Nothing published (or nothing assigned) for this business window.
  if (windowShifts.length === 0) return EMPTY('no_schedule');

  return staffingFromScheduledShifts(windowShifts, shiftType, timeZone);
}

function staffingFromReportAttendance(
  rows: Array<{
    inclusion_state: string;
    name_snapshot: string;
    scheduled_job_title: string | null;
    default_role: string | null;
    selected_role: string | null;
    roster_id: number | null;
    roster_name: string | null;
    staff_code: string | null;
    role_mapping_state: string | null;
  }>
): ShiftStaffing {
  const staffed: StaffedPerson[] = [];
  const notInRoster: UnmatchedScheduledPerson[] = [];
  const excluded: UnmatchedScheduledPerson[] = [];

  for (const row of rows) {
    if (row.inclusion_state === 'REMOVED') {
      // Reviewed out during the shift-lead pass (missed work, cover, etc.)
      // — not a default, and not an exclusion either. Just skip.
      continue;
    }
    if (row.inclusion_state === 'EXCLUDED') {
      excluded.push({
        name: row.roster_name ?? row.name_snapshot,
        scheduledJobTitle: row.scheduled_job_title,
      });
      continue;
    }
    if (!row.roster_id) {
      // NEEDS_REVIEW / INCLUDED but the person is not in the roster.
      notInRoster.push({
        name: row.name_snapshot,
        scheduledJobTitle: row.scheduled_job_title,
      });
      continue;
    }
    if (row.role_mapping_state === 'EXCLUDED') {
      excluded.push({
        name: row.roster_name,
        scheduledJobTitle: row.scheduled_job_title,
      });
      continue;
    }
    const role = normalizeRole(row.selected_role ?? row.default_role);
    staffed.push({
      staffId: row.roster_id,
      name: row.roster_name ?? row.name_snapshot,
      staffCode: row.staff_code,
      suggestedRole: role,
      scheduledJobTitle: row.scheduled_job_title,
    });
  }

  return {
    available: staffed.length > 0,
    source: 'shift_report',
    staffed,
    notInRoster,
    excluded,
  };
}

async function staffingFromScheduledShifts(
  shifts: SquareScheduledShift[],
  window: 'Lunch' | 'Dinner',
  timeZone: string
): Promise<ShiftStaffing> {
  const staffed: StaffedPerson[] = [];
  const notInRoster: UnmatchedScheduledPerson[] = [];
  const excluded: UnmatchedScheduledPerson[] = [];

  const jobTitleStmt = db.prepare(
    'SELECT square_job_title FROM staff_square_jobs WHERE square_job_id = ? AND active = 1 LIMIT 1'
  );
  const rosterStmt = db.prepare(
    `SELECT id, name, staff_code, default_tip_split_role, role_mapping_state
     FROM staff WHERE square_team_member_id = ?`
  );
  // Mapped role for the specific job this person is scheduled to work.
  // Keyed per (staff, job) — the member must actually hold the job.
  const schedRoleStmt = db.prepare(
    `SELECT mapped_tip_role FROM staff_square_jobs
     WHERE staff_id = ? AND square_job_id = ? AND active = 1 LIMIT 1`
  );

  // Group each person's shifts in this window; the position comes from the
  // job on the shift where they spend the MOST time inside the window
  // (ties → the later shift, since the later job is usually the position
  // they close in). With boundary-spanning shifts dual-assigned into both
  // windows, this is what keeps a morning cashier + evening food runner
  // resolved as cashier for Lunch and food runner for Dinner.
  const byPerson = new Map<string, SquareScheduledShift[]>();
  for (const shift of shifts) {
    // Real shape: published details first, draft only as a partitioning
    // fallback for unpublished shifts (documented policy in shift-import).
    const details = shift.published_shift_details ?? shift.draft_shift_details;
    if (!details?.team_member_id) continue;
    const list = byPerson.get(details.team_member_id) ?? [];
    list.push(shift);
    byPerson.set(details.team_member_id, list);
  }

  /** Minutes this shift spends inside the requested window (local clock). */
  const overlapMinutes = (shift: SquareScheduledShift): number => {
    const d = shift.published_shift_details ?? shift.draft_shift_details;
    if (!d) return 0;
    const s = shiftLocalParts(d.start_at, timeZone);
    const e = shiftLocalParts(d.end_at, timeZone);
    const startMin = s.hour * 60 + s.minute;
    const endMin = e.hour * 60 + e.minute;
    const boundary = LUNCH_BOUNDARY_HOUR * 60 + LUNCH_BOUNDARY_MINUTE;
    // Overnight shifts belong to Dinner entirely (partition rule).
    if (endMin <= startMin) return window === 'Dinner' ? endMin + 24 * 60 - startMin : 0;
    if (window === 'Lunch') return Math.max(0, Math.min(endMin, boundary) - startMin);
    return Math.max(0, endMin - Math.max(startMin, boundary));
  };
  const startMinutes = (shift: SquareScheduledShift): number => {
    const d = shift.published_shift_details ?? shift.draft_shift_details;
    if (!d) return 0;
    const p = shiftLocalParts(d.start_at, timeZone);
    return p.hour * 60 + p.minute;
  };

  for (const [teamMemberId, personShifts] of byPerson) {
    const jobIdOf = (shift: SquareScheduledShift): string | null =>
      (shift.published_shift_details ?? shift.draft_shift_details)?.job_id ?? null;

    // Prefer shifts that carry a job (a job-less shift is a data gap, not a
    // position); among those, the longest window overlap wins.
    const withJob = personShifts.filter((s) => jobIdOf(s));
    const pool = withJob.length > 0 ? withJob : personShifts;
    const chosen = pool.reduce((best, s) => {
      const so = overlapMinutes(s), bo = overlapMinutes(best);
      const ss = startMinutes(s), bs = startMinutes(best);
      return so > bo || (so === bo && ss > bs) ? s : best;
    }, pool[0]);

    const chosenJobId = jobIdOf(chosen);
    const jobTitle = chosenJobId
      ? ((jobTitleStmt.get(chosenJobId) as { square_job_title: string } | undefined)
          ?.square_job_title ?? null)
      : null;

    const rosterRow = rosterStmt.get(teamMemberId) as
      | {
          id: number;
          name: string;
          staff_code: string | null;
          default_tip_split_role: string | null;
          role_mapping_state: string | null;
        }
      | undefined;

    if (!rosterRow) {
      // Scheduled in Square but not synced into the local roster. The
      // scheduled-shift payload carries no member name — count only.
      notInRoster.push({ name: null, scheduledJobTitle: jobTitle });
      continue;
    }

    // Position for the day comes from the SCHEDULE, not the roster default:
    // people move between jobs (cashier one shift, bartender the next). The
    // scheduled job's mapped role wins; the roster default is only the
    // fallback for shifts that carry no job. A person whose roster default
    // is EXCLUDED (e.g. a manager) but who is scheduled to a tip-earning
    // job that day is included with that job's role — and vice versa.
    const scheduledRole = chosenJobId
      ? ((schedRoleStmt.get(rosterRow.id, chosenJobId) as
          | { mapped_tip_role: string }
          | undefined)?.mapped_tip_role ?? null)
      : null;

    if (scheduledRole === 'EXCLUDED') {
      excluded.push({ name: rosterRow.name, scheduledJobTitle: jobTitle });
      continue;
    }
    if (!scheduledRole && rosterRow.default_tip_split_role === 'EXCLUDED') {
      excluded.push({ name: rosterRow.name, scheduledJobTitle: jobTitle });
      continue;
    }

    staffed.push({
      staffId: rosterRow.id,
      name: rosterRow.name,
      staffCode: rosterRow.staff_code,
      suggestedRole: normalizeRole(scheduledRole ?? rosterRow.default_tip_split_role),
      scheduledJobTitle: jobTitle,
    });
  }

  return {
    available: staffed.length > 0,
    source: 'square_live',
    staffed,
    notInRoster,
    excluded,
  };
}

/** Square-mapping vocabulary ('BAR') → null when unmapped or 'EXCLUDED'. */
function normalizeRole(
  role: string | null
): 'FOH' | 'BAR' | 'BUSSER' | 'KITCHEN' | null {
  if (role === 'FOH' || role === 'BAR' || role === 'BUSSER' || role === 'KITCHEN') {
    return role;
  }
  return null;
}

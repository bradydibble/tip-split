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
import { partitionShifts, businessDayWindowUtc } from './shift-import';
import type { SquareScheduledShift } from './fixtures';

/** A scheduled person resolved to a local roster row. */
export interface StaffedPerson {
  staffId: number;
  name: string;
  staffCode: string | null;
  /** Square-job-derived suggestion, TipSplit uppercase vocabulary. */
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
  const { lunch, dinner } = partitionShifts(scheduled_shifts, timeZone);
  const windowShifts = shiftType === 'Lunch' ? lunch : dinner;

  // Nothing published (or nothing assigned) for this business window.
  if (windowShifts.length === 0) return EMPTY('no_schedule');

  return staffingFromScheduledShifts(windowShifts);
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
  shifts: SquareScheduledShift[]
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

  const seen = new Set<number>();
  for (const shift of shifts) {
    // Real shape: published details first, draft only as a partitioning
    // fallback for unpublished shifts (documented policy in shift-import).
    const details = shift.published_shift_details ?? shift.draft_shift_details;
    if (!details?.team_member_id) continue;

    const jobId = details.job_id ?? null;
    const jobTitle = jobId
      ? ((jobTitleStmt.get(jobId) as { square_job_title: string } | undefined)
          ?.square_job_title ?? null)
      : null;

    const rosterRow = rosterStmt.get(details.team_member_id) as
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
    if (seen.has(rosterRow.id)) continue;
    seen.add(rosterRow.id);

    if (
      rosterRow.role_mapping_state === 'EXCLUDED' ||
      rosterRow.default_tip_split_role === 'EXCLUDED'
    ) {
      excluded.push({ name: rosterRow.name, scheduledJobTitle: jobTitle });
      continue;
    }

    staffed.push({
      staffId: rosterRow.id,
      name: rosterRow.name,
      staffCode: rosterRow.staff_code,
      suggestedRole: normalizeRole(rosterRow.default_tip_split_role),
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

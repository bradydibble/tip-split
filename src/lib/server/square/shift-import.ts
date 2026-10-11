// ============================================================================
// ***  READ-ONLY SQUARE MODULE — NO WRITES TO THE SQUARE ACCOUNT, EVER.  ***
//  Writing to Square (create/update/delete/modify) is FORBIDDEN without
//  the operator's explicit written approval. This module may only FETCH data.
// ============================================================================
//
// Scheduled shift import and attendance generation.
//
// Implements spec §"Shift-report lifecycle":
//   - Fetch published, assigned shifts for a business date using location TZ.
//   - Match schedule rows to roster members by Square Team ID.
//   - Partition attendance by Lunch and Dinner business windows:
//       Lunch:   business-date open through 15:00 local
//       Dinner:  15:00 through that day's configured close
//   - A shift spanning 15:00 appears in both windows only if the product
//     policy explicitly allows it; otherwise it's assigned once by a
//     documented rule (default: to Lunch).
//   - Attendance rows carry the scheduled job, default role, and confirmation
//     state.

import db from '../db';
import { searchScheduledShifts } from './client';
import { localParts } from '../../business-date';
import { addDays } from '../../pay-period';
import type { SquareScheduledShift } from './fixtures';

// ── Time helpers ─────────────────────────────────────────────────────────────

/**
 * Parse a Square shift start/end timestamp (RFC 3339 with offset) and
 * return the local hour:minute parts in the given timezone.
 */
export function shiftLocalParts(
  isoTimestamp: string,
  timeZone: string
): { hour: number; minute: number } {
  const date = new Date(isoTimestamp);
  const parts = localParts(date, timeZone);
  return { hour: parts.hour, minute: parts.minute };
}

/**
 * Convert a business date (YYYY-MM-DD) and local HH:MM to a UTC ISO instant
 * in the given timezone. Uses the standard technique of interpreting the
 * local time as UTC, formatting it in the target timezone, and computing
 * the offset from the difference.
 */
export function localToUtc(
  businessDate: string,
  localTime: string,
  timeZone: string
): string {
  const [h, m] = localTime.split(':').map(Number);
  const localIso = `${businessDate}T${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}:00`;
  // Interpret the wall-clock time AS IF it were UTC. The explicit 'Z' is
  // essential: without an offset designator the JS engine parses the
  // string in the HOST's timezone, making this function machine-dependent.
  const asIfUtc = new Date(`${localIso}Z`);

  // Format the "as-if-UTC" instant in the target timezone. The difference
  // between the formatted parts and the original local values IS the offset.
  const dtf = new Intl.DateTimeFormat('en-US', {
    timeZone,
    year: 'numeric', month: '2-digit', day: '2-digit',
    hour: '2-digit', minute: '2-digit',
    hourCycle: 'h23',
  });
  const parts = dtf.formatToParts(asIfUtc);
  const get = (type: string) => parseInt(parts.find((p) => p.type === type)!.value, 10);

  // What the target timezone thinks the wall clock is:
  const tzWallMs = Date.UTC(get('year'), get('month') - 1, get('day'), get('hour'), get('minute'));
  const offsetMs = tzWallMs - asIfUtc.getTime();
  // Subtract the offset to get the real UTC instant
  return new Date(asIfUtc.getTime() - offsetMs).toISOString();
}

// ── Shift partitioning ──────────────────────────────────────────────────────

export type ShiftWindow = 'Lunch' | 'Dinner';

export interface PartitionedShift {
  shift: SquareScheduledShift;
  window: ShiftWindow;
}

export const LUNCH_BOUNDARY_HOUR = 15;
export const LUNCH_BOUNDARY_MINUTE = 0;

/**
 * Determine which business window(s) a shift intersects.
 *
 * Lunch: from business-date open through 15:00 local.
 * Dinner: from 15:00 through close.
 *
 * A shift spanning 15:00 (e.g., 14:00-17:00) is assigned to Lunch by default.
 * This follows the documented rule: "A 14:00 to 17:00 shift appears in both
 * relevant review contexts only if the product policy explicitly allows it,
 * otherwise it is assigned once by a documented rule."
 *
 * The default rule assigns boundary-spanning shifts to the shift whose
 * midpoint falls earlier.
 */
export function partitionShift(
  shift: SquareScheduledShift,
  timeZone: string,
  opts?: { allowDualAssignment?: boolean }
): ShiftWindow[] {
  // Real shape: times live in published_shift_details (falls back to draft
  // for partitioning unpublished shifts under a documented policy).
  const details = shift.published_shift_details ?? shift.draft_shift_details;
  if (!details) return [];
  const startParts = shiftLocalParts(details.start_at, timeZone);
  const endParts = shiftLocalParts(details.end_at, timeZone);

  const startMin = startParts.hour * 60 + startParts.minute;
  const endMin = endParts.hour * 60 + endParts.minute;
  const boundary = LUNCH_BOUNDARY_HOUR * 60 + LUNCH_BOUNDARY_MINUTE;

  // Handle overnight shifts (end < start in local terms) — assign to Dinner
  if (endMin <= startMin) return ['Dinner'];

  const spansBoundary = startMin < boundary && endMin > boundary;

  if (spansBoundary && opts?.allowDualAssignment) {
    return ['Lunch', 'Dinner'];
  }

  if (spansBoundary) {
    // Default rule: assign to the window containing the midpoint.
    // At the exact boundary, the midpoint goes to Lunch.
    const midMin = (startMin + endMin) / 2;
    return midMin <= boundary ? ['Lunch'] : ['Dinner'];
  }

  // Entirely in lunch or dinner
  if (startMin < boundary) return ['Lunch'];
  return ['Dinner'];
}

/**
 * Partition a list of shifts into Lunch and Dinner groups.
 */
export function partitionShifts(
  shifts: SquareScheduledShift[],
  timeZone: string,
  opts?: { allowDualAssignment?: boolean }
): { lunch: SquareScheduledShift[]; dinner: SquareScheduledShift[] } {
  const lunch: SquareScheduledShift[] = [];
  const dinner: SquareScheduledShift[] = [];

  for (const shift of shifts) {
    const windows = partitionShift(shift, timeZone, opts);
    for (const w of windows) {
      if (w === 'Lunch') lunch.push(shift);
      else dinner.push(shift);
    }
  }

  return { lunch, dinner };
}

// ── Attendance generation ───────────────────────────────────────────────────

export interface AttendanceEntry {
  squareTeamMemberId: string;
  squareScheduledShiftId: string;
  scheduledJobId: string | null;
  scheduledJobTitle: string | null;
  nameSnapshot: string;
  defaultRole: 'FOH' | 'BAR' | 'BUSSER' | 'KITCHEN' | 'EXCLUDED' | null;
  inclusionState: 'INCLUDED' | 'EXCLUDED' | 'NEEDS_REVIEW';
}

/**
 * Build attendance entries from partitioned shifts. Matches each shift to
 * a local staff record by Square Team ID. Staff not found locally are flagged
 * NEEDS_REVIEW (they need to be synced into the roster first).
 *
 * Pre-populates the default TipSplit role from the staff record's
 * role_mapping_state and default_tip_split_role.
 */
export function buildAttendance(
  shifts: SquareScheduledShift[]
): AttendanceEntry[] {
  const entries: AttendanceEntry[] = [];

  // Prepared statement: resolve a Square job_id to its synced job title
  const jobTitleStmt = db.prepare(
    'SELECT square_job_title FROM staff_square_jobs WHERE square_job_id = ? AND active = 1 LIMIT 1'
  );

  for (const shift of shifts) {
    // Real shape: everything lives in published_shift_details
    const details = shift.published_shift_details ?? shift.draft_shift_details;
    if (!details?.team_member_id) continue;

    const jobId = details.job_id ?? null;
    const jobTitle = jobId
      ? (jobTitleStmt.get(jobId) as { square_job_title: string } | undefined)?.square_job_title ?? null
      : null;

    const staffRow = db.prepare(
      'SELECT id, name, default_tip_split_role, role_mapping_state FROM staff WHERE square_team_member_id = ?'
    ).get(details.team_member_id) as
      | { id: number; name: string; default_tip_split_role: string | null; role_mapping_state: string | null }
      | undefined;

    if (!staffRow) {
      // Not in local roster — needs review
      entries.push({
        squareTeamMemberId: details.team_member_id,
        squareScheduledShiftId: shift.id,
        scheduledJobId: jobId,
        scheduledJobTitle: jobTitle,
        nameSnapshot: '(Not in roster)',
        defaultRole: null,
        inclusionState: 'NEEDS_REVIEW',
      });
      continue;
    }

    const state = staffRow.role_mapping_state;
    const defaultRole = staffRow.default_tip_split_role as
      | 'FOH' | 'BAR' | 'BUSSER' | 'KITCHEN' | 'EXCLUDED'
      | null;

    let inclusionState: 'INCLUDED' | 'EXCLUDED' | 'NEEDS_REVIEW' = 'INCLUDED';

    if (state === 'EXCLUDED' || defaultRole === 'EXCLUDED') {
      inclusionState = 'EXCLUDED';
    } else if (state === 'NEEDS_REVIEW' || !defaultRole) {
      inclusionState = 'NEEDS_REVIEW';
    }

    entries.push({
      squareTeamMemberId: details.team_member_id,
      squareScheduledShiftId: shift.id,
      scheduledJobId: jobId,
      scheduledJobTitle: jobTitle,
      nameSnapshot: staffRow.name,
      defaultRole,
      inclusionState,
    });
  }

  return entries;
}

// ── Shift report creation ───────────────────────────────────────────────────

export interface CreateReportParams {
  locationId: string;
  businessDate: string;
  shiftType: 'Lunch' | 'Dinner';
  source?: 'auto' | 'manual';
  scheduledInstantUtc?: string;
  closeSource?: 'weekly_hours' | 'override';
  closeOverrideId?: number;
}

export interface CreateReportResult {
  reportId: number;
  created: boolean;
  attendanceCount: number;
}

/**
 * The UTC window covering a business date's local calendar day, computed in
 * the location's timezone so it stays correct across DST transitions. Never
 * assume a fixed UTC offset. Half-open: [start, end).
 */
export function businessDayWindowUtc(
  businessDateStr: string,
  timeZone: string
): { startUtc: string; endUtc: string } {
  return {
    startUtc: localToUtc(businessDateStr, '00:00', timeZone),
    endUtc: localToUtc(addDays(businessDateStr, 1), '00:00', timeZone),
  };
}

/**
 * Create or retrieve a shift report for the given parameters. Idempotent:
 * if a report already exists for (location, business_date, shift_type),
 * return the existing one.
 *
 * When Square shifts are available and the report is new, generates
 * attendance entries from the schedule.
 */
export async function createOrGetReport(
  params: CreateReportParams,
  timeZone: string,
  opts?: { fetchShifts?: boolean }
): Promise<CreateReportResult> {
  const { locationId, businessDate, shiftType } = params;

  // Check for existing report (idempotent)
  const existing = db.prepare(
    `SELECT id FROM shift_reports
     WHERE location_id = ? AND business_date = ? AND shift_type = ?`
  ).get(locationId, businessDate, shiftType) as { id: number } | undefined;

  if (existing) {
    const attCount = (db.prepare(
      'SELECT COUNT(*) AS n FROM shift_report_attendance WHERE shift_report_id = ?'
    ).get(existing.id) as { n: number }).n;
    return { reportId: existing.id, created: false, attendanceCount: attCount };
  }

  // Create new report
  const result = db.prepare(`
    INSERT INTO shift_reports
      (location_id, business_date, shift_type, state, source,
       scheduled_instant_utc, close_source, close_override_id)
    VALUES (?, ?, ?, 'DRAFT', ?, ?, ?, ?)
  `).run(
    locationId,
    businessDate,
    shiftType,
    params.source ?? 'manual',
    params.scheduledInstantUtc ?? null,
    params.closeSource ?? 'weekly_hours',
    params.closeOverrideId ?? null,
  );
  const reportId = Number(result.lastInsertRowid);

  let attendanceCount = 0;

  if (opts?.fetchShifts) {
    // Fetch and partition shifts, then generate attendance. The day window
    // is derived from the location's timezone — DST-correct, no fixed offset.
    const { startUtc, endUtc } = businessDayWindowUtc(businessDate, timeZone);
    const { scheduled_shifts } = await searchScheduledShifts(locationId, startUtc, endUtc);
    const { lunch, dinner } = partitionShifts(scheduled_shifts, timeZone);
    const shifts = shiftType === 'Lunch' ? lunch : dinner;
    const attendance = buildAttendance(shifts);

    // Insert attendance rows
    const insertAtt = db.prepare(`
      INSERT INTO shift_report_attendance
        (shift_report_id, staff_id, square_team_member_id, square_scheduled_shift_id,
         scheduled_job_id, scheduled_job_title, name_snapshot,
         default_role, inclusion_state)
      VALUES (?, (SELECT id FROM staff WHERE square_team_member_id = ?), ?, ?, ?, ?, ?, ?, ?)
    `);

    for (const att of attendance) {
      insertAtt.run(
        reportId,
        att.squareTeamMemberId,
        att.squareTeamMemberId,
        att.squareScheduledShiftId,
        att.scheduledJobId,
        att.scheduledJobTitle,
        att.nameSnapshot,
        att.defaultRole,
        att.inclusionState,
      );
      attendanceCount++;
    }

    // Transition to READY_FOR_REVIEW if we have attendance
    if (attendanceCount > 0) {
      db.prepare(
        "UPDATE shift_reports SET state = 'READY_FOR_REVIEW', updated_at = datetime('now') WHERE id = ?"
      ).run(reportId);
    }
  }

  return { reportId, created: true, attendanceCount };
}
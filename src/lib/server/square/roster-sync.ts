// ============================================================================
// ***  READ-ONLY SQUARE MODULE — NO WRITES TO THE SQUARE ACCOUNT, EVER.  ***
//  Writing to Square (create/update/delete/modify) is FORBIDDEN without
//  the operator's explicit written approval. This module may only FETCH data.
// ============================================================================
//
// Staff roster synchronization from Square Team.
//
// Implements spec §"Staff roster synchronization":
//   1. Query every active Team member assigned to the selected location.
//   2. Create or update the local record by square_team_member_id, never by name.
//   3. An active Square member absent from a subsequent sync is marked
//      locally inactive; do not hard-delete anyone with TipSplit history.
//   4. Name updates from Square update the live roster. Historical snapshots
//      retain the name used at the time.
//   5. A manager can alter the TipSplit role mapping but cannot alter the
//      Square ID.
//
// The sync is idempotent: running it twice with the same Square data produces
// the same local state.

import db from '../db';
import { searchTeamMembers } from './client';
import { mapJobs, type ExtendedTipSplitRole, type MappingState } from '../../square-role-map';
import { nextStaffCode } from '../staff-code';
import type { SquareTeamMember } from './fixtures';

export type RosterCounts = {
  created: number;
  updated: number;
  deactivated: number;
  needsReview: number;
  excluded: number;
};

export interface RosterSyncResult {
  counts: RosterCounts;
  /** Staff IDs that landed in NEEDS_REVIEW (for the manager review UI). */
  reviewStaffIds: number[];
  /** Total active team members fetched from Square. */
  fetched: number;
}

/**
 * Build the full display name for a Square team member.
 */
function displayName(tm: SquareTeamMember): string {
  const parts = [tm.given_name, tm.family_name].filter(Boolean);
  return parts.length > 0 ? parts.join(' ') : tm.email || tm.id;
}

/**
 * Extract all job titles from a team member's wage_setting.job_assignments.
 * The Square Team Members API returns job assignments inside
 * `wage_setting.job_assignments[]`, each with a `job_title` and `job_id`.
 * A member may hold multiple jobs.
 */
function extractJobTitles(tm: SquareTeamMember): string[] {
  const assignments = tm.wage_setting?.job_assignments ?? [];
  return assignments
    .map((ja) => ja.job_title)
    .filter((t): t is string => !!t);
}

/**
 * Extract job assignments (with job_id) from a team member.
 * Used to populate staff_square_jobs with the Square job_id for
 * scheduled-shift matching.
 */
function extractJobAssignments(tm: SquareTeamMember): {
  job_id: string;
  job_title: string;
}[] {
  const assignments = tm.wage_setting?.job_assignments ?? [];
  return assignments
    .filter((ja) => ja.job_title)
    .map((ja) => ({
      job_id: ja.job_id ?? `JOB-${ja.job_title.toLowerCase().replace(/\s+/g, '-')}`,
      job_title: ja.job_title,
    }));
}

/**
 * Compensation summary for a team member: dominant pay_type and, for
 * salaried members, the annual salary in cents + contracted weekly hours.
 * Salaried members holding both kinds of assignments count as SALARY.
 */
export function extractCompensation(tm: SquareTeamMember): {
  payType: 'HOURLY' | 'SALARY' | null;
  salaryAnnualCents: number | null;
  salaryWeeklyHours: number | null;
} {
  const assignments = tm.wage_setting?.job_assignments ?? [];
  const salaried = assignments.filter((ja) => ja.pay_type === 'SALARY');
  if (salaried.length === 0) {
    const hourlyAny = assignments.some((ja) => ja.pay_type === 'HOURLY');
    return { payType: hourlyAny ? 'HOURLY' : null, salaryAnnualCents: null, salaryWeeklyHours: null };
  }
  // Highest annual rate among salaried assignments wins.
  const top = salaried.reduce((a, b) =>
    (b.annual_rate?.amount ?? 0) > (a.annual_rate?.amount ?? 0) ? b : a);
  return {
    payType: 'SALARY',
    salaryAnnualCents: top.annual_rate?.amount ?? null,
    salaryWeeklyHours: top.weekly_hours ?? null,
  };
}

/**
 * Translate the extended TipSplit role to the staff table's narrower CHECK
 * constraint values. The staff.role column is 'FOH'|'Kitchen'|'Bar'|'Busser',
 * while our mapping can also produce 'EXCLUDED' and null (needs review).
 *
 * For the staff table we store:
 *   - The mapped role if it's a valid staff role
 *   - 'FOH' as a placeholder for NEEDS_REVIEW (role_mapping_state flags it)
 *   - Whatever role was already set for EXCLUDED members (don't overwrite)
 */
function roleForStaffTable(
  mapped: ExtendedTipSplitRole | null,
  state: MappingState,
  currentRole: string | null,
): string {
  if (state === 'MAPPED' && mapped && mapped !== 'EXCLUDED') {
    // Translate BAR → Bar, KITCHEN → Kitchen, BUSSER → Busser
    if (mapped === 'BAR') return 'Bar';
    if (mapped === 'KITCHEN') return 'Kitchen';
    if (mapped === 'BUSSER') return 'Busser';
    return mapped; // 'FOH' passes through
  }
  // NEEDS_REVIEW or EXCLUDED: keep existing role if present, else FOH
  if (currentRole && ['FOH', 'Kitchen', 'Bar', 'Busser'].includes(currentRole)) {
    return currentRole;
  }
  return 'FOH';
}

/**
 * Synchronize the active roster from Square Team for the selected location.
 *
 * Idempotent: syncing the same Square data twice leaves the same local state.
 * Never deletes staff with tip history — deactivates instead.
 */
export async function syncRoster(locationId: string): Promise<RosterSyncResult> {
  const { team_members } = await searchTeamMembers(locationId);

  const squareIds = new Set(team_members.map((tm) => tm.id));
  const reviewStaffIds: number[] = [];
  let created = 0;
  let updated = 0;
  let deactivated = 0;
  let needsReview = 0;
  let excluded = 0;

  const syncTs = new Date().toISOString();

  db.transaction(() => {
    // Phase 1: upsert every active Square member
    for (const tm of team_members) {
      const name = displayName(tm);
      const titles = extractJobTitles(tm);
      const mapped = mapJobs(titles);
      const comp = extractCompensation(tm);

      const existing = db.prepare(
        'SELECT id, role FROM staff WHERE square_team_member_id = ?'
      ).get(tm.id) as { id: number; role: string } | undefined;

      if (existing) {
        // Update name and Square metadata, never match by name
        const roleVal = roleForStaffTable(mapped.defaultRole, mapped.state, existing.role);
        db.prepare(`
          UPDATE staff SET
            name = ?,
            role = ?,
            active = 1,
            source = 'square',
            square_status = ?,
            square_last_synced_at = ?,
            default_tip_split_role = ?,
            role_mapping_state = ?,
            pay_type = ?,
            salary_annual_cents = ?,
            salary_weekly_hours = ?
          WHERE id = ?
        `).run(
          name,
          roleVal,
          tm.status,
          syncTs,
          mapped.defaultRole,
          mapped.state,
          comp.payType,
          comp.salaryAnnualCents,
          comp.salaryWeeklyHours,
          existing.id,
        );
        updated++;
      } else {
        // Create new staff with a staff_code
        const roleVal = roleForStaffTable(mapped.defaultRole, mapped.state, null);
        const code = nextStaffCode();
        const result = db.prepare(`
          INSERT INTO staff (name, role, active, location_id, source, square_team_member_id, staff_code,
            square_status, square_last_synced_at, default_tip_split_role, role_mapping_state,
            pay_type, salary_annual_cents, salary_weekly_hours)
          VALUES (?, ?, 1, 1, 'square', ?, ?, ?, ?, ?, ?, ?, ?, ?)
        `).run(
          name,
          roleVal,
          tm.id,
          code,
          tm.status,
          syncTs,
          mapped.defaultRole,
          mapped.state,
          comp.payType,
          comp.salaryAnnualCents,
          comp.salaryWeeklyHours,
        );
        created++;
        reviewStaffIds.push(Number(result.lastInsertRowid));
      }

      // Track needs_review / excluded counts
      if (mapped.state === 'NEEDS_REVIEW') {
        needsReview++;
        const row = db.prepare(
          'SELECT id FROM staff WHERE square_team_member_id = ?'
        ).get(tm.id) as { id: number };
        if (!reviewStaffIds.includes(row.id)) reviewStaffIds.push(row.id);
      } else if (mapped.state === 'EXCLUDED') {
        excluded++;
      }

      // Upsert job rows in staff_square_jobs using real Square job_ids
      const staffRow = db.prepare(
        'SELECT id FROM staff WHERE square_team_member_id = ?'
      ).get(tm.id) as { id: number };

      db.prepare(
        'UPDATE staff_square_jobs SET active = 0 WHERE staff_id = ?'
      ).run(staffRow.id);

      const jobAssignments = extractJobAssignments(tm);
      for (const ja of jobAssignments) {
        const titleMapped = mapJobs([ja.job_title]);
        const mappedRole = titleMapped.defaultRole ?? 'EXCLUDED';

        db.prepare(`
          INSERT INTO staff_square_jobs (staff_id, square_job_id, square_job_title, mapped_tip_role, active, synced_at)
          VALUES (?, ?, ?, ?, 1, ?)
          ON CONFLICT (staff_id, square_job_id) DO UPDATE SET
            square_job_title = excluded.square_job_title,
            mapped_tip_role = excluded.mapped_tip_role,
            active = 1,
            synced_at = excluded.synced_at
        `).run(staffRow.id, ja.job_id, ja.job_title, mappedRole, syncTs);
      }
    }

    // Phase 2: mark locally-active staff absent from Square as inactive
    const localActive = db.prepare(
      `SELECT id, square_team_member_id FROM staff
       WHERE active = 1 AND square_team_member_id IS NOT NULL AND source = 'square'`
    ).all() as { id: number; square_team_member_id: string }[];

    for (const local of localActive) {
      if (!squareIds.has(local.square_team_member_id)) {
        // Check if staff has tip history — if so, deactivate (don't delete)
        const dists = db.prepare(
          'SELECT COUNT(*) AS n FROM tip_distributions WHERE staff_id = ?'
        ).get(local.id) as { n: number };

        if (dists.n > 0) {
          db.prepare(
            'UPDATE staff SET active = 0, square_status = ? WHERE id = ?'
          ).run('INACTIVE', local.id);
          deactivated++;
        } else {
          // No history — also deactivate (safer than delete; manager can purge)
          db.prepare(
            'UPDATE staff SET active = 0, square_status = ? WHERE id = ?'
          ).run('INACTIVE', local.id);
          deactivated++;
        }
      }
    }
  })();

  return {
    counts: { created, updated, deactivated, needsReview, excluded },
    reviewStaffIds,
    fetched: team_members.length,
  };
}
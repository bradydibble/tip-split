import { describe, it, expect, beforeAll, afterAll, beforeEach, afterEach } from 'vitest';
import { mkdtempSync, rmSync } from 'fs';
import { tmpdir } from 'os';
import { join } from 'path';

const tmp = mkdtempSync(join(tmpdir(), 'tipsplit-shift-test-'));
process.env.DATABASE_PATH = join(tmp, 'test.db');
process.env.SQUARE_ENVIRONMENT = 'mock';

let shiftImport: typeof import('./shift-import');
let db: typeof import('../db').default;
let resetMock: typeof import('./client').__resetMockOverrides;
let fixtures: typeof import('./fixtures');

beforeAll(async () => {
  shiftImport = await import('./shift-import');
  db = (await import('../db')).default;
  resetMock = (await import('./client')).__resetMockOverrides;
  fixtures = await import('./fixtures');
});

afterAll(() => {
  rmSync(tmp, { recursive: true, force: true });
});

afterEach(() => resetMock());

const TZ = 'America/Los_Angeles';

// Helper: create a shift at given local times for a team member
function makeShift(
  id: string,
  teamMemberId: string,
  startLocal: string,
  endLocal: string,
  opts?: { jobId?: string; jobTitle?: string }
): import('./fixtures').SquareScheduledShift {
  const bd = '2026-08-27';
  return {
    id,
    published_shift_details: {
      team_member_id: teamMemberId,
      location_id: fixtures.TEST_LOCATION_ID,
      job_id: opts?.jobId,
      start_at: `${bd}T${startLocal}:00-07:00`,
      end_at: `${bd}T${endLocal}:00-07:00`,
    },
  };
}

// ── Shift partitioning ──────────────────────────────────────────────────────

describe('partitionShift', () => {
  it('assigns a morning shift (11:00-14:00) to Lunch', () => {
    const shift = makeShift('S1', fixtures.TM_BARKEEP, '11:00', '14:00');
    const windows = shiftImport.partitionShift(shift, TZ);
    expect(windows).toEqual(['Lunch']);
  });

  it('assigns an evening shift (17:00-21:00) to Dinner', () => {
    const shift = makeShift('S2', fixtures.TM_BARKEEP, '17:00', '21:00');
    const windows = shiftImport.partitionShift(shift, TZ);
    expect(windows).toEqual(['Dinner']);
  });

  it('assigns a shift starting at exactly 15:00 to Dinner', () => {
    const shift = makeShift('S3', fixtures.TM_BARKEEP, '15:00', '21:00');
    const windows = shiftImport.partitionShift(shift, TZ);
    expect(windows).toEqual(['Dinner']);
  });

  it('assigns a shift ending at exactly 15:00 to Lunch', () => {
    const shift = makeShift('S4', fixtures.TM_BARKEEP, '11:00', '15:00');
    const windows = shiftImport.partitionShift(shift, TZ);
    expect(windows).toEqual(['Lunch']);
  });

  it('assigns a boundary-spanning shift (14:00-17:00) to one window by midpoint', () => {
    const shift = makeShift('S5', fixtures.TM_BARKEEP, '14:00', '17:00');
    // Midpoint = 15:30 → Dinner (since midpoint >= 15:00)
    const windows = shiftImport.partitionShift(shift, TZ);
    expect(windows).toEqual(['Dinner']);
  });

  it('assigns a 14:00-16:00 shift to Lunch (midpoint 15:00 = boundary, goes to Lunch)', () => {
    const shift = makeShift('S6', fixtures.TM_BARKEEP, '14:00', '16:00');
    // Midpoint = 15:00 → boundary, falls to Lunch (< comparison)
    const windows = shiftImport.partitionShift(shift, TZ);
    expect(windows).toEqual(['Lunch']);
  });

  it('allows dual assignment for boundary-spanning shifts when opted in', () => {
    const shift = makeShift('S7', fixtures.TM_BARKEEP, '14:00', '17:00');
    const windows = shiftImport.partitionShift(shift, TZ, { allowDualAssignment: true });
    expect(windows).toEqual(['Lunch', 'Dinner']);
  });

  it('assigns overnight shift to Dinner', () => {
    const shift = makeShift('S8', fixtures.TM_BARKEEP, '20:00', '02:00');
    const windows = shiftImport.partitionShift(shift, TZ);
    expect(windows).toEqual(['Dinner']);
  });
});

describe('partitionShifts', () => {
  it('separates shifts into lunch and dinner groups', () => {
    const shifts = [
      makeShift('S1', fixtures.TM_BARKEEP, '11:00', '14:00'),  // Lunch
      makeShift('S2', fixtures.TM_COOK_B, '15:00', '21:00'),   // Dinner
      makeShift('S3', fixtures.TM_SERVER_A, '12:00', '15:00'), // Lunch
    ];

    const { lunch, dinner } = shiftImport.partitionShifts(shifts, TZ);
    expect(lunch.length).toBe(2);
    expect(dinner.length).toBe(1);
  });

  it('does not duplicate a shift in both groups by default', () => {
    const shifts = [
      makeShift('S1', fixtures.TM_BARKEEP, '14:00', '17:00'),  // Boundary-spanning
    ];

    const { lunch, dinner } = shiftImport.partitionShifts(shifts, TZ);
    const totalAssigned = lunch.length + dinner.length;
    expect(totalAssigned).toBe(1); // Assigned once, not twice
  });
});

// ── Attendance generation ───────────────────────────────────────────────────

describe('buildAttendance', () => {
  beforeEach(() => {
    db.exec('DELETE FROM staff_square_jobs');
    db.exec('DELETE FROM staff');
    // Insert staff matching the fixture team member IDs
    db.prepare(
      `INSERT INTO staff (name, role, active, source, square_team_member_id, staff_code,
        square_status, default_tip_split_role, role_mapping_state)
       VALUES (?, ?, 1, 'square', ?, 'TS-0001', 'ACTIVE', 'BAR', 'MAPPED')`
    ).run('Pat Mixwell', 'Bar', fixtures.TM_BARKEEP);

    db.prepare(
      `INSERT INTO staff (name, role, active, source, square_team_member_id, staff_code,
        square_status, default_tip_split_role, role_mapping_state)
       VALUES (?, ?, 1, 'square', ?, 'TS-0002', 'ACTIVE', 'FOH', 'MAPPED')`
    ).run('Jordan Carries', 'FOH', fixtures.TM_SERVER_A);

    db.prepare(
      `INSERT INTO staff (name, role, active, source, square_team_member_id, staff_code,
        square_status, default_tip_split_role, role_mapping_state)
       VALUES (?, ?, 1, 'square', ?, 'TS-0003', 'ACTIVE', 'EXCLUDED', 'EXCLUDED')`
    ).run('Alex Leads', 'FOH', fixtures.TM_MANAGER_X);
  });

  it('generates attendance for staff found in the roster', () => {
    const shifts = [
      makeShift('S1', fixtures.TM_BARKEEP, '11:00', '14:00'),
    ];
    const attendance = shiftImport.buildAttendance(shifts);
    expect(attendance.length).toBe(1);
    expect(attendance[0].nameSnapshot).toBe('Pat Mixwell');
    expect(attendance[0].defaultRole).toBe('BAR');
    expect(attendance[0].inclusionState).toBe('INCLUDED');
  });

  it('marks EXCLUDED staff as excluded in attendance', () => {
    const shifts = [
      makeShift('S1', fixtures.TM_MANAGER_X, '11:00', '21:00'),
    ];
    const attendance = shiftImport.buildAttendance(shifts);
    expect(attendance[0].inclusionState).toBe('EXCLUDED');
    expect(attendance[0].defaultRole).toBe('EXCLUDED');
  });

  it('flags staff not in the local roster as NEEDS_REVIEW', () => {
    const shifts = [
      makeShift('S1', 'TM-not-in-roster', '11:00', '14:00'),
    ];
    const attendance = shiftImport.buildAttendance(shifts);
    expect(attendance[0].inclusionState).toBe('NEEDS_REVIEW');
    expect(attendance[0].nameSnapshot).toBe('(Not in roster)');
  });

  it('captures scheduled job ID from the shift and title from staff_square_jobs', () => {
    // Synced job row: JOB-001 → Bartender (roster sync populates this)
    db.prepare(`
      INSERT INTO staff_square_jobs (staff_id, square_job_id, square_job_title, mapped_tip_role, active, synced_at)
      VALUES ((SELECT id FROM staff WHERE square_team_member_id = ?), 'JOB-001', 'Bartender', 'BAR', 1, datetime('now'))
    `).run(fixtures.TM_BARKEEP);

    const shifts = [
      makeShift('S1', fixtures.TM_BARKEEP, '11:00', '14:00', {
        jobId: 'JOB-001',
      }),
    ];
    const attendance = shiftImport.buildAttendance(shifts);
    expect(attendance[0].scheduledJobId).toBe('JOB-001');
    expect(attendance[0].scheduledJobTitle).toBe('Bartender');
  });
});

// ── Report creation (idempotency) ────────────────────────────────────────────

describe('createOrGetReport', () => {
  beforeEach(() => {
    db.exec('DELETE FROM shift_report_attendance');
    db.exec('DELETE FROM shift_reports');
    db.exec('DELETE FROM staff_square_jobs');
    db.exec('DELETE FROM staff');
  });

  it('creates a DRAFT report for a new business date and shift', async () => {
    const result = await shiftImport.createOrGetReport({
      locationId: fixtures.TEST_LOCATION_ID,
      businessDate: '2026-08-27',
      shiftType: 'Lunch',
    }, TZ);

    expect(result.created).toBe(true);
    expect(result.reportId).toBeGreaterThan(0);

    const report = db.prepare('SELECT * FROM shift_reports WHERE id = ?').get(result.reportId) as
      { state: string; shift_type: string; business_date: string };
    expect(report.state).toBe('DRAFT');
    expect(report.shift_type).toBe('Lunch');
    expect(report.business_date).toBe('2026-08-27');
  });

  it('returns the same report when called twice (idempotent)', async () => {
    const r1 = await shiftImport.createOrGetReport({
      locationId: fixtures.TEST_LOCATION_ID,
      businessDate: '2026-08-27',
      shiftType: 'Dinner',
    }, TZ);

    const r2 = await shiftImport.createOrGetReport({
      locationId: fixtures.TEST_LOCATION_ID,
      businessDate: '2026-08-27',
      shiftType: 'Dinner',
    }, TZ);

    expect(r2.created).toBe(false);
    expect(r2.reportId).toBe(r1.reportId);

    // No duplicate
    const count = (db.prepare(
      'SELECT COUNT(*) AS n FROM shift_reports WHERE business_date = ? AND shift_type = ?'
    ).get('2026-08-27', 'Dinner') as { n: number }).n;
    expect(count).toBe(1);
  });

  it('can create separate Lunch and Dinner reports for the same date', async () => {
    const lunch = await shiftImport.createOrGetReport({
      locationId: fixtures.TEST_LOCATION_ID,
      businessDate: '2026-08-27',
      shiftType: 'Lunch',
    }, TZ);

    const dinner = await shiftImport.createOrGetReport({
      locationId: fixtures.TEST_LOCATION_ID,
      businessDate: '2026-08-27',
      shiftType: 'Dinner',
    }, TZ);

    expect(lunch.reportId).not.toBe(dinner.reportId);

    const count = (db.prepare(
      'SELECT COUNT(*) AS n FROM shift_reports WHERE business_date = ?'
    ).get('2026-08-27') as { n: number }).n;
    expect(count).toBe(2);
  });

  it('populates attendance from Square shifts when fetchShifts is true', async () => {
    // First sync the roster so staff exist
    const { syncRoster } = await import('./roster-sync');
    await syncRoster(fixtures.TEST_LOCATION_ID);

    const result = await shiftImport.createOrGetReport({
      locationId: fixtures.TEST_LOCATION_ID,
      businessDate: '2026-08-27',
      shiftType: 'Lunch',
    }, TZ, { fetchShifts: true });

    expect(result.attendanceCount).toBeGreaterThan(0);

    const report = db.prepare('SELECT state FROM shift_reports WHERE id = ?').get(result.reportId) as
      { state: string };
    expect(report.state).toBe('READY_FOR_REVIEW');
  });
});

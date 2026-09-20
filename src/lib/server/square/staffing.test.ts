import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { mkdtempSync, rmSync } from 'fs';
import { tmpdir } from 'os';
import { join } from 'path';

const tmp = mkdtempSync(join(tmpdir(), 'tipsplit-staffing-test-'));
process.env.DATABASE_PATH = join(tmp, 'test.db');
process.env.SQUARE_ENVIRONMENT = 'mock';
process.env.SQUARE_ACCESS_TOKEN = 'test-token';

let staffing: typeof import('./staffing');
let db: typeof import('../db').default;
let fixtures: typeof import('./fixtures');

const TZ = 'America/Los_Angeles';
// Fixtures schedule (2026-08-27, published, assigned):
//   Lunch:  barkeep, server
//   Dinner: barkeep, cook, busser, manager (all-day shift partitions to
//           Dinner by the midpoint rule)
// The busser is deliberately NOT seeded into the roster — dinner must
// report them as scheduled-but-not-in-roster.
// Team-member ids come from the fixtures module (imported in beforeAll —
// the database path env must be set first), so the roster is built there.

interface RosterSeed {
  name: string;
  role: 'FOH' | 'Kitchen' | 'Bar' | 'Busser';
  code: string;
  tm: string;
  defaultRole: string | null;
  state: string | null;
}

let ROSTER: RosterSeed[] = [];

beforeAll(async () => {
  staffing = await import('./staffing');
  db = (await import('../db')).default;
  fixtures = await import('./fixtures');

  ROSTER = [
    { name: 'Pat Mixwell', role: 'Bar', code: 'TS-4001', tm: fixtures.TM_BARKEEP, defaultRole: 'BAR', state: 'MAPPED' },
    { name: 'Jordan Carries', role: 'FOH', code: 'TS-4002', tm: fixtures.TM_SERVER_A, defaultRole: 'FOH', state: 'MAPPED' },
    { name: 'Sam Grills', role: 'Kitchen', code: 'TS-4003', tm: fixtures.TM_COOK_B, defaultRole: 'KITCHEN', state: 'MAPPED' },
    { name: 'Alex Leads', role: 'FOH', code: 'TS-4004', tm: fixtures.TM_MANAGER_X, defaultRole: 'EXCLUDED', state: 'EXCLUDED' },
  ];

  db.prepare(`
    INSERT INTO square_connections (location_id, merchant_id, square_location_id, timezone, api_version)
    VALUES ('1', 'M-TEST', ?, ?, '2024-12-18')
  `).run(fixtures.TEST_LOCATION_ID, TZ);

  for (const r of ROSTER) {
    db.prepare(`
      INSERT INTO staff (name, role, staff_code, square_team_member_id, default_tip_split_role, role_mapping_state)
      VALUES (?, ?, ?, ?, ?, ?)
    `).run(r.name, r.role, r.code, r.tm, r.defaultRole, r.state);
  }

  const insertJob = db.prepare(`
    INSERT INTO staff_square_jobs (staff_id, square_job_id, square_job_title, mapped_tip_role, synced_at)
    VALUES ((SELECT id FROM staff WHERE square_team_member_id = ?), ?, ?, ?, datetime('now'))
  `);
  insertJob.run(fixtures.TM_BARKEEP, 'JOB-bartender', 'Bartender', 'BAR');
  insertJob.run(fixtures.TM_SERVER_A, 'JOB-food-runner', 'Food Runner', 'FOH');
  insertJob.run(fixtures.TM_COOK_B, 'JOB-cook', 'Cook', 'KITCHEN');
  insertJob.run(fixtures.TM_MANAGER_X, 'JOB-manager', 'Manager', 'EXCLUDED');
  // No busser staff row exists (deliberately unsynced) — staff_square_jobs
  // links jobs to roster members, so their not-in-roster entry carries no
  // job title.
});

afterAll(() => {
  rmSync(tmp, { recursive: true, force: true });
});

const staffIdOf = (tm: string): number =>
  (db.prepare('SELECT id FROM staff WHERE square_team_member_id = ?').get(tm) as { id: number }).id;

describe('getShiftStaffing — live Square schedule (mock transport)', () => {
  it('defaults Lunch to the scheduled lunch crew with Square-suggested roles', async () => {
    const result = await staffing.getShiftStaffing('2026-08-27', 'Lunch');

    expect(result.available).toBe(true);
    expect(result.source).toBe('square_live');
    expect(result.staffed.map(p => p.staffId).sort())
      .toEqual([staffIdOf(fixtures.TM_BARKEEP), staffIdOf(fixtures.TM_SERVER_A)].sort());

    const pat = result.staffed.find(p => p.name === 'Pat Mixwell');
    expect(pat?.suggestedRole).toBe('BAR');
    expect(pat?.scheduledJobTitle).toBe('Bartender');
    expect(pat?.staffCode).toBe('TS-4001');

    const jordan = result.staffed.find(p => p.name === 'Jordan Carries');
    expect(jordan?.suggestedRole).toBe('FOH');

    expect(result.notInRoster).toEqual([]);
    expect(result.excluded).toEqual([]);
  });

  it('defaults Dinner to its crew, excluding role-mapped managers and flagging unsynced people', async () => {
    const result = await staffing.getShiftStaffing('2026-08-27', 'Dinner');

    expect(result.available).toBe(true);
    expect(result.source).toBe('square_live');
    expect(result.staffed.map(p => p.staffId).sort())
      .toEqual([staffIdOf(fixtures.TM_BARKEEP), staffIdOf(fixtures.TM_COOK_B)].sort());

    // Alex (manager) is scheduled but role-mapped EXCLUDED — never a default.
    expect(result.excluded).toEqual([
      { name: 'Alex Leads', scheduledJobTitle: 'Manager' },
    ]);

    // Robin is scheduled but was never synced into the roster (no staff
    // row → no job-title link either).
    expect(result.notInRoster).toEqual([
      { name: null, scheduledJobTitle: null },
    ]);
  });

  // NOTE: the 'no_schedule' source (nothing published for a window) cannot
  // be expressed through the mock transport — it generates a schedule for
  // every requested business date. That branch is a one-line guard in
  // staffing.ts; it is exercised only against a real Square account or a
  // custom mock override.
});

describe('getShiftStaffing — reviewed shift report wins over live schedule', () => {
  it('serves attendance from an existing shift report, honoring removals', async () => {
    const reportId = Number(db.prepare(`
      INSERT INTO shift_reports (location_id, business_date, shift_type, state)
      VALUES (?, '2026-08-20', 'Lunch', 'READY_FOR_REVIEW')
    `).run(fixtures.TEST_LOCATION_ID).lastInsertRowid);

    const insertAtt = db.prepare(`
      INSERT INTO shift_report_attendance
        (shift_report_id, staff_id, square_team_member_id, name_snapshot,
         scheduled_job_title, default_role, selected_role, inclusion_state)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?)
    `);
    // Pat included with a confirmed selected role.
    insertAtt.run(reportId, staffIdOf(fixtures.TM_BARKEEP), fixtures.TM_BARKEEP, 'Pat Mixwell',
      'Bartender', 'BAR', 'BAR', 'INCLUDED');
    // Alex excluded by review.
    insertAtt.run(reportId, staffIdOf(fixtures.TM_MANAGER_X), fixtures.TM_MANAGER_X, 'Alex Leads',
      'Manager', 'EXCLUDED', null, 'EXCLUDED');
    // Dana: scheduled, not in the roster.
    insertAtt.run(reportId, null, 'TM-not-in-roster', 'Dana Notyet', null, null, null, 'NEEDS_REVIEW');
    // Jordan was removed during review (missed work).
    insertAtt.run(reportId, staffIdOf(fixtures.TM_SERVER_A), fixtures.TM_SERVER_A, 'Jordan Carries',
      'Food Runner', 'FOH', null, 'REMOVED');

    const result = await staffing.getShiftStaffing('2026-08-20', 'Lunch');

    expect(result.available).toBe(true);
    expect(result.source).toBe('shift_report');
    expect(result.staffed.map(p => p.name)).toEqual(['Pat Mixwell']);
    expect(result.staffed[0].suggestedRole).toBe('BAR');
    expect(result.excluded.map(p => p.name)).toEqual(['Alex Leads']);
    expect(result.notInRoster.map(p => p.name)).toEqual(['Dana Notyet']);
  });

  it('falls back to the live schedule when the report has no attendance', async () => {
    db.prepare(`
      INSERT INTO shift_reports (location_id, business_date, shift_type, state)
      VALUES (?, '2026-08-19', 'Lunch', 'DRAFT')
    `).run(fixtures.TEST_LOCATION_ID);

    const result = await staffing.getShiftStaffing('2026-08-19', 'Lunch');
    expect(result.source).toBe('square_live');
    expect(result.available).toBe(true);
  });
});

describe('getShiftStaffing — unconfigured deployments', () => {
  it('answers not_configured when no Square token is present', async () => {
    const saved = process.env.SQUARE_ACCESS_TOKEN;
    process.env.SQUARE_ACCESS_TOKEN = '';
    try {
      const result = await staffing.getShiftStaffing('2026-08-27', 'Lunch');
      expect(result.available).toBe(false);
      expect(result.source).toBe('not_configured');
      expect(result.staffed).toEqual([]);
    } finally {
      process.env.SQUARE_ACCESS_TOKEN = saved;
    }
  });
});

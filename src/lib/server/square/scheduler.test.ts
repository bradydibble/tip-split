import { describe, it, expect, beforeAll, afterAll, beforeEach } from 'vitest';
import { mkdtempSync, rmSync } from 'fs';
import { tmpdir } from 'os';
import { join } from 'path';
import type { WeeklyHours } from './scheduler';

const tmp = mkdtempSync(join(tmpdir(), 'tipsplit-sched-test-'));
process.env.DATABASE_PATH = join(tmp, 'test.db');
process.env.SQUARE_ENVIRONMENT = 'mock';

let scheduler: typeof import('./scheduler');
let db: typeof import('../db').default;
let fixtures: typeof import('./fixtures');

let TZ: string;
let LOC_ID: string;
let WEEKLY_HOURS: import('./scheduler').WeeklyHours;

beforeAll(async () => {
  scheduler = await import('./scheduler');
  db = (await import('../db')).default;
  fixtures = await import('./fixtures');

  TZ = 'America/Los_Angeles';
  LOC_ID = fixtures.TEST_LOCATION_ID;
  WEEKLY_HOURS = {
    MON: { open: '11:00', close: '21:00' },
    TUE: { open: '11:00', close: '21:00' },
    WED: { open: '11:00', close: '21:00' },
    THU: { open: '11:00', close: '21:00' },
    FRI: { open: '11:00', close: '22:00' },
    SAT: { open: '11:00', close: '22:00' },
    SUN: { open: '11:00', close: '21:00' },
  };

  // FK on dinner_close_overrides.actor → users(id); seed a user.
  db.prepare(
    "INSERT OR IGNORE INTO users (pin_hash, role) VALUES ('$2a$10$dummyhashfortestonlyxxxxxxxxxxxxxxxxxxxxxx', 'manager')"
  ).run();
});

afterAll(() => {
  rmSync(tmp, { recursive: true, force: true });
});

// ── Weekly hours parsing ─────────────────────────────────────────────────────

describe('parseWeeklyHours', () => {
  it('parses Square business_hours JSON', () => {
    const json = JSON.stringify({
      periods: [
        { day_of_week: 'MON', start_local_time: '11:00:00', end_local_time: '21:00:00' },
        { day_of_week: 'FRI', start_local_time: '11:00:00', end_local_time: '22:00:00' },
      ],
    });
    const hours = scheduler.parseWeeklyHours(json);
    expect(hours.MON).toEqual({ open: '11:00', close: '21:00' });
    expect(hours.FRI).toEqual({ open: '11:00', close: '22:00' });
  });

  it('returns empty object for null', () => {
    expect(scheduler.parseWeeklyHours(null)).toEqual({});
  });

  it('returns empty object for invalid JSON', () => {
    expect(scheduler.parseWeeklyHours('{invalid')).toEqual({});
  });
});

// ── Dinner close resolution ─────────────────────────────────────────────────

describe('getDinnerClose', () => {
  beforeEach(() => {
    db.exec('DELETE FROM dinner_close_overrides');
  });

  it('uses weekly hours when no override exists', () => {
    const result = scheduler.getDinnerClose(LOC_ID, '2026-08-27', WEEKLY_HOURS);
    // 2026-08-27 is a Thursday → close at 21:00
    expect(result?.closeLocal).toBe('21:00');
    expect(result?.source).toBe('weekly_hours');
  });

  it('prefers daily override over weekly hours', () => {
    // Insert an override
    db.prepare(
      `INSERT INTO dinner_close_overrides (location_id, business_date, close_local, actor, reason)
       VALUES (?, ?, ?, 1, 'Private event')`
    ).run(LOC_ID, '2026-08-27', '18:00');

    const result = scheduler.getDinnerClose(LOC_ID, '2026-08-27', WEEKLY_HOURS);
    expect(result?.closeLocal).toBe('18:00');
    expect(result?.source).toBe('override');
  });

  it('returns null when no hours or override exist', () => {
    const result = scheduler.getDinnerClose(LOC_ID, '2026-08-27', {});
    expect(result).toBeNull();
  });
});

// ── Due-report detection ─────────────────────────────────────────────────────

describe('evaluateDue', () => {
  it('Lunch is due at 15:05 local time', () => {
    // 2026-08-27 is Thursday. 15:05 PDT = 22:05 UTC
    const now = new Date('2026-08-27T22:05:00Z'); // 15:05 PDT
    const due = scheduler.evaluateDue(now, TZ, LOC_ID, WEEKLY_HOURS);
    expect(due.lunch).toBe(true);
  });

  it('Lunch is NOT due before 15:05', () => {
    const now = new Date('2026-08-27T21:59:00Z'); // 14:59 PDT
    const due = scheduler.evaluateDue(now, TZ, LOC_ID, WEEKLY_HOURS);
    expect(due.lunch).toBe(false);
  });

  it('Dinner is due 5 min after close (21:00 → 21:05)', () => {
    const now = new Date('2026-08-28T04:05:00Z'); // 21:05 PDT on Aug 27
    const due = scheduler.evaluateDue(now, TZ, LOC_ID, WEEKLY_HOURS);
    expect(due.dinner).toBe(true);
    expect(due.businessDate).toBe('2026-08-27');
  });

  it('Dinner is NOT due before close+5', () => {
    const now = new Date('2026-08-28T03:59:00Z'); // 20:59 PDT on Aug 27
    const due = scheduler.evaluateDue(now, TZ, LOC_ID, WEEKLY_HOURS);
    expect(due.dinner).toBe(false);
  });

  it('Friday close at 22:00 → dinner due at 22:05', () => {
    // 2026-08-28 is Friday
    const now = new Date('2026-08-29T05:06:00Z'); // 22:06 PDT on Aug 28
    const due = scheduler.evaluateDue(now, TZ, LOC_ID, WEEKLY_HOURS);
    expect(due.dinner).toBe(true);
    expect(due.businessDate).toBe('2026-08-28');
  });

  it('both Lunch and Dinner are due after dinner close', () => {
    // At 21:10 PDT, both lunch (15:05) and dinner (21:05) are due
    const now = new Date('2026-08-28T04:10:00Z'); // 21:10 PDT
    const due = scheduler.evaluateDue(now, TZ, LOC_ID, WEEKLY_HOURS);
    expect(due.lunch).toBe(true);
    expect(due.dinner).toBe(true);
  });
});

// ── Midnight-crossing close ─────────────────────────────────────────────────

describe('evaluateDue — midnight-crossing close', () => {
  const lateHours: WeeklyHours = {
    THU: { open: '11:00', close: '02:00' }, // closes at 2 AM Friday
  };

  it('dinner close at 02:00 is due at 02:05, still same business date', () => {
    // Business date is Thursday Aug 27, but it's now 2:05 AM Friday local
    // 2026-08-28T09:05:00Z = 02:05 PDT on Aug 28
    // Business date should still be Aug 27 (rolls at 3 AM)
    const now = new Date('2026-08-28T09:05:00Z');
    const due = scheduler.evaluateDue(now, TZ, LOC_ID, lateHours);
    expect(due.businessDate).toBe('2026-08-27');
    // Dinner is due since we're past 02:05
    expect(due.dinner).toBe(true);
  });
});

// ── Dinner close override ───────────────────────────────────────────────────

describe('setDinnerCloseOverride', () => {
  beforeEach(() => {
    db.exec('DELETE FROM dinner_close_overrides');
  });

  it('inserts an override with reason', () => {
    scheduler.setDinnerCloseOverride(LOC_ID, '2026-08-27', '18:00', 1, 'Early close for private event');

    const row = db.prepare(
      'SELECT * FROM dinner_close_overrides WHERE business_date = ?'
    ).get('2026-08-27') as { close_local: string; reason: string };
    expect(row.close_local).toBe('18:00');
    expect(row.reason).toBe('Early close for private event');
  });

  it('requires a reason', () => {
    expect(() =>
      scheduler.setDinnerCloseOverride(LOC_ID, '2026-08-27', '18:00', 1, '')
    ).toThrow('Reason is required');
  });

  it('upserts: updating an existing override replaces it', () => {
    scheduler.setDinnerCloseOverride(LOC_ID, '2026-08-27', '18:00', 1, 'First');
    scheduler.setDinnerCloseOverride(LOC_ID, '2026-08-27', '17:00', 1, 'Changed');

    const rows = db.prepare(
      'SELECT * FROM dinner_close_overrides WHERE business_date = ?'
    ).all('2026-08-27');
    expect(rows.length).toBe(1);

    const row = rows[0] as { close_local: string; reason: string };
    expect(row.close_local).toBe('17:00');
    expect(row.reason).toBe('Changed');
  });
});

// ── Scheduler tick (integration) ─────────────────────────────────────────────

describe('runSchedulerTick', () => {
  beforeEach(() => {
    db.exec('DELETE FROM shift_report_attendance');
    db.exec('DELETE FROM shift_reports');
    db.exec('DELETE FROM dinner_close_overrides');
    db.exec('DELETE FROM staff_square_jobs');
    db.exec('DELETE FROM staff');

    // Ensure a connection exists
    db.prepare(`
      INSERT OR REPLACE INTO square_connections
        (location_id, merchant_id, square_location_id, timezone, api_version,
         weekly_hours_json, last_validation_ok)
      VALUES (?, 'ML_TEST', ?, ?, '2024-12-18', ?, 1)
    `).run(
      LOC_ID, LOC_ID, TZ,
      JSON.stringify({ periods: [
        { day_of_week: 'THU', start_local_time: '11:00:00', end_local_time: '21:00:00' },
      ]})
    );
  });

  it('creates a lunch report when lunch is due', async () => {
    // 15:10 PDT = past lunch due time
    const now = new Date('2026-08-27T22:10:00Z');
    const result = await scheduler.runSchedulerTick(now);

    expect(result.errors).toHaveLength(0);
    const lunchActions = result.actions.filter((a) => a.shiftType === 'Lunch');
    expect(lunchActions.length).toBe(1);
    expect(lunchActions[0].created).toBe(true);
  });

  it('does not duplicate an existing report on second tick', async () => {
    const now = new Date('2026-08-27T22:10:00Z');
    await scheduler.runSchedulerTick(now);
    const result2 = await scheduler.runSchedulerTick(now);

    const lunchActions = result2.actions.filter((a) => a.shiftType === 'Lunch');
    expect(lunchActions.length).toBe(1);
    expect(lunchActions[0].created).toBe(false);
  });

  it('returns error when no connection is configured', async () => {
    db.exec('DELETE FROM square_connections');
    const result = await scheduler.runSchedulerTick(new Date());
    expect(result.errors.length).toBeGreaterThan(0);
  });
});

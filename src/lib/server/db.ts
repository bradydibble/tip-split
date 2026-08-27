import Database from 'better-sqlite3';
import { mkdirSync } from 'fs';
import { dirname } from 'path';
import bcrypt from 'bcryptjs';
import { DEFAULT_TIMEZONE } from '../business-date';

const dbPath = process.env.DATABASE_PATH ?? './data/tipsplit.db';

mkdirSync(dirname(dbPath), { recursive: true });

const db = new Database(dbPath);

db.pragma('journal_mode = WAL');
db.pragma('foreign_keys = ON');

db.exec(`
  CREATE TABLE IF NOT EXISTS users (
    id          INTEGER PRIMARY KEY AUTOINCREMENT,
    pin_hash    TEXT    NOT NULL,
    role        TEXT    NOT NULL DEFAULT 'shift_lead'
                        CHECK (role IN ('shift_lead', 'manager')),
    location_id INTEGER NOT NULL DEFAULT 1 CHECK (location_id = 1),
    created_at  INTEGER NOT NULL DEFAULT (unixepoch())
  );

  CREATE TABLE IF NOT EXISTS staff (
    id                    INTEGER PRIMARY KEY AUTOINCREMENT,
    name                  TEXT    NOT NULL,
    role                  TEXT    NOT NULL CHECK (role IN ('FOH', 'Kitchen', 'Bar', 'Busser')),
    active                INTEGER NOT NULL DEFAULT 1,
    location_id           INTEGER NOT NULL DEFAULT 1 CHECK (location_id = 1),
    source                TEXT    NOT NULL DEFAULT 'manual' CHECK (source IN ('manual', 'square')),
    square_team_member_id TEXT    UNIQUE
  );

  CREATE TABLE IF NOT EXISTS shift_assignments (
    id       INTEGER PRIMARY KEY AUTOINCREMENT,
    staff_id INTEGER NOT NULL REFERENCES staff(id) ON DELETE CASCADE,
    date     TEXT    NOT NULL,
    shift    TEXT    NOT NULL CHECK (shift IN ('Lunch', 'Dinner', 'Both')),
    excluded INTEGER NOT NULL DEFAULT 0
  );

  CREATE TABLE IF NOT EXISTS tip_calculations (
    id                    INTEGER PRIMARY KEY AUTOINCREMENT,
    date                  TEXT    NOT NULL,
    shift                 TEXT    NOT NULL CHECK (shift IN ('Lunch', 'Dinner')),
    gross_tips_cents      INTEGER NOT NULL,
    liquor_sales_cents    INTEGER NOT NULL,
    cc_fee_rate           REAL    NOT NULL,
    kitchen_pct           REAL    NOT NULL,
    bar_liquor_pct        REAL    NOT NULL,
    cc_fees_cents         INTEGER NOT NULL,
    tips_after_fees_cents INTEGER NOT NULL,
    kitchen_pool_cents    INTEGER NOT NULL,
    bar_pool_cents        INTEGER NOT NULL,
    busser_pool_cents     INTEGER NOT NULL DEFAULT 0,
    foh_pool_cents        INTEGER NOT NULL,
    location_id           INTEGER NOT NULL DEFAULT 1 CHECK (location_id = 1),
    created_at            INTEGER NOT NULL DEFAULT (unixepoch())
  );

  CREATE TABLE IF NOT EXISTS tip_distributions (
    id                   INTEGER PRIMARY KEY AUTOINCREMENT,
    calculation_id       INTEGER NOT NULL REFERENCES tip_calculations(id) ON DELETE CASCADE,
    staff_id             INTEGER,
    name                 TEXT    NOT NULL,
    role                 TEXT    NOT NULL,
    foh_share_cents      INTEGER NOT NULL DEFAULT 0,
    bar_pool_share_cents INTEGER NOT NULL DEFAULT 0,
    kitchen_share_cents  INTEGER NOT NULL DEFAULT 0,
    busser_share_cents   INTEGER NOT NULL DEFAULT 0,
    total_cents          INTEGER NOT NULL
  );

  CREATE TABLE IF NOT EXISTS settings (
    key         TEXT    NOT NULL,
    value       TEXT    NOT NULL,
    location_id INTEGER NOT NULL DEFAULT 1 CHECK (location_id = 1),
    PRIMARY KEY (key, location_id)
  );

  CREATE TABLE IF NOT EXISTS sessions (
    id         TEXT    PRIMARY KEY,
    user_id    INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    expires_at TEXT    NOT NULL  -- ISO8601 e.g. '2026-04-06T22:00:00.000Z'
  );

  CREATE TABLE IF NOT EXISTS export_log (
    id             INTEGER PRIMARY KEY AUTOINCREMENT,
    calculation_id INTEGER NOT NULL REFERENCES tip_calculations(id) ON DELETE CASCADE,
    exported_at    INTEGER NOT NULL DEFAULT (unixepoch()),
    exported_by    INTEGER REFERENCES users(id),
    location_id    INTEGER NOT NULL DEFAULT 1 CHECK (location_id = 1)
  );
`);

// Migrations for columns added after initial schema
for (const sql of [
  "ALTER TABLE staff ADD COLUMN source TEXT NOT NULL DEFAULT 'manual'",
  "ALTER TABLE staff ADD COLUMN square_team_member_id TEXT",
  "ALTER TABLE users ADD COLUMN name TEXT",
  "ALTER TABLE tip_calculations ADD COLUMN voided INTEGER NOT NULL DEFAULT 0",
  "ALTER TABLE tip_calculations ADD COLUMN busser_pool_cents INTEGER NOT NULL DEFAULT 0",
  "ALTER TABLE tip_distributions ADD COLUMN busser_share_cents INTEGER NOT NULL DEFAULT 0",
  // Phase 1.5: staff_code (nullable; uniqueness via idx_staff_code, non-null
  // maintained by the insert path).
  "ALTER TABLE staff ADD COLUMN staff_code TEXT",
  "ALTER TABLE tip_distributions ADD COLUMN staff_code TEXT",
  // Phase 2 — move-between-roles: snapshot the role performed per shift.
  "ALTER TABLE shift_assignments ADD COLUMN effective_role TEXT NOT NULL DEFAULT 'FOH' CHECK (effective_role IN ('FOH', 'Kitchen', 'Bar', 'Busser'))",
  // Phase 2 — adjustment tracking on each distribution row.
  "ALTER TABLE tip_distributions ADD COLUMN adjustment_cents INTEGER NOT NULL DEFAULT 0",
  "ALTER TABLE tip_distributions ADD COLUMN adjustment_reason TEXT",
]) {
  try { db.exec(sql); } catch { /* column already exists */ }
}

// Migration: allow the 'Busser' role on existing staff tables. SQLite can't
// ALTER a CHECK constraint, so recreate the table (12-step procedure) only if
// the current definition predates Busser.
const staffDef = (db.prepare(
  "SELECT sql FROM sqlite_master WHERE type='table' AND name='staff'"
).get() as { sql: string } | undefined)?.sql ?? '';
if (staffDef && !staffDef.includes('Busser')) {
  db.pragma('foreign_keys = OFF');
  db.transaction(() => {
    db.exec(`
      CREATE TABLE staff_new (
        id                    INTEGER PRIMARY KEY AUTOINCREMENT,
        name                  TEXT    NOT NULL,
        role                  TEXT    NOT NULL CHECK (role IN ('FOH', 'Kitchen', 'Bar', 'Busser')),
        active                INTEGER NOT NULL DEFAULT 1,
        location_id           INTEGER NOT NULL DEFAULT 1 CHECK (location_id = 1),
        source                TEXT    NOT NULL DEFAULT 'manual' CHECK (source IN ('manual', 'square')),
        square_team_member_id TEXT    UNIQUE,
        staff_code            TEXT    UNIQUE
      );
      INSERT INTO staff_new (id, name, role, active, location_id, source, square_team_member_id, staff_code)
        SELECT id, name, role, active, location_id, source, square_team_member_id, staff_code FROM staff;
      DROP TABLE staff;
      ALTER TABLE staff_new RENAME TO staff;
    `);
  })();
  db.pragma('foreign_keys = ON');
}

// Phase 1.5: staff_code backfill + indexes + counter self-heal.
// Idempotent — runs on every boot.
db.exec(`
  UPDATE staff
     SET staff_code = 'TS-' || substr('0000' || id, -4)
   WHERE staff_code IS NULL;

  CREATE UNIQUE INDEX IF NOT EXISTS idx_staff_code ON staff(staff_code);

  UPDATE tip_distributions
     SET staff_code = (SELECT s.staff_code FROM staff s WHERE s.id = tip_distributions.staff_id)
   WHERE staff_code IS NULL
     AND staff_id IS NOT NULL
     AND EXISTS (SELECT 1 FROM staff s WHERE s.id = tip_distributions.staff_id);

  CREATE INDEX IF NOT EXISTS idx_td_calc ON tip_distributions(calculation_id);
  CREATE INDEX IF NOT EXISTS idx_td_staff ON tip_distributions(staff_id);
  CREATE INDEX IF NOT EXISTS idx_tc_date ON tip_calculations(date, voided);
  CREATE UNIQUE INDEX IF NOT EXISTS idx_td_calc_staff
    ON tip_distributions(calculation_id, staff_id) WHERE staff_id IS NOT NULL;
`);

// staff_code counter self-heal: missing or corrupt counter re-derives from
// the highest existing code, so a bad backup restore can't hand out a code
// that's already on paper.
{
  const seqRow = db.prepare(
    "SELECT value FROM settings WHERE key = 'staff_code_seq' AND location_id = 1"
  ).get() as { value: string } | undefined;
  let seq = seqRow ? parseInt(seqRow.value, 10) : NaN;
  if (!Number.isInteger(seq) || seq < 0) {
    const maxRow = db.prepare(`
      SELECT CAST(substr(staff_code, 4) AS INTEGER) AS n
      FROM staff WHERE staff_code IS NOT NULL
      ORDER BY n DESC LIMIT 1
    `).get() as { n: number } | undefined;
    seq = maxRow && Number.isInteger(maxRow.n) ? maxRow.n : 0;
  }
  db.prepare(`
    INSERT INTO settings (key, value) VALUES ('staff_code_seq', ?)
    ON CONFLICT(key, location_id) DO UPDATE SET value = excluded.value
  `).run(String(seq));
}

// Seed default settings
const seedSetting = db.prepare(
  'INSERT OR IGNORE INTO settings (key, value) VALUES (?, ?)'
);
for (const [key, value] of [
  ['cc_fee_rate',                  '2.5'],
  ['kitchen_pct',                  '30'],
  ['bar_liquor_pct',               '10'],
  ['busser_rate',                  '20'],
  ['lunch_cutoff',                 '15:00'],
  ['timezone',                     DEFAULT_TIMEZONE],
  ['restaurant_name',              'My Restaurant'],
  ['google_sheets_spreadsheet_id', ''],
  ['google_sheets_sheet_name',     'Tip History'],
  // Phase 1.5: pay-period anchor (a Sunday). Reports use 14-day half-open
  // periods back to RANGE_FROM (June 2026) through year-end.
  ['pay_period_anchor',            '2026-08-23'],
]) {
  seedSetting.run(key, value);
}
// Migrate old shift_cutoff key → lunch_cutoff
db.prepare("INSERT OR IGNORE INTO settings (key, value) SELECT 'lunch_cutoff', value FROM settings WHERE key = 'shift_cutoff'").run();
db.prepare("DELETE FROM settings WHERE key = 'shift_cutoff'").run();

// Phase 2 — adjustment audit table. shift_assignment_id is nullable so the
// audit is still writable for legacy calculations seeded without a
// matching shift_assignments row; the adjust action best-effort links.
db.exec(`
  CREATE TABLE IF NOT EXISTS adjustment_logs (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    shift_assignment_id INTEGER REFERENCES shift_assignments(id) ON DELETE SET NULL,
    user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    adjustment_cents INTEGER NOT NULL,
    reason TEXT,
    created_at INTEGER NOT NULL DEFAULT (unixepoch()),
    redistribution_target_ids TEXT,
    redistribution_amounts TEXT
  );
  CREATE INDEX IF NOT EXISTS idx_adjustment_logs_shift ON adjustment_logs(shift_assignment_id);
  CREATE INDEX IF NOT EXISTS idx_adjustment_logs_user ON adjustment_logs(user_id);
  CREATE INDEX IF NOT EXISTS idx_adjustment_logs_created ON adjustment_logs(created_at);
`);

// Bootstrap initial manager from env (only if no users exist yet)
const initialPin = process.env.INITIAL_MANAGER_PIN;
if (initialPin) {
  const count = (db.prepare('SELECT COUNT(*) as n FROM users').get() as { n: number }).n;
  if (count === 0) {
    const hash = bcrypt.hashSync(initialPin, 10);
    db.prepare("INSERT INTO users (pin_hash, role) VALUES (?, 'manager')").run(hash);
    console.log('[tipsplit] Initial manager account created.');
  }
}

export type UserRow = {
  id: number;
  name: string | null;
  pin_hash: string;
  role: 'shift_lead' | 'manager';
  location_id: number;
};

export type StaffRow = {
  id: number;
  name: string;
  role: 'FOH' | 'Kitchen' | 'Bar' | 'Busser';
  active: number;
  location_id: number;
  source: 'manual' | 'square';
  square_team_member_id: string | null;
  staff_code: string | null;
};

export type CalcRow = {
  id: number;
  date: string;
  shift: 'Lunch' | 'Dinner';
  gross_tips_cents: number;
  liquor_sales_cents: number;
  cc_fee_rate: number;
  kitchen_pct: number;
  bar_liquor_pct: number;
  cc_fees_cents: number;
  tips_after_fees_cents: number;
  kitchen_pool_cents: number;
  bar_pool_cents: number;
  busser_pool_cents: number;
  foh_pool_cents: number;
  voided: number;
  created_at: number;
};

export type DistRow = {
  id: number;
  calculation_id: number;
  staff_id: number | null;
  staff_code: string | null;
  name: string;
  role: string;
  foh_share_cents: number;
  bar_pool_share_cents: number;
  kitchen_share_cents: number;
  busser_share_cents: number;
  total_cents: number;
  adjustment_cents: number;
  adjustment_reason: string | null;
};

export type ExportLogRow = {
  id: number;
  calculation_id: number;
  exported_at: number;
  exported_by: number | null;
  location_id: number;
};

export default db;

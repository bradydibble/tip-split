import Database from 'better-sqlite3';
import { mkdirSync } from 'fs';
import { dirname } from 'path';
import bcrypt from 'bcryptjs';

const dbPath = process.env.DATABASE_PATH ?? './data/tipsplit.db';

mkdirSync(dirname(dbPath), { recursive: true });

const db = new Database(dbPath);

db.pragma('journal_mode = WAL');
db.pragma('foreign_keys = ON');

db.exec(`
  CREATE TABLE IF NOT EXISTS users (
    id         INTEGER PRIMARY KEY AUTOINCREMENT,
    pin_hash   TEXT    NOT NULL,
    role       TEXT    NOT NULL DEFAULT 'shift_lead'
                       CHECK (role IN ('shift_lead', 'manager')),
    location_id INTEGER NOT NULL DEFAULT 1,
    created_at INTEGER NOT NULL DEFAULT (unixepoch())
  );

  CREATE TABLE IF NOT EXISTS staff (
    id                    INTEGER PRIMARY KEY AUTOINCREMENT,
    name                  TEXT    NOT NULL,
    role                  TEXT    NOT NULL CHECK (role IN ('FOH', 'Kitchen', 'Bar')),
    active                INTEGER NOT NULL DEFAULT 1,
    location_id           INTEGER NOT NULL DEFAULT 1,
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
    id                        INTEGER PRIMARY KEY AUTOINCREMENT,
    date                      TEXT    NOT NULL,
    shift                     TEXT    NOT NULL CHECK (shift IN ('Lunch', 'Dinner')),
    gross_tips_cents          INTEGER NOT NULL,
    liquor_sales_cents        INTEGER NOT NULL,
    cc_fee_rate               REAL    NOT NULL,
    kitchen_pct               REAL    NOT NULL,
    bar_liquor_pct            REAL    NOT NULL,
    cc_fees_cents             INTEGER NOT NULL,
    tips_after_fees_cents     INTEGER NOT NULL,
    kitchen_pool_cents        INTEGER NOT NULL,
    bar_pool_cents            INTEGER NOT NULL,
    foh_pool_cents            INTEGER NOT NULL,
    location_id               INTEGER NOT NULL DEFAULT 1,
    created_at                INTEGER NOT NULL DEFAULT (unixepoch())
  );

  CREATE TABLE IF NOT EXISTS tip_distributions (
    id                  INTEGER PRIMARY KEY AUTOINCREMENT,
    calculation_id      INTEGER NOT NULL REFERENCES tip_calculations(id) ON DELETE CASCADE,
    staff_id            INTEGER,
    name                TEXT    NOT NULL,
    role                TEXT    NOT NULL,
    foh_share_cents     INTEGER NOT NULL DEFAULT 0,
    bar_pool_share_cents INTEGER NOT NULL DEFAULT 0,
    kitchen_share_cents INTEGER NOT NULL DEFAULT 0,
    total_cents         INTEGER NOT NULL
  );

  CREATE TABLE IF NOT EXISTS settings (
    key         TEXT    NOT NULL,
    value       TEXT    NOT NULL,
    location_id INTEGER NOT NULL DEFAULT 1,
    PRIMARY KEY (key, location_id)
  );

  CREATE TABLE IF NOT EXISTS sessions (
    id         TEXT    PRIMARY KEY,
    user_id    INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    expires_at INTEGER NOT NULL
  );
`);

// Migrations for columns added after initial schema
for (const sql of [
  "ALTER TABLE staff ADD COLUMN source TEXT NOT NULL DEFAULT 'manual'",
  "ALTER TABLE staff ADD COLUMN square_team_member_id TEXT",
]) {
  try { db.exec(sql); } catch { /* column already exists */ }
}

// Seed default settings
const seedSetting = db.prepare(
  'INSERT OR IGNORE INTO settings (key, value) VALUES (?, ?)'
);
for (const [key, value] of [
  ['cc_fee_rate',                  '2.5'],
  ['kitchen_pct',                  '30'],
  ['bar_liquor_pct',               '10'],
  ['lunch_cutoff',                 '15:00'],
  ['restaurant_name',              'My Restaurant'],
  ['google_sheets_spreadsheet_id', ''],
  ['google_sheets_sheet_name',     'Tip History'],
]) {
  seedSetting.run(key, value);
}
// Migrate old shift_cutoff key → lunch_cutoff
db.prepare("INSERT OR IGNORE INTO settings (key, value) SELECT 'lunch_cutoff', value FROM settings WHERE key = 'shift_cutoff'").run();
db.prepare("DELETE FROM settings WHERE key = 'shift_cutoff'").run();

// Bootstrap initial manager from env (only if no users exist yet)
const initialPin = process.env.INITIAL_MANAGER_PIN;
if (initialPin) {
  const count = (db.prepare('SELECT COUNT(*) as n FROM users').get() as { n: number }).n;
  if (count === 0) {
    const hash = bcrypt.hashSync(initialPin, 12);
    db.prepare("INSERT INTO users (pin_hash, role) VALUES (?, 'manager')").run(hash);
    console.log('[tipsplit] Initial manager account created.');
  }
}

export type UserRow = {
  id: number;
  pin_hash: string;
  role: 'shift_lead' | 'manager';
  location_id: number;
};

export type StaffRow = {
  id: number;
  name: string;
  role: 'FOH' | 'Kitchen' | 'Bar';
  active: number;
  location_id: number;
  source: 'manual' | 'square';
  square_team_member_id: string | null;
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
  foh_pool_cents: number;
  created_at: number;
};

export type DistRow = {
  id: number;
  calculation_id: number;
  staff_id: number | null;
  name: string;
  role: string;
  foh_share_cents: number;
  bar_pool_share_cents: number;
  kitchen_share_cents: number;
  total_cents: number;
};

export default db;

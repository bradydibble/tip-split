// Numbered migration runner for SQLite.
//
// The spec requires a real migration, not scattered boot-time ALTERs. This
// module introduces a `schema_migrations` table that records every applied
// migration id. Each migration runs inside a transaction and is never
// re-applied. The existing bootstrap schema in db.ts stays untouched — this
// only manages migrations introduced from the Square integration onward.
//
// Conventions enforced by review:
//   - Money: integer cents (never floats or dollars).
//   - Timestamps: UTC RFC 3339 strings (TEXT), stored alongside a
//     `business_date` string when relevant.
//   - Immutable Square IDs: TEXT with UNIQUE indexes, never matched by name.

import type Database from 'better-sqlite3';

interface Migration {
  id: number;
  description: string;
  up: (db: Database.Database) => void;
}

/**
 * Migrations registered in order. To add a new migration, append an entry
 * with the next sequential id — never modify a shipped migration.
 */
const MIGRATIONS: Migration[] = [
  {
    id: 1,
    description: 'Square integration tables: connections, jobs, shift reports, attendance, sync runs, report records, close overrides, staff extensions.',
    up: (db) => {
      // ── Extensions to existing `staff` table ──────────────────────────
      // Guarded ALTERs for additive columns on the existing staff table.
      for (const sql of [
        `ALTER TABLE staff ADD COLUMN square_status TEXT`,
        `ALTER TABLE staff ADD COLUMN square_last_synced_at TEXT`,
        `ALTER TABLE staff ADD COLUMN default_tip_split_role TEXT
           CHECK (default_tip_split_role IN ('FOH','BAR','BUSSER','KITCHEN','EXCLUDED'))`,
        `ALTER TABLE staff ADD COLUMN role_mapping_state TEXT
           CHECK (role_mapping_state IN ('MAPPED','NEEDS_REVIEW','EXCLUDED'))`,
      ]) {
        try { db.exec(sql); } catch { /* column already exists */ }
      }

      // ── square_connections ────────────────────────────────────────────
      // Single-row table keyed by location_id. Stores the validated
      // connection metadata for the selected Square location.
      db.exec(`
        CREATE TABLE IF NOT EXISTS square_connections (
          location_id           TEXT    PRIMARY KEY,
          merchant_id           TEXT    NOT NULL,
          merchant_name         TEXT,
          square_location_id    TEXT    NOT NULL,
          square_location_name  TEXT,
          timezone              TEXT    NOT NULL,
          currency              TEXT,
          api_version           TEXT    NOT NULL,
          weekly_hours_json     TEXT,
          last_validation_at     TEXT,
          last_validation_ok    INTEGER NOT NULL DEFAULT 0,
          last_roster_sync_at   TEXT,
          last_catalog_sync_at  TEXT,
          scope_failures_json   TEXT,
          created_at            TEXT    NOT NULL DEFAULT (datetime('now')),
          updated_at            TEXT    NOT NULL DEFAULT (datetime('now'))
        );
      `);

      // ── staff_square_jobs ────────────────────────────────────────────
      // Many-to-many of staff ↔ Square jobs (a team member can hold more
      // than one job). Job title snapshot is stored for audit.
      db.exec(`
        CREATE TABLE IF NOT EXISTS staff_square_jobs (
          id                 INTEGER PRIMARY KEY AUTOINCREMENT,
          staff_id           INTEGER NOT NULL REFERENCES staff(id) ON DELETE CASCADE,
          square_job_id      TEXT,
          square_job_title   TEXT    NOT NULL,
          mapped_tip_role    TEXT    NOT NULL
                             CHECK (mapped_tip_role IN ('FOH','BAR','BUSSER','KITCHEN','EXCLUDED')),
          active             INTEGER NOT NULL DEFAULT 1,
          synced_at          TEXT    NOT NULL,
          UNIQUE (staff_id, square_job_id)
        );
        CREATE INDEX IF NOT EXISTS idx_ssj_staff ON staff_square_jobs(staff_id);
      `);

      // ── shift_reports ────────────────────────────────────────────────
      // One row per (location, business_date, shift_type). State machine:
      // DRAFT → READY_FOR_REVIEW → FINALIZED (or VOIDED).
      db.exec(`
        CREATE TABLE IF NOT EXISTS shift_reports (
          id                       INTEGER PRIMARY KEY AUTOINCREMENT,
          location_id              TEXT    NOT NULL,
          business_date            TEXT    NOT NULL,
          shift_type               TEXT    NOT NULL
                                     CHECK (shift_type IN ('Lunch','Dinner')),
          state                    TEXT    NOT NULL DEFAULT 'DRAFT'
                                     CHECK (state IN ('DRAFT','READY_FOR_REVIEW','FINALIZED','VOIDED')),
          source                   TEXT    NOT NULL DEFAULT 'auto'
                                     CHECK (source IN ('auto','manual')),
          scheduled_instant_utc    TEXT,
          close_source             TEXT    NOT NULL DEFAULT 'weekly_hours'
                                     CHECK (close_source IN ('weekly_hours','override')),
          close_override_id        INTEGER,
          square_tips_cents        INTEGER NOT NULL DEFAULT 0,
          square_liquor_sales_cents INTEGER NOT NULL DEFAULT 0,
          manual_tips_cents        INTEGER NOT NULL DEFAULT 0,
          manual_liquor_cents      INTEGER NOT NULL DEFAULT 0,
          latest_sync_run_id       INTEGER,
          final_calculation_id     INTEGER,
          created_at               TEXT    NOT NULL DEFAULT (datetime('now')),
          updated_at               TEXT    NOT NULL DEFAULT (datetime('now')),
          UNIQUE (location_id, business_date, shift_type)
        );
        CREATE INDEX IF NOT EXISTS idx_sr_date ON shift_reports(business_date, shift_type);
        CREATE INDEX IF NOT EXISTS idx_sr_state ON shift_reports(state);
      `);

      // ── shift_report_attendance ──────────────────────────────────────
      // Per-staff participation in a shift report. Links to the Square
      // scheduled-shift that placed them there, with role confirmation state.
      db.exec(`
        CREATE TABLE IF NOT EXISTS shift_report_attendance (
          id                        INTEGER PRIMARY KEY AUTOINCREMENT,
          shift_report_id           INTEGER NOT NULL REFERENCES shift_reports(id) ON DELETE CASCADE,
          staff_id                  INTEGER REFERENCES staff(id) ON DELETE SET NULL,
          square_team_member_id     TEXT    NOT NULL,
          square_scheduled_shift_id TEXT,
          scheduled_job_id          TEXT,
          scheduled_job_title       TEXT,
          name_snapshot             TEXT    NOT NULL,
          default_role              TEXT
                                      CHECK (default_role IN ('FOH','BAR','BUSSER','KITCHEN','EXCLUDED')),
          selected_role             TEXT
                                      CHECK (selected_role IN ('FOH','BAR','BUSSER','KITCHEN','EXCLUDED')),
          role_confirmed            INTEGER NOT NULL DEFAULT 0,
          confirmed_by              INTEGER REFERENCES users(id) ON DELETE SET NULL,
          confirmed_at              TEXT,
          inclusion_state           TEXT    NOT NULL DEFAULT 'INCLUDED'
                                      CHECK (inclusion_state IN ('INCLUDED','EXCLUDED','NEEDS_REVIEW','REMOVED')),
          UNIQUE (shift_report_id, square_team_member_id)
        );
        CREATE INDEX IF NOT EXISTS idx_sra_report ON shift_report_attendance(shift_report_id);
      `);

      // ── square_sync_runs ─────────────────────────────────────────────
      // Immutable audit of each Square fetch operation for a report.
      db.exec(`
        CREATE TABLE IF NOT EXISTS square_sync_runs (
          id                  INTEGER PRIMARY KEY AUTOINCREMENT,
          shift_report_id     INTEGER NOT NULL REFERENCES shift_reports(id) ON DELETE CASCADE,
          window_start_utc    TEXT    NOT NULL,
          window_end_utc      TEXT    NOT NULL,
          source_version      TEXT,
          started_at          TEXT    NOT NULL,
          completed_at        TEXT,
          status              TEXT    NOT NULL DEFAULT 'running'
                                CHECK (status IN ('running','completed','failed')),
          request_ids_json    TEXT,
          counts_json         TEXT,
          error_summary       TEXT
        );
        CREATE INDEX IF NOT EXISTS idx_ssr_report ON square_sync_runs(shift_report_id);
      `);

      // ── square_report_records ────────────────────────────────────────
      // Individual Square records contributing to a sync run (payment, order
      // line, etc.). Stores cents contribution and classification.
      db.exec(`
        CREATE TABLE IF NOT EXISTS square_report_records (
          id                  INTEGER PRIMARY KEY AUTOINCREMENT,
          sync_run_id         INTEGER NOT NULL REFERENCES square_sync_runs(id) ON DELETE CASCADE,
          record_kind         TEXT    NOT NULL
                                CHECK (record_kind IN ('payment','order_line','scheduled_shift','team_member','catalog_item')),
          square_id           TEXT    NOT NULL,
          relevant_timestamp  TEXT,
          cents_contribution  INTEGER NOT NULL DEFAULT 0,
          classification      TEXT    NOT NULL,
          result              TEXT    NOT NULL,
          audit_payload_hash  TEXT,
          UNIQUE (sync_run_id, record_kind, square_id)
        );
        CREATE INDEX IF NOT EXISTS idx_srr_run ON square_report_records(sync_run_id);
        CREATE INDEX IF NOT EXISTS idx_srr_kind ON square_report_records(record_kind);
      `);

      // ── dinner_close_overrides ───────────────────────────────────────
      // Manager-set daily dinner close exceptions, with reason and audit.
      db.exec(`
        CREATE TABLE IF NOT EXISTS dinner_close_overrides (
          id            INTEGER PRIMARY KEY AUTOINCREMENT,
          location_id   TEXT    NOT NULL,
          business_date TEXT    NOT NULL,
          close_local   TEXT    NOT NULL,
          actor         INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
          reason        TEXT,
          created_at    TEXT    NOT NULL DEFAULT (datetime('now')),
          UNIQUE (location_id, business_date)
        );
        CREATE INDEX IF NOT EXISTS idx_dco_date ON dinner_close_overrides(business_date);
      `);

      // ── Settings seeds for Square configuration keys ──────────────────
      const seed = db.prepare(
        `INSERT OR IGNORE INTO settings (key, value) VALUES (?, ?)`
      );
      for (const [key, val] of [
        ['square_access_token_ref',  ''],   // env var name, never the token itself
        ['square_api_version',       '2024-12-18'],
        ['square_selected_location_id', ''],
        ['square_liquor_category_id', ''],
      ] as [string, string][]) {
        seed.run(key, val);
      }
    },
  },
  {
    id: 2,
    description: 'Labor cost tracking: worked-shift records, payroll file imports, staff salary columns, employer-tax setting.',
    up: (db) => {
      // ── Worked-shift records (from Square Shifts API — actual clock data) ──
      // One row per worked Square shift. Costs are recomputed on each sync;
      // OPEN shifts (still clocked in) carry provisional costs.
      db.exec(`
        CREATE TABLE IF NOT EXISTS labor_shifts (
          id                        INTEGER PRIMARY KEY AUTOINCREMENT,
          square_shift_id           TEXT    NOT NULL UNIQUE,
          team_member_id            TEXT    NOT NULL,
          business_date             TEXT    NOT NULL,
          start_at                  TEXT    NOT NULL,
          end_at                    TEXT,
          hourly_rate_cents         INTEGER NOT NULL,
          job_id                    TEXT,
          job_title                 TEXT,
          pay_type                  TEXT,
          worked_minutes            INTEGER NOT NULL DEFAULT 0,
          unpaid_break_minutes      INTEGER NOT NULL DEFAULT 0,
          cost_cents                INTEGER NOT NULL DEFAULT 0,
          provisional               INTEGER NOT NULL DEFAULT 0,
          declared_cash_tips_cents  INTEGER NOT NULL DEFAULT 0,
          status                    TEXT    NOT NULL CHECK (status IN ('OPEN','CLOSED')),
          synced_at                 TEXT    NOT NULL
        );
        CREATE INDEX IF NOT EXISTS idx_lshift_date ON labor_shifts(business_date);
        CREATE INDEX IF NOT EXISTS idx_lshift_tm ON labor_shifts(team_member_id);
      `);

      // ── Payroll / labor file imports (uploaded via dashboard) ──────────
      // Raw storage + audit for files the manager drops in (e.g. payroll
      // report CSVs exported from QuickBooks Online). Status is 'pending'
      // until a format-specific parser consumes it.
      db.exec(`
        CREATE TABLE IF NOT EXISTS labor_imports (
          id          INTEGER PRIMARY KEY AUTOINCREMENT,
          kind        TEXT    NOT NULL DEFAULT 'unknown',
          filename    TEXT    NOT NULL,
          stored_path TEXT    NOT NULL,
          sha256      TEXT    NOT NULL,
          size_bytes  INTEGER NOT NULL,
          uploaded_by INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
          uploaded_at TEXT    NOT NULL DEFAULT (datetime('now')),
          status      TEXT    NOT NULL DEFAULT 'pending',
          row_count   INTEGER,
          notes       TEXT
        );
        CREATE INDEX IF NOT EXISTS idx_limp_uploaded ON labor_imports(uploaded_at);
      `);

      // ── Staff compensation columns (synced from Square wage_setting) ──
      for (const sql of [
        `ALTER TABLE staff ADD COLUMN pay_type TEXT`,
        `ALTER TABLE staff ADD COLUMN salary_annual_cents INTEGER`,
        `ALTER TABLE staff ADD COLUMN salary_weekly_hours INTEGER`,
      ]) {
        try { db.exec(sql); } catch { /* column already exists */ }
      }

      // ── Employer tax burden setting (% on top of gross wages) ───────────
      db.prepare(
        `INSERT OR IGNORE INTO settings (key, value) VALUES ('labor_employer_tax_pct', '0')`
      ).run();
    },
  },
];

/**
 * Run all pending migrations. Called once from db.ts during bootstrap.
 * Safe to call on every boot — already-applied migrations are skipped.
 */
export function runMigrations(db: Database.Database): void {
  db.exec(`
    CREATE TABLE IF NOT EXISTS schema_migrations (
      id          INTEGER PRIMARY KEY,
      description TEXT    NOT NULL,
      applied_at  TEXT    NOT NULL DEFAULT (datetime('now'))
    );
  `);

  const appliedRows = db.prepare('SELECT id FROM schema_migrations').all() as { id: number }[];
  const applied = new Set(appliedRows.map((r) => r.id));

  for (const mig of MIGRATIONS) {
    if (applied.has(mig.id)) continue;
    db.transaction(() => {
      mig.up(db);
      db.prepare('INSERT INTO schema_migrations (id, description) VALUES (?, ?)')
        .run(mig.id, mig.description);
    })();
  }
}

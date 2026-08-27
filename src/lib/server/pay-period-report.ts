// Pay period report aggregation + CSV export (Phase 1.5).
//
// Contract (see TipSplit-PRD.md):
//   - Period membership is a half-open business-date range:
//     `date >= start AND date < start + 14d`. Never BETWEEN.
//   - Per-staff rows group by staff_id (never by name — renames and
//     duplicate names must not split or merge people).
//   - The grand total is a second SQL SUM over the same filter, never a
//     re-sum of the UI rows, so a UI toggle can't desync the two.
//   - Distributions with NULL staff_id (legacy/defensive) are excluded from
//     per-staff rows but surfaced as a count, and remain in the grand total
//     so the report reconciles with the bank.

import type Database from 'better-sqlite3';
import { periodEndExclusive, formatPeriodLabel } from '../pay-period';

export interface PeriodReportRow {
  staff_id: number;
  name: string;
  role: string;
  staff_code: string | null;
  shifts: number;
  total_cents: number;
}

export interface PeriodReport {
  rows: PeriodReportRow[];
  grandTotalCents: number;
  shiftsCount: number;
  staffPaidCount: number;
  activeStaffCount: number;
  voidedExcludedCount: number;
  unlinkedCount: number;
  unlinkedCents: number;
}

export function getPeriodReport(
  db: Database.Database,
  periodStart: string,
  opts: { includeVoided?: boolean } = {},
): PeriodReport {
  // includeVoided removes the filter entirely — it must NOT flip to
  // "voided only".
  const vf = opts.includeVoided ? '' : 'tc.voided = 0 AND ';
  const end = periodEndExclusive(periodStart);

  const rows = db.prepare(`
    SELECT td.staff_id,
           COALESCE(s.name, td.name)        AS name,
           COALESCE(s.role, td.role)        AS role,
           COALESCE(s.staff_code, td.staff_code) AS staff_code,
           COUNT(DISTINCT tc.id)            AS shifts,
           SUM(td.total_cents)              AS total_cents
      FROM tip_distributions td
      JOIN tip_calculations tc ON tc.id = td.calculation_id
      LEFT JOIN staff s ON s.id = td.staff_id
     WHERE tc.location_id = 1
       AND ${vf}td.staff_id IS NOT NULL
       AND tc.date >= ? AND tc.date < ?
     GROUP BY td.staff_id
     ORDER BY total_cents DESC, name ASC, staff_code ASC
  `).all(periodStart, end) as PeriodReportRow[];

  const grand = db.prepare(`
    SELECT COALESCE(SUM(td.total_cents), 0) AS cents
      FROM tip_distributions td
      JOIN tip_calculations tc ON tc.id = td.calculation_id
     WHERE tc.location_id = 1 AND ${vf}tc.date >= ? AND tc.date < ?
  `).get(periodStart, end) as { cents: number };

  const shifts = db.prepare(`
    SELECT COUNT(DISTINCT tc.id) AS n
      FROM tip_calculations tc
     WHERE tc.location_id = 1 AND ${vf}tc.date >= ? AND tc.date < ?
  `).get(periodStart, end) as { n: number };

  const active = db.prepare(
    'SELECT COUNT(*) AS n FROM staff WHERE active = 1 AND location_id = 1',
  ).get() as { n: number };

  const voidedExcluded = db.prepare(`
    SELECT COUNT(*) AS n FROM tip_calculations
     WHERE location_id = 1 AND voided = 1 AND date >= ? AND date < ?
  `).get(periodStart, end) as { n: number };

  const unlinked = db.prepare(`
    SELECT COUNT(*) AS n, COALESCE(SUM(td.total_cents), 0) AS cents
      FROM tip_distributions td
      JOIN tip_calculations tc ON tc.id = td.calculation_id
     WHERE tc.location_id = 1 AND ${vf}
       td.staff_id IS NULL
       AND tc.date >= ? AND tc.date < ?
  `).get(periodStart, end) as { n: number; cents: number };

  return {
    rows,
    grandTotalCents: grand.cents,
    shiftsCount: shifts.n,
    staffPaidCount: rows.filter((r) => r.total_cents > 0).length,
    activeStaffCount: active.n,
    voidedExcludedCount: voidedExcluded.n,
    unlinkedCount: unlinked.n,
    unlinkedCents: unlinked.cents,
  };
}

export interface StaffShiftRow {
  calc_id: number;
  date: string;
  shift: string;
  recorded_name: string;
  staff_code: string | null;
  foh_share_cents: number;
  bar_pool_share_cents: number;
  kitchen_share_cents: number;
  busser_share_cents: number;
  total_cents: number;
}

export interface StaffPeriodDetail {
  // Non-null: getStaffPeriodDetail returns null (not a detail) when the
  // code can't be resolved at all.
  staff: { id: number; name: string; role: string; staff_code: string; active: number };
  totalCents: number;
  shifts: StaffShiftRow[];
}

export function getStaffPeriodDetail(
  db: Database.Database,
  periodStart: string,
  staffCode: string,
  opts: { includeVoided?: boolean } = {},
): StaffPeriodDetail | null {
  const vf = opts.includeVoided ? '' : 'tc.voided = 0 AND ';
  const end = periodEndExclusive(periodStart);

  // Resolve the staff row by code (current roster) — the drill-down is
  // keyed on the stable code, not the numeric id. Deactivated staff still
  // resolve (no active filter); deletion is blocked once they have
  // distributions, so this is the expected path.
  const staff = db.prepare(
    'SELECT id, name, role, staff_code, active FROM staff WHERE staff_code = ?',
  ).get(staffCode) as StaffPeriodDetail['staff'] | undefined;

  let display: StaffPeriodDetail['staff'];
  let staffId: number;
  if (staff) {
    display = staff;
    staffId = staff.id;
  } else {
    // Defensive: staff row gone (e.g. manual DB surgery). Recover the id
    // from the distribution snapshot so the history is still reachable.
    const snap = db.prepare(`
      SELECT staff_id, name FROM tip_distributions
       WHERE staff_code = ? AND staff_id IS NOT NULL
       LIMIT 1
    `).get(staffCode) as { staff_id: number; name: string } | undefined;
    if (!snap) return null;
    staffId = snap.staff_id;
    display = { id: snap.staff_id, name: snap.name, role: '—', staff_code: staffCode, active: 0 };
  }

  const total = db.prepare(`
    SELECT COALESCE(SUM(td.total_cents), 0) AS cents
      FROM tip_distributions td
      JOIN tip_calculations tc ON tc.id = td.calculation_id
     WHERE td.staff_id = ? AND tc.location_id = 1 AND ${vf}
       tc.date >= ? AND tc.date < ?
  `).get(staffId, periodStart, end) as { cents: number };

  const shifts = db.prepare(`
    SELECT tc.id AS calc_id, tc.date, tc.shift,
           td.name AS recorded_name, td.staff_code,
           td.foh_share_cents, td.bar_pool_share_cents,
           td.kitchen_share_cents, td.busser_share_cents, td.total_cents
      FROM tip_distributions td
      JOIN tip_calculations tc ON tc.id = td.calculation_id
      WHERE td.staff_id = ? AND tc.location_id = 1 AND ${vf}
        tc.date >= ? AND tc.date < ?
      ORDER BY tc.date DESC, tc.shift DESC, tc.id DESC
   `).all(staffId, periodStart, end) as StaffShiftRow[];

  return { staff: display, totalCents: total.cents, shifts };
}

/** Total cents for a list of period starts (for the period picker sheet). */
export function getPeriodTotals(
  db: Database.Database,
  starts: string[],
  opts: { includeVoided?: boolean } = {},
): Map<string, number> {
  const map = new Map<string, number>();
  if (starts.length === 0) return map;
  const vf = opts.includeVoided ? '' : 'tc.voided = 0 AND ';
  const stmt = db.prepare(`
    SELECT tc.date, COALESCE(SUM(td.total_cents), 0) AS cents
      FROM tip_calculations tc
      LEFT JOIN tip_distributions td ON td.calculation_id = tc.id
     WHERE tc.location_id = 1 AND ${vf}
       tc.date >= ? AND tc.date < ?
     GROUP BY tc.date
  `);
  for (const start of starts) {
    const end = periodEndExclusive(start);
    let sum = 0;
    for (const r of stmt.all(start, end) as { cents: number }[]) sum += r.cents;
    map.set(start, sum);
  }
  return map;
}

// ── CSV ──────────────────────────────────────────────────────────────────────

/**
 * Neutralize CSV formula injection: a field whose first character is
 * =, +, -, @, tab, or CR becomes a live formula when Excel opens the file.
 * Prefix with a single quote so it renders as text.
 */
export function sanitizeCsvField(value: string): string {
  if (value.length > 0 && /[=+\-@\t\r]/.test(value[0])) return `'${value}`;
  return value;
}

/** RFC-4180 quoting + injection sanitization for one field. */
export function csvField(value: string): string {
  const v = sanitizeCsvField(value);
  if (/[",\n\r]/.test(v)) return `"${v.replace(/"/g, '""')}"`;
  return v;
}

export interface ReportCsvInput {
  periodStart: string;
  rows: PeriodReportRow[];
  voidedExcludedCount: number;
  generatedAt: Date;
  timeZone: string;
}

export function buildReportCsv(input: ReportCsvInput): string {
  const end = periodEndExclusive(input.periodStart);
  const lines: string[] = [];
  lines.push('Period Start,Period End,Staff ID,Name,Role,Shifts,Total');
  for (const r of input.rows) {
    lines.push([
      input.periodStart,
      end,
      csvField(r.staff_code ?? ''),
      csvField(r.name),
      csvField(r.role),
      String(r.shifts),
      (r.total_cents / 100).toFixed(2),
    ].join(','));
  }
  lines.push('');
  lines.push(`Generated (${input.timeZone}),${formatLocalDateTime(input.generatedAt, input.timeZone)}`);
  lines.push(`Period label,${csvField(formatPeriodLabel(input.periodStart))}`);
  lines.push(`Voided calculations excluded,${input.voidedExcludedCount}`);
  return lines.join('\n') + '\n';
}

/** "2026-08-16 14:32 PDT" in the given IANA zone. */
export function formatLocalDateTime(now: Date, timeZone: string): string {
  const parts = new Intl.DateTimeFormat('en-CA', {
    timeZone,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    hourCycle: 'h23',
    timeZoneName: 'short',
  }).formatToParts(now);
  const get = (t: string) => parts.find((p) => p.type === t)?.value ?? '';
  return `${get('year')}-${get('month')}-${get('day')} ${get('hour')}:${get('minute')} ${get('timeZoneName')}`;
}

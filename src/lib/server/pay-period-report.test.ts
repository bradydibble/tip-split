import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { mkdtempSync, rmSync } from 'fs';
import { tmpdir } from 'os';
import { join } from 'path';
import type Database from 'better-sqlite3';

// Point the DB at a throwaway file BEFORE db.ts is imported (it reads
// DATABASE_PATH at module load).
const tmp = mkdtempSync(join(tmpdir(), 'tipsplit-report-test-'));
process.env.DATABASE_PATH = join(tmp, 'test.db');

let db: Database.Database;
let report: typeof import('./pay-period-report');
let staffCode: typeof import('./staff-code');

beforeAll(async () => {
  ({ default: db } = await import('./db'));
  report = await import('./pay-period-report');
  staffCode = await import('./staff-code');
});

afterAll(() => {
  rmSync(tmp, { recursive: true, force: true });
});

// ── helpers ──────────────────────────────────────────────────────────────────

function insertStaff(name: string, role: string, code: string | null = null, active = 1): number {
  const r = db.prepare('INSERT INTO staff (name, role, staff_code, active) VALUES (?,?,?,?)')
    .run(name, role, code, active);
  return Number(r.lastInsertRowid);
}

function insertCalc(date: string, shift: string, grossCents: number, voided = 0): number {
  const r = db.prepare(`
    INSERT INTO tip_calculations
      (date, shift, gross_tips_cents, liquor_sales_cents, cc_fee_rate, kitchen_pct,
       bar_liquor_pct, cc_fees_cents, tips_after_fees_cents, kitchen_pool_cents,
       bar_pool_cents, busser_pool_cents, foh_pool_cents, voided)
    VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?)
  `).run(date, shift, grossCents, 0, 0.025, 0.3, 0.1, 0, grossCents, 0, 0, 0, grossCents, voided);
  return Number(r.lastInsertRowid);
}

function insertDist(
  calcId: number,
  staffId: number | null,
  name: string,
  role: string,
  totalCents: number,
  code: string | null = null,
): void {
  db.prepare(`
    INSERT INTO tip_distributions
      (calculation_id, staff_id, staff_code, name, role, foh_share_cents, total_cents)
    VALUES (?,?,?,?,?,?,?)
  `).run(calcId, staffId, code, name, role, totalCents, totalCents);
}

// Period under test: 2026-08-09 (Sun) → 2026-08-22 (Sat), exclusive end 08-23.
const P = '2026-08-09';

// ── report aggregation ───────────────────────────────────────────────────────

describe('getPeriodReport', () => {
  it('uses a half-open boundary: start in, exclusive end out', () => {
    const a = insertStaff('Alice', 'FOH', 'TS-9001');
    insertDist(insertCalc('2026-08-08', 'Dinner', 10000), a, 'Alice', 'FOH', 1000); // day before
    insertDist(insertCalc('2026-08-09', 'Dinner', 10000), a, 'Alice', 'FOH', 2000); // first day
    insertDist(insertCalc('2026-08-22', 'Dinner', 10000), a, 'Alice', 'FOH', 3000); // last day
    insertDist(insertCalc('2026-08-23', 'Dinner', 10000), a, 'Alice', 'FOH', 4000); // exclusive end

    const r = report.getPeriodReport(db, P);
    expect(r.rows).toHaveLength(1);
    expect(r.rows[0].staff_code).toBe('TS-9001');
    expect(r.rows[0].total_cents).toBe(5000); // 2000 + 3000 only
    expect(r.rows[0].shifts).toBe(2);
    expect(r.grandTotalCents).toBe(5000);
    expect(r.shiftsCount).toBe(2);
  });

  it('excludes voided by default and reports the count', () => {
    const b = insertStaff('Bob', 'FOH', 'TS-9002');
    insertDist(insertCalc('2026-08-10', 'Lunch', 10000), b, 'Bob', 'FOH', 1000);
    insertDist(insertCalc('2026-08-10', 'Dinner', 10000, 1), b, 'Bob', 'FOH', 9000); // voided

    const r = report.getPeriodReport(db, P);
    const bob = r.rows.find((x) => x.staff_code === 'TS-9002')!;
    expect(bob.total_cents).toBe(1000);
    expect(r.voidedExcludedCount).toBeGreaterThanOrEqual(1);

    const r2 = report.getPeriodReport(db, P, { includeVoided: true });
    const bob2 = r2.rows.find((x) => x.staff_code === 'TS-9002')!;
    expect(bob2.total_cents).toBe(10000);
    expect(r2.grandTotalCents).toBe(r.grandTotalCents + 9000);
  });

  it('groups by staff_id and shows the CURRENT name after a rename', () => {
    const c = insertStaff('Carol Oldname', 'Bar', 'TS-9003');
    insertDist(insertCalc('2026-08-11', 'Dinner', 10000), c, 'Carol Oldname', 'Bar', 2500);
    db.prepare('UPDATE staff SET name = ? WHERE id = ?').run('Carol Newname', c);

    const r = report.getPeriodReport(db, P);
    const carol = r.rows.find((x) => x.staff_code === 'TS-9003')!;
    expect(carol.name).toBe('Carol Newname');
    expect(carol.total_cents).toBe(2500);
  });

  it('keeps two staff with the same name as separate rows', () => {
    const d1 = insertStaff('Dave', 'FOH', 'TS-9004');
    const d2 = insertStaff('Dave', 'Kitchen', 'TS-9005');
    insertDist(insertCalc('2026-08-12', 'Dinner', 10000), d1, 'Dave', 'FOH', 1111);
    insertDist(insertCalc('2026-08-12', 'Dinner', 10000), d2, 'Dave', 'Kitchen', 2222);

    const r = report.getPeriodReport(db, P);
    const daves = r.rows.filter((x) => x.name === 'Dave');
    expect(daves).toHaveLength(2);
    expect(daves.map((x) => x.total_cents).sort((a, b) => a - b)).toEqual([1111, 2222]);
  });

  it('counts NULL-staff distributions as unlinked, in the grand total only', () => {
    insertDist(insertCalc('2026-08-13', 'Dinner', 10000), null, 'Ghost', 'FOH', 777, 'TS-9999');

    const r = report.getPeriodReport(db, P);
    expect(r.rows.some((x) => x.staff_id === null)).toBe(false);
    expect(r.unlinkedCount).toBe(1);
    expect(r.unlinkedCents).toBe(777);
    // grand total includes the unlinked row
    const rowSum = r.rows.reduce((s, x) => s + x.total_cents, 0);
    expect(r.grandTotalCents).toBe(rowSum + 777);
  });

  it('computes the grand total as a SQL SUM (literal check)', () => {
    const e = insertStaff('Erin', 'FOH', 'TS-9006');
    insertDist(insertCalc('2026-08-14', 'Lunch', 10000), e, 'Erin', 'FOH', 12345);

    // Independent literal: sum every non-voided distribution in the period.
    const literal = db.prepare(`
      SELECT COALESCE(SUM(td.total_cents), 0) AS cents
        FROM tip_distributions td
        JOIN tip_calculations tc ON tc.id = td.calculation_id
       WHERE tc.voided = 0 AND tc.date >= ? AND tc.date < '2026-08-23'
    `).get(P) as { cents: number };

    expect(report.getPeriodReport(db, P).grandTotalCents).toBe(literal.cents);
  });

  it('reports active-staff counts for the footer', () => {
    insertStaff('Frank Inactive', 'FOH', 'TS-9007', 0);
    const r = report.getPeriodReport(db, P);
    // 7 staff so far (Alice, Bob, Carol, Dave×2, Erin, Frank) — Frank inactive.
    expect(r.activeStaffCount).toBe(6);
    // Six distinct staff have tips at this point in the suite.
    expect(r.staffPaidCount).toBe(6);
  });
});

// ── drill-down ───────────────────────────────────────────────────────────────

describe('getStaffPeriodDetail', () => {
  it('lists shifts newest-first with the period total', () => {
    const g = insertStaff('Grace', 'FOH', 'TS-9008');
    insertDist(insertCalc('2026-08-15', 'Lunch', 10000), g, 'Grace', 'FOH', 100);
    insertDist(insertCalc('2026-08-16', 'Dinner', 10000), g, 'Grace', 'FOH', 200);

    const d = report.getStaffPeriodDetail(db, P, 'TS-9008')!;
    expect(d.staff?.name).toBe('Grace');
    expect(d.totalCents).toBe(300);
    expect(d.shifts.map((s) => s.date)).toEqual(['2026-08-16', '2026-08-15']);
  });

  it('resolves deactivated staff but not unknown codes', () => {
    const h = insertStaff('Hank', 'FOH', 'TS-9009');
    insertDist(insertCalc('2026-08-17', 'Dinner', 10000), h, 'Hank', 'FOH', 500);
    db.prepare('UPDATE staff SET active = 0 WHERE id = ?').run(h);

    const d = report.getStaffPeriodDetail(db, P, 'TS-9009');
    expect(d).not.toBeNull();
    expect(d!.staff?.active).toBe(0);
    expect(d!.totalCents).toBe(500);

    expect(report.getStaffPeriodDetail(db, P, 'TS-0000')).toBeNull();
  });
});

// ── staff codes ──────────────────────────────────────────────────────────────

describe('staff codes', () => {
  it('assigns sequential codes and never reuses a deleted one', () => {
    const c1 = staffCode.nextStaffCode();
    const c2 = staffCode.nextStaffCode();
    // Counter continues past the TS-90xx codes inserted by the report tests.
    expect(c1).toMatch(/^TS-\d{4,}$/);
    expect(c2).toMatch(/^TS-\d{4,}$/);
    const n1 = parseInt(c1.slice(3), 10);
    expect(parseInt(c2.slice(3), 10)).toBe(n1 + 1);

    const id1 = insertStaff('Temp One', 'FOH', c1);
    const id2 = insertStaff('Temp Two', 'FOH', c2);
    db.prepare('DELETE FROM staff WHERE id = ?').run(id1); // no distributions
    const c3 = staffCode.nextStaffCode();
    expect(c3).not.toBe(c1); // never reused
    expect(parseInt(c3.slice(3), 10)).toBe(n1 + 2);
    db.prepare('DELETE FROM staff WHERE id = ?').run(id2);
  });

  it('self-heals a stale counter from the highest existing code', () => {
    // Simulate a stale counter behind the roster (e.g. direct inserts).
    db.prepare("UPDATE settings SET value = '1' WHERE key = 'staff_code_seq'").run();
    const next = staffCode.nextStaffCode();
    const maxExisting = db.prepare(`
      SELECT COALESCE(MAX(CAST(substr(staff_code, 4) AS INTEGER)), 0) AS n
      FROM staff WHERE staff_code IS NOT NULL
    `).get() as { n: number };
    expect(parseInt(next.slice(3), 10)).toBe(maxExisting.n + 1);
  });

  it('self-heals a missing counter row', () => {
    db.prepare("DELETE FROM settings WHERE key = 'staff_code_seq'").run();
    const next = staffCode.nextStaffCode();
    expect(next).toMatch(/^TS-\d{4,}$/);
    const row = db.prepare(
      "SELECT value FROM settings WHERE key = 'staff_code_seq'",
    ).get() as { value: string };
    expect(row.value).toBe(next.slice(3));
  });
});

// ── CSV ──────────────────────────────────────────────────────────────────────

describe('CSV', () => {
  it('neutralizes formula-injection leading characters', () => {
    expect(report.sanitizeCsvField('=CMD')).toBe("'=CMD");
    expect(report.sanitizeCsvField('+A1')).toBe("'+A1");
    expect(report.sanitizeCsvField('-5')).toBe("'-5");
    expect(report.sanitizeCsvField('@SUM')).toBe("'@SUM");
    expect(report.sanitizeCsvField('Plain')).toBe('Plain');
    expect(report.sanitizeCsvField('')).toBe('');
    expect(report.sanitizeCsvField('a=b')).toBe('a=b'); // only the FIRST char matters
  });

  it('quotes RFC-4180 special characters', () => {
    expect(report.csvField('O"Brien')).toBe('"O""Brien"');
    expect(report.csvField('a,b')).toBe('"a,b"');
    expect(report.csvField('line\nbreak')).toBe('"line\nbreak"');
    expect(report.csvField('simple')).toBe('simple');
  });

  it('builds a report CSV with header, rows, and metadata', () => {
    const csv = report.buildReportCsv({
      periodStart: '2026-08-09',
      rows: [
        { staff_id: 1, name: 'Alice', role: 'FOH', staff_code: 'TS-0001', shifts: 3, total_cents: 123456 },
        { staff_id: 2, name: '=EVIL', role: 'Bar', staff_code: 'TS-0002', shifts: 1, total_cents: 100 },
      ],
      voidedExcludedCount: 2,
      generatedAt: new Date('2026-08-16T19:00:00Z'),
      timeZone: 'America/Los_Angeles',
    });
    const lines = csv.split('\n');
    expect(lines[0]).toBe('Period Start,Period End,Staff ID,Name,Role,Shifts,Total');
    expect(lines[1]).toBe('2026-08-09,2026-08-23,TS-0001,Alice,FOH,3,1234.56');
    expect(lines[2]).toBe('2026-08-09,2026-08-23,TS-0002,\'=EVIL,Bar,1,1.00');
    expect(csv).toContain('Voided calculations excluded,2');
    expect(csv).toContain('Period label,');
    expect(csv.endsWith('\n')).toBe(true);
  });
});

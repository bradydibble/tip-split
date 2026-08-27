// Staff code assignment (Phase 1.5).
//
// staff_code is the stable, human-readable, never-reused identity for a staff
// member — the TipSplit-side key for the future Square team-member mapping.
// Codes are assigned from a monotonic counter (settings.staff_code_seq) and
// must never be reused, even after a staff row is deleted.
//
// Each claim takes max(counter, highest existing code) + 1, so a stale
// counter (direct inserts, mid-session backup restore) can never hand out a
// code that's already on paper. The UNIQUE index on staff.staff_code is the
// backstop; a collision rolls back the caller's transaction (no partial row).

import db from './db';

export function formatStaffCode(n: number): string {
  return `TS-${String(n).padStart(4, '0')}`;
}

/**
 * Atomically claim the next staff code. Must be called INSIDE the
 * transaction that inserts the staff row, so a failed insert rolls the
 * counter back.
 */
export function nextStaffCode(): string {
  const maxRow = db.prepare(`
    SELECT COALESCE(MAX(CAST(substr(staff_code, 4) AS INTEGER)), 0) AS n
      FROM staff WHERE staff_code IS NOT NULL
  `).get() as { n: number };

  const cur = db.prepare(`
    SELECT CAST(value AS INTEGER) AS n
      FROM settings WHERE key = 'staff_code_seq' AND location_id = 1
  `).get() as { n: number } | undefined;

  const next = Math.max(cur?.n ?? 0, maxRow.n) + 1;

  if (cur) {
    db.prepare(`
      UPDATE settings SET value = ?
       WHERE key = 'staff_code_seq' AND location_id = 1
    `).run(String(next));
  } else {
    db.prepare(`
      INSERT INTO settings (key, value) VALUES ('staff_code_seq', ?)
    `).run(String(next));
  }
  return formatStaffCode(next);
}

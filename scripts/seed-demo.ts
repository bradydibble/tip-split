// Demo data seeder for local development.
//
// Usage (from the repo root):
//   node --env-file=.env node_modules/.bin/vite-node scripts/seed-demo.ts            # seed if empty
//   node --env-file=.env node_modules/.bin/vite-node scripts/seed-demo.ts --force    # wipe + reseed
//   node --env-file=.env node_modules/.bin/vite-node scripts/seed-demo.ts --days 30  # only last N days
//
// Generates a realistic ~2.5 months of Lunch/Dinner tip calculations from
// 2026-06-01 through today (Pacific business date), using the app's own
// calculate() engine so pools and distributions are internally consistent.
// Deterministic: a fixed-seed mulberry32 drives every random choice.
//
// Idempotent: refuses to run over existing data unless --force is given.

import db from '../src/lib/server/db';
import { calculate, dollarsToCents } from '../src/lib/calculator';
import { businessDate } from '../src/lib/business-date';
import { addDays } from '../src/lib/pay-period';
import { nextStaffCode } from '../src/lib/server/staff-code';
import bcrypt from 'bcryptjs';

// ── Args ──────────────────────────────────────────────────────────────────────
const args = process.argv.slice(2);
const force = args.includes('--force');
const daysIdx = args.indexOf('--days');
const limitDays = daysIdx >= 0 ? parseInt(args[daysIdx + 1] ?? '', 10) : NaN;

// ── Idempotency guard ─────────────────────────────────────────────────────────
const existingStaff = (db.prepare('SELECT COUNT(*) AS n FROM staff').get() as { n: number }).n;
const existingCalcs = (db.prepare('SELECT COUNT(*) AS n FROM tip_calculations').get() as { n: number }).n;
if (existingStaff > 0 || existingCalcs > 0) {
  if (!force) {
    console.log(`[seed] Database already has ${existingStaff} staff / ${existingCalcs} calculations.`);
    console.log('[seed] Nothing to do. Re-run with --force to wipe and reseed.');
    process.exit(0);
  }
  console.log('[seed] --force: wiping demo data…');
  db.exec(`
    DELETE FROM tip_distributions;
    DELETE FROM tip_calculations;
    DELETE FROM shift_assignments;
    DELETE FROM staff;
    DELETE FROM users;
    DELETE FROM sqlite_sequence WHERE name IN ('staff', 'users', 'tip_calculations', 'tip_distributions');
  `);
  db.prepare("INSERT OR REPLACE INTO settings (key, value, location_id) VALUES ('staff_code_seq', '0', 1)").run();
}

// ── Deterministic RNG (mulberry32) ────────────────────────────────────────────
function mulberry32(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a |= 0;
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
const rng = mulberry32(20260601);
const between = (min: number, max: number) => min + rng() * (max - min);
const chance = (p: number) => rng() < p;

// ── Manager user ──────────────────────────────────────────────────────────────
const pin = process.env.INITIAL_MANAGER_PIN || '1234';
db.prepare("INSERT INTO users (name, pin_hash, role) VALUES (?, ?, 'manager')")
  .run('Manager', bcrypt.hashSync(pin, 10));

// ── Roster ────────────────────────────────────────────────────────────────────
interface RosterEntry { name: string; role: 'FOH' | 'Kitchen' | 'Bar' | 'Busser'; }
const ROSTER: RosterEntry[] = [
  { name: 'Maria Santos',   role: 'FOH' },
  { name: 'Jake Thompson',  role: 'FOH' },
  { name: 'Emily Chen',     role: 'FOH' },
  { name: 'Derek Okafor',   role: 'FOH' },
  { name: 'Sam Rivera',     role: 'Bar' },
  { name: 'Lena Kowalski',  role: 'Bar' },
  { name: 'Carlos Mendez',  role: 'Kitchen' },
  { name: 'Aisha Patel',    role: 'Kitchen' },
  { name: 'Tom Bradley',    role: 'Kitchen' },
  { name: 'Nina Petrov',    role: 'Busser' },
];

const insertStaff = db.prepare(
  'INSERT INTO staff (name, role, active, location_id, source, staff_code) VALUES (?, ?, 1, 1, ?, ?)',
);
const staffByCode = new Map<string, { id: number; name: string; role: RosterEntry['role']; staff_code: string }>();
for (const entry of ROSTER) {
  const code = nextStaffCode(db);
  // A couple of staff come from Square sync, to exercise that path.
  const source = entry.name === 'Sam Rivera' || entry.name === 'Nina Petrov' ? 'square' : 'manual';
  const info = insertStaff.run(entry.name, entry.role, source, code);
  staffByCode.set(code, { id: Number(info.lastInsertRowid), name: entry.name, role: entry.role, staff_code: code });
}
const staffList = [...staffByCode.values()];

// ── Split config (mirrors the seeded settings) ────────────────────────────────
const settings = new Map<string, string>();
for (const row of db.prepare('SELECT key, value FROM settings WHERE location_id = 1').all() as { key: string; value: string }[]) {
  settings.set(row.key, row.value);
}
const config = {
  ccFeeRate: parseFloat(settings.get('cc_fee_rate') ?? '2.5') / 100,
  kitchenPct: parseFloat(settings.get('kitchen_pct') ?? '30') / 100,
  barLiquorPct: parseFloat(settings.get('bar_liquor_pct') ?? '10') / 100,
  busserRateCents: dollarsToCents(settings.get('busser_rate') ?? '20'),
  roundToDollar: true,
};

// ── Date range ────────────────────────────────────────────────────────────────
const tz = settings.get('timezone') ?? 'America/Los_Angeles';
const today = businessDate(new Date(), tz);
const start = Number.isFinite(limitDays) ? addDays(today, -limitDays + 1) : '2026-06-01';

// ── Insertion helpers ─────────────────────────────────────────────────────────
const insertCalc = db.prepare(`
  INSERT INTO tip_calculations
    (date, shift, gross_tips_cents, liquor_sales_cents, cc_fee_rate, kitchen_pct, bar_liquor_pct,
     cc_fees_cents, tips_after_fees_cents, kitchen_pool_cents, bar_pool_cents, busser_pool_cents, foh_pool_cents,
     location_id, created_at, voided)
  VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 1, ?, 0)
`);
const insertDist = db.prepare(`
  INSERT INTO tip_distributions
    (calculation_id, staff_id, staff_code, name, role, foh_share_cents, bar_pool_share_cents,
     kitchen_share_cents, busser_share_cents, total_cents)
  VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
`);

function weekdayOf(date: string): number {
  const [y, m, d] = date.split('-').map(Number);
  return new Date(Date.UTC(y, m - 1, d)).getUTCDay(); // 0=Sun … 6=Sat
}

/** Pick who works this shift; guarantees a minimum viable crew. */
function crewFor(date: string, shift: 'Lunch' | 'Dinner') {
  const p = shift === 'Lunch'
    ? { FOH: 0.7, Kitchen: 0.65, Bar: 0.55, Busser: 0.5 }
    : { FOH: 0.8, Kitchen: 0.75, Bar: 0.7, Busser: 0.6 };
  const crew = staffList.filter((s) => chance(p[s.role]));
  const min = { FOH: 2, Kitchen: 1, Bar: 1, Busser: 1 };
  for (const role of ['FOH', 'Kitchen', 'Bar', 'Busser'] as const) {
    const have = crew.filter((s) => s.role === role).length;
    if (have < min[role]) {
      for (const s of staffList.filter((x) => x.role === role && !crew.includes(x))) {
        if (crew.filter((x) => x.role === role).length >= min[role]) break;
        crew.push(s);
      }
    }
  }
  return crew;
}

let calcCount = 0;
let distCount = 0;
let totalCents = 0;
let firstDate = '';
let lastDate = '';
let lastDinner: { date: string; crew: typeof staffList; liquor: number } | null = null;

const seedAll = db.transaction(() => {
  let date = start;
  while (date <= today) {
    const dow = weekdayOf(date);
    const weekend = dow === 5 || dow === 6; // Fri/Sat nights are busy; keep Sun lighter
    const mult = weekend ? 1.4 : 1.0;
    const crew = crewFor(date, 'Dinner'); // one crew per day is fine for both shifts

    for (const shift of ['Lunch', 'Dinner'] as const) {
      // Skip some lunches (slow days) and rare dinners (closed).
      if (shift === 'Lunch' && !chance(0.85)) continue;
      if (shift === 'Dinner' && !chance(0.95)) continue;

      const gross = Math.round(between(shift === 'Lunch' ? 160 : 400, shift === 'Lunch' ? 340 : 820) * mult * 100);
      const liquor = shift === 'Lunch'
        ? (chance(0.5) ? 0 : Math.round(between(0, 140) * 100))
        : Math.round(between(240, 560) * mult * 100);

      const result = calculate(
        {
          grossTipsCents: gross,
          liquorSalesCents: liquor,
          staff: crew.map((s) => ({ id: s.id, name: s.name, role: s.role })),
          config,
        },
        rng,
      );

      const nowSec = Math.floor(Date.parse(date + 'T20:00:00Z') / 1000);
      const info = insertCalc.run(
        date, shift, gross, liquor,
        config.ccFeeRate, config.kitchenPct, config.barLiquorPct,
        result.ccFeesCents, result.tipsAfterFeesCents,
        result.kitchenPoolCents, result.barPoolCents, result.busserPoolCents, result.fohPoolCents,
        nowSec,
      );
      const calcId = Number(info.lastInsertRowid);
      const shiftAssignStmt = db.prepare(
        'INSERT INTO shift_assignments (staff_id, date, shift, effective_role) VALUES (?, ?, ?, ?)',
      );
      for (const d of result.distributions) {
        const s = crew.find((c) => c.id === d.staffId)!;
        shiftAssignStmt.run(s.id, date, shift, d.role);
        insertDist.run(
          calcId, s.id, s.staff_code, d.name, d.role,
          d.fohShareCents, d.barPoolShareCents, d.kitchenShareCents, d.busserShareCents, d.totalCents,
        );
        distCount++;
        totalCents += d.totalCents;
      }
      calcCount++;
      if (!firstDate) firstDate = date;
      lastDate = date;
      if (shift === 'Dinner') lastDinner = { date, crew, liquor };
    }
    date = addDays(date, 1);
  }
});
seedAll();

// ── One voided + corrected pair (most recent dinner) ─────────────────────────
if (lastDinner) {
  const { date, crew, liquor } = lastDinner;
  const voidedCalc = db.prepare(
    "SELECT id, gross_tips_cents FROM tip_calculations WHERE date = ? AND shift = 'Dinner' AND voided = 0 ORDER BY id DESC LIMIT 1",
  ).get(date) as { id: number; gross_tips_cents: number };
  if (voidedCalc) {
    db.prepare('UPDATE tip_calculations SET voided = 1 WHERE id = ?').run(voidedCalc.id);
    const correctedGross = voidedCalc.gross_tips_cents + 4500; // missed a $45 card
    const result = calculate(
      {
        grossTipsCents: correctedGross,
        liquorSalesCents: liquor,
        staff: crew.map((s) => ({ id: s.id, name: s.name, role: s.role })),
        config,
      },
      rng,
    );
const info = insertCalc.run(
        date, 'Dinner', correctedGross, liquor,
        config.ccFeeRate, config.kitchenPct, config.barLiquorPct,
        result.ccFeesCents, result.tipsAfterFeesCents,
        result.kitchenPoolCents, result.barPoolCents, result.busserPoolCents, result.fohPoolCents,
        Math.floor(Date.parse(date + 'T23:30:00Z') / 1000),
      );
      const calcId = Number(info.lastInsertRowid);
      const shiftAssignStmt = db.prepare(
        'INSERT INTO shift_assignments (staff_id, date, shift, effective_role) VALUES (?, ?, ?, ?)',
      );
      for (const d of result.distributions) {
        const s = crew.find((c) => c.id === d.staffId)!;
        shiftAssignStmt.run(s.id, date, 'Dinner', d.role);
        insertDist.run(
          calcId, s.id, s.staff_code, d.name, d.role,
          d.fohShareCents, d.barPoolShareCents, d.kitchenShareCents, d.busserShareCents, d.totalCents,
        );
        distCount++;
        totalCents += d.totalCents;
      }
    calcCount++;
    console.log(`[seed] Voided + re-entered dinner for ${date} (+$45.00).`);
  }
}

// ── Summary ───────────────────────────────────────────────────────────────────
console.log('[seed] Done.');
console.log(`  staff:        ${staffList.length} (${[...new Set(staffList.map((s) => s.role))].join(', ')})`);
console.log(`  calculations: ${calcCount} (${firstDate} → ${lastDate})`);
console.log(`  distributions: ${distCount}`);
console.log(`  total paid:   $${(totalCents / 100).toFixed(2)}`);
console.log(`  manager PIN:  ${pin}`);

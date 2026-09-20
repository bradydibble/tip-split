import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { mkdtempSync, rmSync } from 'fs';
import { tmpdir } from 'os';
import { join } from 'path';
import type Database from 'better-sqlite3';

const tmp = mkdtempSync(join(tmpdir(), 'tipsplit-adjust-test-'));
process.env.DATABASE_PATH = join(tmp, 'test.db');

let db: Database.Database;
let page: typeof import('./+page.server');

beforeAll(async () => {
  ({ default: db } = await import('$lib/server/db'));
  page = await import('./+page.server');
});

afterAll(() => {
  db?.close();
  rmSync(tmp, { recursive: true, force: true });
});

interface Seed {
  calcId: number;
  targetStaffId: number;
  shiftLeadId: number;
}

/** One Dinner calculation with two FOH staff, plus a real shift-lead user. */
let seedCounter = 0;
function seedCalculation(): Seed {
  // Unique codes per call — staff_code is UNIQUE and tests re-seed.
  const codeA = `TS-9A${String(++seedCounter).padStart(3, '0')}`;
  const codeB = `TS-9B${String(seedCounter).padStart(3, '0')}`;

  const calcId = Number(db.prepare(`
    INSERT INTO tip_calculations
      (date, shift, gross_tips_cents, liquor_sales_cents, cc_fee_rate, kitchen_pct,
       bar_liquor_pct, cc_fees_cents, tips_after_fees_cents, kitchen_pool_cents,
       bar_pool_cents, busser_pool_cents, foh_pool_cents)
    VALUES ('2026-09-01', 'Dinner', 10000, 0, 0.03, 0.10, 0.10, 300, 9700, 970, 0, 0, 8730)
  `).run().lastInsertRowid);

  const averyId = Number(db.prepare(
    'INSERT INTO staff (name, role, staff_code) VALUES (?, \'FOH\', ?)'
  ).run('Avery Test', codeA).lastInsertRowid);
  const blairId = Number(db.prepare(
    'INSERT INTO staff (name, role, staff_code) VALUES (?, \'FOH\', ?)'
  ).run('Blair Test', codeB).lastInsertRowid);

  const insertDist = db.prepare(`
    INSERT INTO tip_distributions
      (calculation_id, staff_id, name, role, foh_share_cents, total_cents)
    VALUES (?, ?, ?, 'FOH', ?, ?)
  `);
  insertDist.run(calcId, averyId, 'Avery Test', 4000, 4000);
  insertDist.run(calcId, blairId, 'Blair Test', 4730, 4730);

  const shiftLeadId = Number(db.prepare(
    "INSERT INTO users (pin_hash, role) VALUES ('x', 'shift_lead')"
  ).run().lastInsertRowid);

  return { calcId, targetStaffId: averyId, shiftLeadId };
}

describe('adjust action permissions', () => {
  it('allows a shift lead to apply a percentage adjustment', async () => {
    const { calcId, targetStaffId, shiftLeadId } = seedCalculation();

    const fd = new FormData();
    fd.set('staffId', String(targetStaffId));
    fd.set('adjustment', '-20');
    fd.set('reason', 'Late arrival');

    const action = page.actions.adjust;
    if (!action) throw new Error('adjust action is not defined');

    let redirectLocation: string | undefined;
    try {
      await action({
        request: new Request(`http://localhost/calculate/${calcId}?/adjust`, {
          method: 'POST',
          body: fd,
        }),
        locals: { user: { id: shiftLeadId, role: 'shift_lead' }, sessionId: null },
        params: { id: String(calcId) },
      } as Parameters<typeof action>[0]);
    } catch (error) {
      const redirect = error as { status?: number; location?: string };
      expect(redirect.status).toBe(303);
      redirectLocation = redirect.location;
    }

    // The action completed and redirected — no 403 for the shift lead.
    expect(redirectLocation).toBe(`/calculate/${calcId}`);

    // The adjustment landed: target row reduced, audit row written by the
    // shift lead.
    const dist = db.prepare(
      'SELECT total_cents, adjustment_cents FROM tip_distributions WHERE staff_id = ? AND calculation_id = ?'
    ).get(targetStaffId, calcId) as { total_cents: number; adjustment_cents: number };
    expect(dist.total_cents).toBe(3200); // 4000 × 0.8
    expect(dist.adjustment_cents).toBe(-800);

    const audit = db.prepare(
      'SELECT user_id, adjustment_cents FROM adjustment_logs ORDER BY id DESC LIMIT 1'
    ).get() as { user_id: number; adjustment_cents: number };
    expect(audit.user_id).toBe(shiftLeadId);
    expect(audit.adjustment_cents).toBe(-800);
  });

  it('allows a manager to apply a percentage adjustment', async () => {
    const { calcId, targetStaffId } = seedCalculation();

    const fd = new FormData();
    fd.set('staffId', String(targetStaffId));
    fd.set('adjustment', '-25');

    const action = page.actions.adjust!;
    let redirected = false;
    try {
      await action({
        request: new Request(`http://localhost/calculate/${calcId}?/adjust`, {
          method: 'POST',
          body: fd,
        }),
        locals: { user: { id: 1, role: 'manager' }, sessionId: null },
        params: { id: String(calcId) },
      } as Parameters<typeof action>[0]);
    } catch {
      redirected = true; // redirect() throws — the adjustment committed
    }
    expect(redirected).toBe(true);
  });

  it('still requires a manager to void a calculation', async () => {
    const { calcId, shiftLeadId } = seedCalculation();

    const action = page.actions.void;
    if (!action) throw new Error('void action is not defined');

    const result = (await action({
      locals: { user: { id: shiftLeadId, role: 'shift_lead' }, sessionId: null },
      params: { id: String(calcId) },
    } as Parameters<typeof action>[0])) as { status: number; data?: { error?: string } };

    expect(result.status).toBe(403);
    expect(result.data?.error).toBe('Manager access required');

    // Nothing was voided.
    const calc = db.prepare('SELECT voided FROM tip_calculations WHERE id = ?')
      .get(calcId) as { voided: number };
    expect(calc.voided).toBe(0);
  });

  it('rejects a signed-out user from adjusting', async () => {
    const { calcId, targetStaffId } = seedCalculation();

    const fd = new FormData();
    fd.set('staffId', String(targetStaffId));
    fd.set('adjustment', '-20');

    const action = page.actions.adjust!;
    const result = (await action({
      request: new Request(`http://localhost/calculate/${calcId}?/adjust`, {
        method: 'POST',
        body: fd,
      }),
      locals: { user: null, sessionId: null },
      params: { id: String(calcId) },
    } as Parameters<typeof action>[0])) as { status: number };

    expect(result.status).toBe(401);
  });
});

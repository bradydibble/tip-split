import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { mkdtempSync, rmSync } from 'fs';
import { tmpdir } from 'os';
import { join } from 'path';
import type Database from 'better-sqlite3';

const tmp = mkdtempSync(join(tmpdir(), 'tipsplit-calculate-test-'));
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

describe('calculate action staff roles', () => {
  it('keeps each submitted role with its staff member across different row orders', async () => {
    // Database order is Kitchen, FOH. The form's visual order is FOH, Kitchen.
    const kitchenId = Number(db.prepare(
      "INSERT INTO staff (name, role, staff_code) VALUES ('Filix', 'Kitchen', 'TS-1001')",
    ).run().lastInsertRowid);
    const fohId = Number(db.prepare(
      "INSERT INTO staff (name, role, staff_code) VALUES ('Aine', 'FOH', 'TS-1002')",
    ).run().lastInsertRowid);

    const formData = new FormData();
    formData.set('date', '2026-08-28');
    formData.set('shift', 'Dinner');
    formData.set('gross_tips', '100');
    formData.set('liquor_sales', '0');
    formData.append('included', String(fohId));
    formData.set(`role_${fohId}`, 'FOH');
    formData.append('included', String(kitchenId));
    formData.set(`role_${kitchenId}`, 'Kitchen');

    const action = page.actions.calculate;
    if (!action) throw new Error('calculate action is not defined');

    let calculationId: string | undefined;
    try {
      await action({
        request: new Request('http://localhost/calculate?/calculate', {
          method: 'POST',
          body: formData,
        }),
        locals: { user: { id: 1, role: 'manager' }, sessionId: null },
      } as Parameters<typeof action>[0]);
    } catch (error) {
      const redirect = error as { status?: number; location?: string };
      expect(redirect.status).toBe(303);
      calculationId = redirect.location?.split('/').pop();
    }

    expect(calculationId).toBeDefined();
    const distributions = db.prepare(
      'SELECT staff_id, role FROM tip_distributions WHERE calculation_id = ? ORDER BY staff_id',
    ).all(calculationId) as Array<{ staff_id: number; role: string }>;

    expect(distributions).toEqual([
      { staff_id: kitchenId, role: 'Kitchen' },
      { staff_id: fohId, role: 'FOH' },
    ]);
  });
});

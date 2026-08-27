import type { Actions, PageServerLoad } from './$types';
import { fail } from '@sveltejs/kit';
import db from '$lib/server/db';
import type { StaffRow } from '$lib/server/db';
import { requireManager } from '$lib/server/auth';
import { nextStaffCode } from '$lib/server/staff-code';

export const load: PageServerLoad = ({ locals }) => {
  requireManager(locals);

  const staff = db.prepare(
    'SELECT * FROM staff WHERE location_id = 1 ORDER BY active DESC, role, name'
  ).all() as StaffRow[];

  return { staff };
};

export const actions: Actions = {
  add: async ({ request, locals }) => {
    if (!locals.user || locals.user.role !== 'manager') return fail(403);

    const fd = await request.formData();
    const name = String(fd.get('name') ?? '').trim();
    const role = String(fd.get('role') ?? '');

    if (!name) return fail(400, { addError: 'Name is required' });
    if (!['FOH', 'Kitchen', 'Bar', 'Busser'].includes(role)) return fail(400, { addError: 'Invalid role' });

    // Code is claimed inside the insert transaction: if the insert fails,
    // the counter rolls back and no code is lost.
    const { lastInsertRowid } = db.transaction(() => {
      const code = nextStaffCode();
      return db.prepare('INSERT INTO staff (name, role, staff_code) VALUES (?, ?, ?)').run(name, role, code);
    })();

    return { addedId: Number(lastInsertRowid) };
  },

  toggle: async ({ request, locals }) => {
    if (!locals.user || locals.user.role !== 'manager') return fail(403);

    const id = String((await request.formData()).get('id') ?? '');
    const row = db.prepare('SELECT active FROM staff WHERE id = ?').get(id) as { active: number } | undefined;
    if (!row) return fail(404);

    db.prepare('UPDATE staff SET active = ? WHERE id = ?').run(row.active ? 0 : 1, id);
    return {};
  },

  remove: async ({ request, locals }) => {
    if (!locals.user || locals.user.role !== 'manager') return fail(403);

    const id = String((await request.formData()).get('id') ?? '');
    const row = db.prepare('SELECT id, name, staff_code FROM staff WHERE id = ?').get(id) as
      | { id: number; name: string; staff_code: string | null }
      | undefined;
    if (!row) return fail(404);

    // A staff member with tip history is payroll history — deleting them
    // would orphan distributions and burn a code. Deactivate instead.
    const dists = db.prepare(
      'SELECT COUNT(*) AS n FROM tip_distributions WHERE staff_id = ?'
    ).get(id) as { n: number };
    if (dists.n > 0) {
      return fail(400, { removeError: `${row.name} has tip history and can't be removed. Deactivate them instead.` });
    }

    db.prepare('DELETE FROM staff WHERE id = ?').run(id);
    return {};
  },

  changeRole: async ({ request, locals }) => {
    if (!locals.user || locals.user.role !== 'manager') return fail(403);

    const fd = await request.formData();
    const id   = String(fd.get('id')   ?? '');
    const role = String(fd.get('role') ?? '');

    if (!['FOH', 'Kitchen', 'Bar', 'Busser'].includes(role)) return fail(400, { roleError: 'Invalid role' });

    const row = db.prepare('SELECT id FROM staff WHERE id = ?').get(id);
    if (!row) return fail(404);

    db.prepare('UPDATE staff SET role = ? WHERE id = ?').run(role, id);
    return {};
  },
};

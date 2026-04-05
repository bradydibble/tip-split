import type { Actions, PageServerLoad } from './$types';
import { fail, redirect } from '@sveltejs/kit';
import db from '$lib/server/db';
import type { StaffRow } from '$lib/server/db';

export const load: PageServerLoad = ({ locals }) => {
  if (!locals.user) redirect(303, '/');
  if (locals.user.role !== 'manager') redirect(303, '/calculate');

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
    if (!['FOH', 'Kitchen', 'Bar'].includes(role)) return fail(400, { addError: 'Invalid role' });

    db.prepare('INSERT INTO staff (name, role) VALUES (?, ?)').run(name, role);
    return {};
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
    db.prepare('DELETE FROM staff WHERE id = ?').run(id);
    return {};
  },
};

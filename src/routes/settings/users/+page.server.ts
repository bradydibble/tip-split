import type { Actions, PageServerLoad } from './$types';
import { fail, redirect } from '@sveltejs/kit';
import db from '$lib/server/db';
import { hashPin, findUserByPin } from '$lib/server/auth';
import type { UserRow } from '$lib/server/db';

export const load: PageServerLoad = ({ locals }) => {
  if (!locals.user) redirect(303, '/');
  if (locals.user.role !== 'manager') redirect(303, '/calculate');

  const users = db.prepare('SELECT id, role, created_at FROM users ORDER BY id').all() as Pick<UserRow, 'id' | 'role'>[];
  return { users, currentUserId: locals.user.id };
};

export const actions: Actions = {
  add: async ({ request, locals }) => {
    if (!locals.user || locals.user.role !== 'manager') return fail(403);

    const fd = await request.formData();
    const pin  = String(fd.get('pin')  ?? '').trim();
    const role = String(fd.get('role') ?? '');

    if (!/^\d{4,6}$/.test(pin)) {
      return fail(400, { addError: 'PIN must be 4–6 digits' });
    }
    if (!['shift_lead', 'manager'].includes(role)) {
      return fail(400, { addError: 'Invalid role' });
    }

    const existing = await findUserByPin(pin);
    if (existing) return fail(400, { addError: 'That PIN is already in use' });

    const hash = await hashPin(pin);
    db.prepare('INSERT INTO users (pin_hash, role) VALUES (?, ?)').run(hash, role);
    return {};
  },

  remove: async ({ request, locals }) => {
    if (!locals.user || locals.user.role !== 'manager') return fail(403);

    const id = Number((await request.formData()).get('id'));
    if (id === locals.user.id) return fail(400, { removeError: "You can't remove yourself" });

    db.prepare('DELETE FROM users WHERE id = ?').run(id);
    return {};
  },
};

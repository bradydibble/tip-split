import type { Actions, PageServerLoad } from './$types';
import { fail } from '@sveltejs/kit';
import db from '$lib/server/db';
import type { StaffRow } from '$lib/server/db';
import { requireManager } from '$lib/server/auth';
import { nextStaffCode } from '$lib/server/staff-code';

export const load: PageServerLoad = ({ locals }) => {
  requireManager(locals);

  const staff = db.prepare(
    `SELECT s.*, GROUP_CONCAT(j.square_job_title, '; ') as square_job_titles
     FROM staff s
     LEFT JOIN staff_square_jobs j ON j.staff_id = s.id AND j.active = 1
     WHERE s.location_id = 1
     GROUP BY s.id
     ORDER BY s.active DESC, s.role_mapping_state, s.role, s.name`
  ).all() as (StaffRow & { square_job_titles: string | null })[];

  // Duplicate detection: same square_team_member_id appearing more than once
  const dupes = db.prepare(`
    SELECT square_team_member_id, GROUP_CONCAT(id || ':' || name, ', ') as records
    FROM staff
    WHERE square_team_member_id IS NOT NULL
    GROUP BY square_team_member_id
    HAVING COUNT(*) > 1
  `).all() as { square_team_member_id: string; records: string }[];

  return { staff, duplicates: dupes };
};

export const actions: Actions = {
  add: async ({ request, locals }) => {
    if (!locals.user || locals.user.role !== 'manager') return fail(403);

    const fd = await request.formData();
    const name = String(fd.get('name') ?? '').trim();
    const role = String(fd.get('role') ?? '');

    if (!name) return fail(400, { addError: 'Name is required' });
    if (!['FOH', 'Kitchen', 'Bar', 'Busser'].includes(role)) return fail(400, { addError: 'Invalid role' });

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

    // Update the role AND clear NEEDS_REVIEW since the manager is explicitly choosing
    db.prepare(`
      UPDATE staff SET role = ?, role_mapping_state = 'MAPPED', default_tip_split_role = ?
      WHERE id = ?
    `).run(
      role,
      role === 'Bar' ? 'BAR' :
      role === 'Kitchen' ? 'KITCHEN' :
      role === 'Busser' ? 'BUSSER' : 'FOH',
      id,
    );
    return {};
  },

  // Manager overrides a staff member's exclusion state individually.
  // This is separate from the job-title-based mapping — it lets the manager say
  // "always exclude this person regardless of their job title" or
  // "include this person even though their title maps to EXCLUDED."
  setExclusion: async ({ request, locals }) => {
    if (!locals.user || locals.user.role !== 'manager') return fail(403);

    const fd = await request.formData();
    const id = String(fd.get('id') ?? '');
    const exclude = fd.get('exclude') === 'true';

    const row = db.prepare('SELECT id, name, role FROM staff WHERE id = ?').get(id) as
      | { id: number; name: string; role: string }
      | undefined;
    if (!row) return fail(404);

    if (exclude) {
      db.prepare(`
        UPDATE staff SET role_mapping_state = 'EXCLUDED', default_tip_split_role = 'EXCLUDED'
        WHERE id = ?
      `).run(id);
    } else {
      // Un-excluding: re-derive from job titles, or default to MAPPED with current role
      const jobs = db.prepare(
        'SELECT square_job_title FROM staff_square_jobs WHERE staff_id = ? AND active = 1'
      ).all(id) as { square_job_title: string }[];

      if (jobs.length > 0) {
        // Re-run the mapping from job titles
        const { mapJobs } = await import('$lib/square-role-map');
        const titles = jobs.map(j => j.square_job_title);
        const mapped = mapJobs(titles);
        db.prepare(`
          UPDATE staff SET role_mapping_state = ?, default_tip_split_role = ?
          WHERE id = ?
        `).run(mapped.state, mapped.defaultRole ?? null, id);
      } else {
        // No jobs — just mark as MAPPED with current role
        db.prepare(`
          UPDATE staff SET role_mapping_state = 'MAPPED'
          WHERE id = ?
        `).run(id);
      }
    }
    return { exclusionSet: true };
  },

  // Manual edit of staff name and/or role
  edit: async ({ request, locals }) => {
    if (!locals.user || locals.user.role !== 'manager') return fail(403);

    const fd = await request.formData();
    const id = String(fd.get('id') ?? '');
    const name = String(fd.get('name') ?? '').trim();
    const role = String(fd.get('role') ?? '');

    if (!name) return fail(400, { editError: 'Name is required' });
    if (!['FOH', 'Kitchen', 'Bar', 'Busser'].includes(role)) return fail(400, { editError: 'Invalid role' });

    const row = db.prepare('SELECT id FROM staff WHERE id = ?').get(id);
    if (!row) return fail(404);

    db.prepare('UPDATE staff SET name = ?, role = ? WHERE id = ?').run(name, role, id);
    return { edited: true };
  },

  // Resolve duplicates: merge two staff records into one, keeping the primary
  // and redirecting all tip_distributions and shift_assignments to it.
  resolveDupe: async ({ request, locals }) => {
    if (!locals.user || locals.user.role !== 'manager') return fail(403);

    const fd = await request.formData();
    const keepId = String(fd.get('keep_id') ?? '');
    const removeId = String(fd.get('remove_id') ?? '');

    if (!keepId || !removeId || keepId === removeId) {
      return fail(400, { dupeError: 'Must select which record to keep' });
    }

    const keep = db.prepare('SELECT id FROM staff WHERE id = ?').get(keepId);
    const remove = db.prepare('SELECT id FROM staff WHERE id = ?').get(removeId);
    if (!keep || !remove) return fail(404, { dupeError: 'Staff record not found' });

    db.transaction(() => {
      // Move tip_distributions
      db.prepare('UPDATE tip_distributions SET staff_id = ? WHERE staff_id = ?').run(keepId, removeId);
      // Move shift_assignments
      db.prepare('UPDATE shift_assignments SET staff_id = ? WHERE staff_id = ?').run(keepId, removeId);
      // Move staff_square_jobs
      db.prepare('UPDATE staff_square_jobs SET staff_id = ? WHERE staff_id = ?').run(keepId, removeId);
      // Delete the duplicate (safe — all references moved)
      db.prepare('DELETE FROM staff WHERE id = ?').run(removeId);
    })();

    return { dupeResolved: true };
  },
};

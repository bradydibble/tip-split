import type { PageServerLoad } from './$types';
import { error, redirect } from '@sveltejs/kit';
import db from '$lib/server/db';
import type { CalcRow, DistRow } from '$lib/server/db';

export const load: PageServerLoad = ({ locals, params }) => {
  if (!locals.user) redirect(303, '/');

  const calc = db.prepare(
    'SELECT * FROM tip_calculations WHERE id = ?'
  ).get(params.id) as CalcRow | undefined;

  if (!calc) error(404, 'Calculation not found');

  const distributions = db.prepare(
    'SELECT * FROM tip_distributions WHERE calculation_id = ? ORDER BY role, name'
  ).all(params.id) as DistRow[];

  return { calc, distributions };
};

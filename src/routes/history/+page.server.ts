import type { PageServerLoad } from './$types';
import { redirect } from '@sveltejs/kit';
import db from '$lib/server/db';

export const load: PageServerLoad = ({ locals }) => {
  if (!locals.user) redirect(303, '/');

  const calcs = db.prepare(`
    SELECT tc.*, COUNT(td.id) as staff_count
    FROM tip_calculations tc
    LEFT JOIN tip_distributions td ON td.calculation_id = tc.id
    WHERE tc.location_id = 1
    GROUP BY tc.id
    ORDER BY tc.date DESC, tc.created_at DESC
    LIMIT 90
  `).all() as Array<{
    id: number; date: string; shift: string;
    tips_after_fees_cents: number; staff_count: number; voided: number;
  }>;

  return { calcs };
};

import type { RequestHandler } from './$types';
import { getShiftStaffing } from '$lib/server/square/staffing';
import { isValidDateStr } from '$lib/pay-period';

/**
 * Shift staffing lookup for the calculate screen.
 *
 * GET /api/staffing?date=YYYY-MM-DD&shift=Lunch|Dinner
 *
 * Answers which roster members are scheduled to work the requested
 * business-date + shift window, so the calculate screen can default its
 * staff list. Read-only against Square; nothing is persisted. Any signed-in
 * user may call it (creating a tip split is a shift-lead task, not a
 * manager task).
 */
export const GET: RequestHandler = async ({ url, locals }) => {
  if (!locals.user) {
    return Response.json({ error: 'Not signed in' }, { status: 401 });
  }

  const date = url.searchParams.get('date') ?? '';
  const shift = url.searchParams.get('shift') ?? '';

  if (!isValidDateStr(date)) {
    return Response.json({ error: 'Invalid date' }, { status: 400 });
  }
  if (shift !== 'Lunch' && shift !== 'Dinner') {
    return Response.json({ error: 'Invalid shift' }, { status: 400 });
  }

  try {
    const staffing = await getShiftStaffing(date, shift);
    return Response.json(staffing);
  } catch (error) {
    // Log the real cause server-side; the client gets a safe fallback that
    // leaves the full-roster behavior in place. Square error strings can
    // carry request ids — do not forward them to the browser.
    console.error('[staffing] failed to resolve shift staffing:', error);
    return Response.json({
      available: false,
      source: 'square_live',
      staffed: [],
      notInRoster: [],
      excluded: [],
    });
  }
};

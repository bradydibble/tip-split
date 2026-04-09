import type { Actions, PageServerLoad } from './$types';
import { error, fail, redirect } from '@sveltejs/kit';
import db from '$lib/server/db';
import type { CalcRow, DistRow, ExportLogRow } from '$lib/server/db';
import { getSettings } from '$lib/server/auth';
import { appendToSheet } from '$lib/server/sheets';

export const load: PageServerLoad = ({ locals, params }) => {
  if (!locals.user) redirect(303, '/');

  const calc = db.prepare(
    'SELECT * FROM tip_calculations WHERE id = ?'
  ).get(params.id) as CalcRow | undefined;

  if (!calc) error(404, 'Calculation not found');

  const distributions = db.prepare(
    'SELECT * FROM tip_distributions WHERE calculation_id = ? ORDER BY role, name'
  ).all(params.id) as DistRow[];

  const exportLog = db.prepare(
    'SELECT * FROM export_log WHERE calculation_id = ? ORDER BY exported_at DESC'
  ).all(params.id) as ExportLogRow[];

  return { calc, distributions, exportLog };
};

export const actions: Actions = {
  void: async ({ params, locals }) => {
    if (!locals.user) redirect(303, '/');

    const calc = db.prepare('SELECT * FROM tip_calculations WHERE id = ?').get(params.id) as CalcRow | undefined;
    if (!calc) return fail(404, { error: 'Not found' });
    if (calc.voided) return fail(400, { error: 'Already voided' });

    db.prepare('UPDATE tip_calculations SET voided = 1 WHERE id = ?').run(params.id);

    // Append VOID row to Google Sheets if configured
    const settings = getSettings();
    const spreadsheetId = settings.google_sheets_spreadsheet_id;
    const credJson = process.env.GOOGLE_SERVICE_ACCOUNT_JSON;

    if (spreadsheetId && credJson) {
      try {
        await appendToSheet(
          spreadsheetId,
          settings.google_sheets_sheet_name || 'Tip History',
          [['VOID', calc.date, calc.shift, `Calculation #${calc.id} voided`]],
          credJson
        );
      } catch {
        // Don't block void if Sheets export fails
      }
    }

    redirect(303, '/history');
  },
};

import type { RequestHandler } from './$types';
import { json, error } from '@sveltejs/kit';
import db from '$lib/server/db';
import { getSettings } from '$lib/server/auth';
import { appendToSheet } from '$lib/server/sheets';
import { formatCents } from '$lib/calculator';
import type { CalcRow, DistRow } from '$lib/server/db';

export const POST: RequestHandler = async ({ request, locals }) => {
  if (!locals.user) error(401, 'Unauthorized');

  const { calculationId } = await request.json() as { calculationId: number };

  const calc = db.prepare('SELECT * FROM tip_calculations WHERE id = ?').get(calculationId) as CalcRow | undefined;
  if (!calc) error(404, 'Calculation not found');

  const dists = db.prepare(
    'SELECT * FROM tip_distributions WHERE calculation_id = ? ORDER BY role, name'
  ).all(calculationId) as DistRow[];

  const settings = getSettings();

  const spreadsheetId = settings.google_sheets_spreadsheet_id;
  if (!spreadsheetId) error(400, 'Google Sheets not configured. Add a spreadsheet ID in Settings.');

  const credJson = process.env.GOOGLE_SERVICE_ACCOUNT_JSON;
  if (!credJson) error(400, 'GOOGLE_SERVICE_ACCOUNT_JSON env var not set.');

  // Columns: Date, Shift, Type, Calc ID,
  //          Gross Tips, CC Fee Rate, CC Fees, Net Tips,
  //          Kitchen %, Kitchen Pool, Liquor Sales, Bar Liquor %, Bar Pool, FOH Pool,
  //          Name, Role, FOH Share, Bar Share, Kitchen Share, Total

  const summaryRow: (string | number)[] = [
    calc.date, calc.shift, 'summary', calc.id,
    formatCents(calc.gross_tips_cents),
    `${(calc.cc_fee_rate * 100).toFixed(1)}%`,
    formatCents(calc.cc_fees_cents),
    formatCents(calc.tips_after_fees_cents),
    `${(calc.kitchen_pct * 100).toFixed(0)}%`,
    formatCents(calc.kitchen_pool_cents),
    formatCents(calc.liquor_sales_cents),
    `${(calc.bar_liquor_pct * 100).toFixed(0)}%`,
    formatCents(calc.bar_pool_cents),
    formatCents(calc.foh_pool_cents),
    '', '', '', '', '', '',
  ];

  const staffRows: (string | number)[][] = dists.map(d => [
    calc.date, calc.shift, 'staff', calc.id,
    '', '', '', '', '', '', '', '', '', '',
    d.name, d.role,
    formatCents(d.foh_share_cents),
    formatCents(d.bar_pool_share_cents),
    formatCents(d.kitchen_share_cents),
    formatCents(d.total_cents),
  ]);

  try {
    await appendToSheet(
      spreadsheetId,
      settings.google_sheets_sheet_name || 'Tip History',
      [summaryRow, ...staffRows],
      credJson
    );
  } catch (e) {
    const msg = e instanceof Error ? e.message : 'Unknown error';
    error(500, `Sheets export failed: ${msg}`);
  }

  return json({ success: true });
};

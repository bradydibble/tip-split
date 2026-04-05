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

  // Build the row matching PRD OR-8
  const headerRow = [
    'Date', 'Shift', 'Gross Tips', 'CC Fee Rate', 'CC Fees', 'Tips After Fees',
    'Kitchen %', 'Kitchen Pool', 'Liquor Sales', 'Bar Liquor %', 'Bar Pool', 'FOH Pool',
    ...dists.map(d => d.name),
  ];

  const dataRow = [
    calc.date, calc.shift,
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
    ...dists.map(d => formatCents(d.total_cents)),
  ];

  try {
    await appendToSheet(
      spreadsheetId,
      settings.google_sheets_sheet_name || 'Tip History',
      [headerRow, dataRow],
      credJson
    );
  } catch (e) {
    const msg = e instanceof Error ? e.message : 'Unknown error';
    error(500, `Sheets export failed: ${msg}`);
  }

  return json({ success: true });
};

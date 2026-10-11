import type { Actions, PageServerLoad } from './$types';
import { fail } from '@sveltejs/kit';
import { createHash } from 'crypto';
import { mkdirSync, writeFileSync } from 'fs';
import { dirname, join } from 'path';
import db from '$lib/server/db';
import { requireManager } from '$lib/server/auth';
import { syncLaborShifts } from '$lib/server/square/labor-sync';
import {
  getLaborRangeTotals,
  getLaborByDay,
  getLaborByPerson,
} from '$lib/server/labor-report';
import { isValidDateStr, addDays } from '$lib/pay-period';
import { businessDate, DEFAULT_TIMEZONE } from '$lib/business-date';

// Uploads live beside the database file (data/ dir), never in the repo.
const UPLOAD_DIR = process.env.DATABASE_PATH
  ? join(dirname(process.env.DATABASE_PATH), 'labor-imports')
  : './data/labor-imports';

const MAX_UPLOAD_BYTES = 10 * 1024 * 1024;

export const load: PageServerLoad = ({ locals, url }) => {
  requireManager(locals);

  const settings = db.prepare(
    "SELECT value FROM settings WHERE key = 'timezone' AND location_id = 1"
  ).get() as { value: string } | undefined;
  const timeZone = settings?.value || DEFAULT_TIMEZONE;
  const today = businessDate(new Date(), timeZone);

  const startParam = url.searchParams.get('start');
  const endParam = url.searchParams.get('end');
  const rangeValid =
    !!startParam && isValidDateStr(startParam) && !!endParam && isValidDateStr(endParam);
  const start = rangeValid && startParam ? startParam : addDays(today, -6);
  const end = rangeValid && endParam ? endParam : today;

  const totals = getLaborRangeTotals(start, end);
  const byDay = getLaborByDay(start, end);
  const byPerson = getLaborByPerson(start, end);

  const imports = db.prepare(
    'SELECT id, kind, filename, status, row_count, size_bytes, uploaded_at, notes FROM labor_imports ORDER BY uploaded_at DESC LIMIT 50'
  ).all() as {
    id: number; kind: string; filename: string; status: string;
    row_count: number | null; size_bytes: number; uploaded_at: string; notes: string | null;
  }[];

  return { start, end, today, timeZone, totals, byDay, byPerson, imports };
};

export const actions: Actions = {
  sync: async ({ locals, request }) => {
    requireManager(locals);

    const fd = await request.formData();
    const start = String(fd.get('start') ?? '');
    const end = String(fd.get('end') ?? '');
    if (!isValidDateStr(start) || !isValidDateStr(end)) {
      return fail(400, { syncError: 'Valid date range required' });
    }

    const conn = db.prepare(
      'SELECT square_location_id, timezone FROM square_connections LIMIT 1'
    ).get() as { square_location_id: string; timezone: string } | undefined;
    if (!conn) {
      return fail(400, { syncError: 'No Square connection — select a location in Settings → Square first' });
    }

    try {
      // Pad the window by a day each side so midnight-straddling shifts are
      // included by the API's INTERSECTION workday match; attribution uses
      // each shift's own local start date.
      const timeZone = conn.timezone || DEFAULT_TIMEZONE;
      const result = await syncLaborShifts(
        conn.square_location_id,
        timeZone,
        `${addDays(start, -1)}T00:00:00`,
        `${addDays(end, 1)}T23:59:59`,
      );
      return { laborSync: result };
    } catch (e) {
      return fail(500, { syncError: e instanceof Error ? e.message : 'Labor sync failed' });
    }
  },

  saveTax: async ({ locals, request }) => {
    requireManager(locals);

    const fd = await request.formData();
    const pct = parseFloat(String(fd.get('labor_employer_tax_pct') ?? ''));
    if (isNaN(pct) || pct < 0 || pct > 100) {
      return fail(400, { taxError: 'Employer tax % must be between 0 and 100' });
    }

    db.prepare(
      `INSERT INTO settings (key, value) VALUES ('labor_employer_tax_pct', ?)
       ON CONFLICT(key, location_id) DO UPDATE SET value = excluded.value`
    ).run(String(pct));
    return { taxSaved: true };
  },

  upload: async ({ locals, request }) => {
    requireManager(locals);

    const fd = await request.formData();
    const file = fd.get('file');
    if (!(file instanceof File) || file.size === 0) {
      return fail(400, { uploadError: 'Choose a file first' });
    }
    if (file.size > MAX_UPLOAD_BYTES) {
      return fail(400, { uploadError: 'File too large (max 10 MB)' });
    }

    const buf = Buffer.from(await file.arrayBuffer());
    const sha256 = createHash('sha256').update(buf).digest('hex');

    // Sanitize filename: keep basename, strip path separators & unsafe chars
    const safeName = (file.name || 'upload.csv')
      .split('/')
      .pop()!
      .replace(/[^\w.\- ]+/g, '_')
      .slice(0, 120);
    const stamp = new Date().toISOString().replace(/[:.]/g, '-');
    const storedRel = `${stamp}-${safeName}`;

    mkdirSync(UPLOAD_DIR, { recursive: true });
    writeFileSync(join(UPLOAD_DIR, storedRel), buf, { mode: 0o600 });

    // Heuristic kind detection until format-specific parsers exist
    const lower = safeName.toLowerCase();
    const kind = lower.includes('payroll')
      ? 'payroll_report'
      : lower.includes('bank') || lower.includes('checking') || lower.includes('transactions')
        ? 'bank_transactions'
        : lower.includes('tax') || lower.includes('941') || lower.includes('irs')
          ? 'tax_filing'
          : 'unknown';

    db.prepare(`
      INSERT INTO labor_imports (kind, filename, stored_path, sha256, size_bytes, uploaded_by, status, notes)
      VALUES (?, ?, ?, ?, ?, ?, 'pending', ?)
    `).run(
      kind,
      safeName,
      storedRel,
      sha256,
      file.size,
      locals.user!.id,
      'Awaiting parser — totals still use estimates until parsed',
    );

    return { uploaded: safeName, uploadKind: kind };
  },
};

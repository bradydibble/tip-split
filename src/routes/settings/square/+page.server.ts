import type { Actions, PageServerLoad } from './$types';
import { fail } from '@sveltejs/kit';
import db from '$lib/server/db';
import { requireManager, getSettings } from '$lib/server/auth';
import { isSquareConfigured, loadSquareConfig, getLiquorCategoryId, saveSquareToken, clearSquareToken } from '$lib/server/square/config';
import { runCapabilityProbe } from '$lib/server/square/probe';
import { syncRoster, type RosterSyncResult } from '$lib/server/square/roster-sync';
import { syncCatalog, setLiquorRoot, type CatalogSyncResult } from '$lib/server/square/catalog-sync';
import { DEFAULT_TIMEZONE } from '$lib/business-date';
import type { ProbeResult } from '$lib/server/square/probe';
import type { StaffRow } from '$lib/server/db';

export const load: PageServerLoad = ({ locals }) => {
  requireManager(locals);

  const settings = getSettings();
  const lastProbeJson = (db.prepare(
    "SELECT value FROM settings WHERE key = 'square_last_probe_result'"
  ).get() as { value: string } | undefined)?.value ?? null;

  let lastProbe: ProbeResult | null = null;
  if (lastProbeJson) {
    try {
      lastProbe = JSON.parse(lastProbeJson) as ProbeResult;
    } catch {
      lastProbe = null;
    }
  }

  // Show the square_connections row if it exists
  const conn = db.prepare(
    'SELECT * FROM square_connections LIMIT 1'
  ).get() as Record<string, unknown> | undefined;

  // Staff roster sync state
  const squareStaff = db.prepare(
    `SELECT * FROM staff WHERE source = 'square' ORDER BY role_mapping_state, name`
  ).all() as StaffRow[];

  const needsReviewStaff = squareStaff.filter(
    (s) => (s as { role_mapping_state?: string }).role_mapping_state === 'NEEDS_REVIEW'
  );

  return {
    configured: isSquareConfigured(),
    environment: process.env.SQUARE_ENVIRONMENT ?? 'production',
    selectedLocationId: settings.square_selected_location_id || '',
    apiVersion: settings.square_api_version ?? '2024-12-18',
    liquorCategoryId: getLiquorCategoryId(),
    lastProbe,
    connection: conn ?? null,
    squareStaff,
    needsReviewCount: needsReviewStaff.length,
  };
};

export const actions: Actions = {
  probe: async ({ locals }) => {
    requireManager(locals);

    try {
      const result = await runCapabilityProbe();

      // Persist the probe result (redacted — only statuses, counts, IDs)
      db.prepare(
        `INSERT INTO settings (key, value) VALUES ('square_last_probe_result', ?)
         ON CONFLICT(key, location_id) DO UPDATE SET value = excluded.value`
      ).run(JSON.stringify(result));

      // If a single location was discovered and none is selected, we DON'T
      // auto-select — the manager must explicitly confirm.
      return { probe: result };
    } catch (e) {
      return fail(500, {
        probeError: e instanceof Error ? e.message : 'Capability probe failed',
      });
    }
  },

  selectLocation: async ({ request, locals }) => {
    requireManager(locals);

    const fd = await request.formData();
    const locationId = String(fd.get('location_id') ?? '').trim();
    const locationName = String(fd.get('location_name') ?? '').trim();
    const timezone = String(fd.get('timezone') ?? DEFAULT_TIMEZONE).trim();
    const merchantId = String(fd.get('merchant_id') ?? '').trim();
    const merchantName = String(fd.get('merchant_name') ?? '').trim();
    const currency = String(fd.get('currency') ?? 'USD').trim();
    const weeklyHoursJson = String(fd.get('weekly_hours_json') ?? '').trim();

    if (!locationId) return fail(400, { error: 'Location ID is required' });

    const upsertSetting = db.prepare(
      `INSERT INTO settings (key, value) VALUES (?, ?)
       ON CONFLICT(key, location_id) DO UPDATE SET value = excluded.value`
    );

    db.transaction(() => {
      // Persist the immutable location ID (never display name) in settings
      upsertSetting.run('square_selected_location_id', locationId);
      // Persist the location timezone for business-date calculations
      upsertSetting.run('timezone', timezone);

      // Persist or update the square_connections row
      db.prepare(`
        INSERT INTO square_connections
          (location_id, merchant_id, merchant_name, square_location_id,
           square_location_name, timezone, currency, api_version,
           weekly_hours_json, last_validation_at, last_validation_ok, updated_at)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, datetime('now'), 1, datetime('now'))
        ON CONFLICT(location_id) DO UPDATE SET
          merchant_id = excluded.merchant_id,
          merchant_name = excluded.merchant_name,
          square_location_id = excluded.square_location_id,
          square_location_name = excluded.square_location_name,
          timezone = excluded.timezone,
          currency = excluded.currency,
          api_version = excluded.api_version,
          weekly_hours_json = excluded.weekly_hours_json,
          last_validation_at = datetime('now'),
          last_validation_ok = 1,
          updated_at = datetime('now')
      `).run(
        locationId,
        merchantId || '',
        merchantName || null,
        locationId,
        locationName || null,
        timezone,
        currency,
        loadSquareConfig().apiVersion,
        weeklyHoursJson || null,
      );
    })();

    return { selected: locationId };
  },

  clearLocation: async ({ locals }) => {
    requireManager(locals);

    db.transaction(() => {
      db.prepare(
        `UPDATE settings SET value = '' WHERE key = 'square_selected_location_id'`
      ).run();
      db.prepare(`DELETE FROM square_connections`).run();
    })();

    return { cleared: true };
  },

  syncRoster: async ({ locals }) => {
    requireManager(locals);

    const settings = getSettings();
    const locationId = settings.square_selected_location_id;
    if (!locationId) {
      return fail(400, { rosterError: 'Select a Square location before syncing the roster.' });
    }

    try {
      const result: RosterSyncResult = await syncRoster(locationId);

      // Update the last roster sync timestamp on the connection
      db.prepare(`
        UPDATE square_connections SET last_roster_sync_at = datetime('now'), updated_at = datetime('now')
        WHERE square_location_id = ?
      `).run(locationId);

      return { rosterSync: result };
    } catch (e) {
      return fail(500, {
        rosterError: e instanceof Error ? e.message : 'Roster sync failed',
      });
    }
  },

  syncCatalog: async ({ locals }) => {
    requireManager(locals);

    try {
      const result: CatalogSyncResult = await syncCatalog();
      return { catalogSync: {
        categoryCount: result.categoryCount,
        itemCount: result.itemCount,
        variationCount: result.variationCount,
        categories: result.categories,
        autoDetectedLiquorCategoryId: result.autoDetectedLiquorCategoryId,
        autoDetectedLiquorCategoryName: result.autoDetectedLiquorCategoryName,
      }};
    } catch (e) {
      return fail(500, {
        catalogError: e instanceof Error ? e.message : 'Catalog sync failed',
      });
    }
  },

  selectLiquorCategory: async ({ request, locals }) => {
    requireManager(locals);

    const fd = await request.formData();
    const categoryId = String(fd.get('category_id') ?? '').trim();

    if (!categoryId) return fail(400, { liquorError: 'Category ID is required' });

    setLiquorRoot(categoryId);
    return { liquorCategorySelected: categoryId };
  },

  updateToken: async ({ request, locals }) => {
    requireManager(locals);

    const fd = await request.formData();
    const token = String(fd.get('square_token') ?? '').trim();

    if (!token) {
      // Empty submit = clear the token
      clearSquareToken();
      return { tokenCleared: true };
    }

    // Basic validation: Square tokens start with "sq0" or "EAAA"
    if (!token.match(/^(sq0|EAAA|sq1)/)) {
      return fail(400, { tokenError: 'Token does not look like a valid Square access token' });
    }

    saveSquareToken(token);
    return { tokenSaved: true };
  },
};

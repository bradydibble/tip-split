// ============================================================================
// ***  READ-ONLY SQUARE INTEGRATION — NO WRITES, EVER.  ***
//
//  This module loads the Square access token. The token grants API access to
//  the connected production Square account. Under NO CIRCUMSTANCES may this
//  token be used to create, update, delete, or modify ANY data on the Square
//  account. Writing to Square requires the operator's explicit written approval.
//
//  The token is server-only: never bundled to the browser, never logged,
//  never put in form values or test fixtures.
// ============================================================================
//

// Square read-only configuration (server-only).
//
// Loads the Square access token, API version, and selected location from
// environment variables and/or the settings table. The access token NEVER
// enters browser bundles, logs, form values, or test fixtures.
//
// For local development on macOS (or anywhere without production creds),
// the token is optional. The app remains fully usable with manual entry.
// When SQUARE_ACCESS_TOKEN is unset, isConfigured() returns false and all
// Square-dependent features gracefully degrade.

import db from '../db';
import { DEFAULT_TIMEZONE } from '../../business-date';
import { readFileSync, writeFileSync, mkdirSync } from 'fs';
import { dirname, join } from 'path';

/** Path to the gitignored token file (stored inside the data dir). */
const TOKEN_FILE_PATH = process.env.DATABASE_PATH
  ? join(dirname(process.env.DATABASE_PATH), '.square-token')
  : './data/.square-token';

export interface SquareConfig {
  /** Whether a Square access token is available server-side. */
  configured: boolean;
  /** The access token, or null if unconfigured. Never log this. */
  accessToken: string | null;
  /** Pinned Square API version (YYYY-MM-DD). */
  apiVersion: string;
  /** The selected Square location ID (immutable, never display name). */
  locationId: string | null;
  /** Configured IANA timezone for the selected location. */
  timezone: string;
  /** "mock" uses fixtures; "production" hits live Square. */
  environment: 'production' | 'mock';
}

/**
 * Load Square configuration. Token precedence:
 *   1. process.env.SQUARE_ACCESS_TOKEN (env / .env file)
 *   2. data/.square-token file (written by the settings UI — gitignored)
 *   3. Empty → configured=false
 *
 * The token is never stored in the database, never rendered in forms,
 * never logged. The file fallback exists so a manager can update the token
 * from the settings UI without SSHing in.
 */
export function loadSquareConfig(): SquareConfig {
  const envToken = process.env.SQUARE_ACCESS_TOKEN ?? '';

  let token = envToken.trim();
  if (!token) {
    // Fall back to file-based token
    try {
      token = readFileSync(TOKEN_FILE_PATH, 'utf8').trim();
    } catch {
      token = '';
    }
  }

  const rows = db.prepare(
    "SELECT key, value FROM settings WHERE key IN ('square_api_version','square_selected_location_id','timezone')"
  ).all() as { key: string; value: string }[];

  const settingsMap = Object.fromEntries(rows.map((r) => [r.key, r.value]));

  const apiVersion = settingsMap.square_api_version ?? '2024-12-18';
  const locationId = settingsMap.square_selected_location_id || null;
  const timezone = settingsMap.timezone || DEFAULT_TIMEZONE;

  return {
    configured: !!token,
    accessToken: token || null,
    apiVersion,
    locationId,
    timezone,
    environment: (process.env.SQUARE_ENVIRONMENT as 'production' | 'mock') ?? 'production',
  };
}

/**
 * True if a Square token is available (env or file). Used by route loaders
 * to decide whether to surface Square-related UI elements.
 */
export function isSquareConfigured(): boolean {
  if ((process.env.SQUARE_ACCESS_TOKEN ?? '').trim()) return true;
  try {
    return !!readFileSync(TOKEN_FILE_PATH, 'utf8').trim();
  } catch {
    return false;
  }
}

/**
 * Save a Square access token to the gitignored file. Used by the settings
 * UI so a manager can update the token without SSHing in. The token is
 * never stored in the database and never rendered back to the browser.
 */
export function saveSquareToken(token: string): void {
  const trimmed = token.trim();
  mkdirSync(dirname(TOKEN_FILE_PATH), { recursive: true });
  writeFileSync(TOKEN_FILE_PATH, trimmed, { mode: 0o600 });
}

/** Remove the stored token file. */
export function clearSquareToken(): void {
  try {
    writeFileSync(TOKEN_FILE_PATH, '', { mode: 0o600 });
  } catch {
    // file doesn't exist — fine
  }
}

/**
 * Persist manager-selected location ID and timezone to settings. The
 * location ID is the immutable Square identifier, never the display name.
 */
export function saveSquareLocation(locationId: string, timezone: string): void {
  const upsert = db.prepare(
    `INSERT INTO settings (key, value) VALUES (?, ?)
     ON CONFLICT(key, location_id) DO UPDATE SET value = excluded.value`
  );
  db.transaction(() => {
    upsert.run('square_selected_location_id', locationId);
    upsert.run('timezone', timezone);
  })();
}

/**
 * Persist the selected liquor root category ID (immutable).
 */
export function saveLiquorCategoryId(categoryId: string): void {
  db.prepare(
    `INSERT INTO settings (key, value) VALUES ('square_liquor_category_id', ?)
     ON CONFLICT(key, location_id) DO UPDATE SET value = excluded.value`
  ).run(categoryId);
}

/**
 * Get the configured liquor root category ID, if any.
 */
export function getLiquorCategoryId(): string | null {
  const row = db.prepare(
    "SELECT value FROM settings WHERE key = 'square_liquor_category_id'"
  ).get() as { value: string } | undefined;
  return row?.value || null;
}

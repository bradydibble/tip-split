// ============================================================================
// ***  READ-ONLY SQUARE MODULE — NO WRITES TO THE SQUARE ACCOUNT, EVER.  ***
//  Writing to Square (create/update/delete/modify) is FORBIDDEN without
//  the operator's explicit written approval. This module may only FETCH data.
// ============================================================================
//
// Square read-only capability probe.
//
// Runs the minimum set of read-only Square API calls needed to validate
// that the merchant account, required scopes, and location are reachable.
// Records only: endpoint, status, request ID, counts, page count.
// Never logs names, payment details, access tokens, or response bodies.
//
// Error classification (important — a failure is NOT automatically a scope
// problem):
//   - SquareApiError with HTTP 403 → 'missing_scope' (genuinely ungranted)
//   - SquareApiError with any other status → 'error' (bad request format,
//     server error, etc. — shown with the real message + request ID)
//   - Anything else → 'error' (network/timeout/client bug)

import {
  getMerchantMe,
  listLocations,
  searchTeamMembers,
  listPayments,
  searchOrders,
  listCatalog,
  SquareApiError,
} from './client';
import { loadSquareConfig } from './config';
import { TEST_LOCATION_ID } from './fixtures';

export type ProbeStatus = 'ok' | 'missing_scope' | 'error' | 'skipped';

export interface ProbeEndpointResult {
  /** Human-readable label for the probe step. */
  label: string;
  /** The read-only endpoint that was tested. */
  endpoint: string;
  /** Required OAuth permission. */
  requiredScope: string;
  /** Outcome of the probe call. */
  status: ProbeStatus;
  /** Count of records returned (redacted — no individual data). */
  recordCount: number;
  /** Square request ID for traceability. */
  requestId: string | null;
  /** Error summary if status !== 'ok' (no sensitive data). */
  error?: string;
}

export interface ProbeResult {
  /** Per-endpoint outcomes. */
  endpoints: ProbeEndpointResult[];
  /** Discovered locations (ID, name, timezone, status only). */
  locations: { id: string; name: string; timezone: string; status?: string }[];
  /** Missing scope names detected (403s only), if any. */
  missingScopes: string[];
  /** Whether the overall probe succeeded. */
  overall: 'pass' | 'partial' | 'fail';
  /** ISO timestamp of the probe. */
  probedAt: string;
  /** Whether the probe ran in mock mode. */
  mockMode: boolean;
}

/**
 * Classify a probe failure from the thrown error. Only a Square 403 means
 * the scope is actually missing; anything else is a different problem and
 * must be reported with its real cause so we don't chase phantom scope
 * errors (which is exactly what happened with the merchant envelope bug).
 */
function classifyFailure(
  e: unknown,
): { status: 'missing_scope' | 'error'; error: string; requestId: string | null } {
  if (e instanceof SquareApiError) {
    const summary = e.statusCode === 403
      ? `403 Forbidden — scope not granted (${e.message})`
      : `${e.statusCode} — ${e.message}`;
    return {
      status: e.statusCode === 403 ? 'missing_scope' : 'error',
      error: summary,
      requestId: e.requestId,
    };
  }
  return {
    status: 'error',
    error: e instanceof Error ? e.message : 'unknown error',
    requestId: null,
  };
}

/**
 * Run one probe step and push its result.
 */
async function probeStep(
  endpoints: ProbeEndpointResult[],
  missingScopes: string[],
  label: string,
  endpoint: string,
  requiredScope: string,
  fn: () => Promise<{ count: number }>,
): Promise<void> {
  try {
    const { count } = await fn();
    endpoints.push({
      label, endpoint, requiredScope,
      status: 'ok',
      recordCount: count,
      requestId: null,
    });
  } catch (e) {
    const cls = classifyFailure(e);
    endpoints.push({
      label, endpoint, requiredScope,
      status: cls.status,
      recordCount: 0,
      requestId: cls.requestId,
      error: cls.error,
    });
    if (cls.status === 'missing_scope') missingScopes.push(requiredScope);
  }
}

/**
 * Run the capability probe. Each step is wrapped so that a failure in one
 * endpoint does not abort the rest — we want to know exactly which scopes
 * are missing (403s) versus which calls fail for other reasons.
 */
export async function runCapabilityProbe(): Promise<ProbeResult> {
  const config = loadSquareConfig();
  const endpoints: ProbeEndpointResult[] = [];
  const missingScopes: string[] = [];

  // Step 1: Merchant (MERCHANT_PROFILE_READ)
  await probeStep(endpoints, missingScopes, 'Validate merchant', 'GET /v2/merchants/me', 'MERCHANT_PROFILE_READ', async () => {
    await getMerchantMe();
    return { count: 1 };
  });

  // Step 2: Locations (MERCHANT_PROFILE_READ)
  let locationId = config.locationId;
  let locationInfo: { id: string; name: string; timezone: string }[] = [];
  await probeStep(endpoints, missingScopes, 'Enumerate locations', 'GET /v2/locations', 'MERCHANT_PROFILE_READ', async () => {
    const { locations } = await listLocations();
    locationInfo = locations.map((l) => ({ id: l.id, name: l.name, timezone: l.timezone, status: l.status }));
    // Suggest the first ACTIVE location if none is configured (manager still
    // must confirm — this is only a probe-time default, never persisted)
    if (!locationId && locations.length > 0) {
      locationId = locations.find((l) => l.status !== 'INACTIVE')?.id ?? locations[0].id;
    }
    return { count: locations.length };
  });

  const locId = locationId ?? TEST_LOCATION_ID;
  const now = new Date();
  const start = new Date(now.getTime() - 24 * 60 * 60 * 1000);

  // Step 3: Team members (EMPLOYEES_READ)
  await probeStep(endpoints, missingScopes, 'Active staff roster', 'POST /v2/team-members/search', 'EMPLOYEES_READ', async () => {
    const { team_members } = await searchTeamMembers(locId);
    return { count: team_members.length };
  });

  // Step 4: Payments (PAYMENTS_READ)
  await probeStep(endpoints, missingScopes, 'Read payments (tip_money)', 'GET /v2/payments', 'PAYMENTS_READ', async () => {
    const { payments } = await listPayments(locId, start.toISOString(), now.toISOString());
    return { count: payments.length };
  });

  // Step 5: Orders (ORDERS_READ)
  await probeStep(endpoints, missingScopes, 'Search orders (liquor classification)', 'POST /v2/orders/search', 'ORDERS_READ', async () => {
    const { orders } = await searchOrders(locId, start.toISOString(), now.toISOString());
    return { count: orders.length };
  });

  // Step 6: Catalog (ITEMS_READ)
  await probeStep(endpoints, missingScopes, 'Read catalog categories/items', 'GET /v2/catalog/list', 'ITEMS_READ', async () => {
    const { objects } = await listCatalog();
    return { count: objects.length };
  });

  const anyOk = endpoints.some((e) => e.status === 'ok');
  const anyBad = endpoints.some((e) => e.status !== 'ok');
  const overall = !anyBad ? 'pass' : anyOk ? 'partial' : 'fail';

  return {
    endpoints,
    locations: locationInfo,
    missingScopes,
    overall,
    probedAt: new Date().toISOString(),
    mockMode: config.environment === 'mock' || !config.configured,
  };
}

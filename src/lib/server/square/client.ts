// ┌─────────────────────────────────────────────────────────────────────────┐
// │                                                                         │
// │   ██████╗ ██╗   ██╗██████╗  ██████╗ ██████╗ ███████╗██████╗  ███████╗███████╗│
// │   ██╔══██╗██║   ██║██╔══██╗██╔═══██╗██╔══██╗██╔════╝██╔══██╗██╔════╝██╔════╝│
// │   ██████╔╝██║   ██║██████╔╝██║   ██║██████╔╝█████╗  ██████╔╝███████╗█████╗  │
// │   ██╔═══╝ ██║   ██║██╔══██╗██║   ██║██╔══██╗██╔══╝  ██╔═══╝ ██╔════╝██╔══╝  │
// │   ██║     ╚██████╔╝██████╔╝╚██████╔╝██║  ██║███████╗██║     ███████╗███████╗│
// │   ╚═╝      ╚═════╝ ╚═════╝  ╚═════╝ ╚═╝  ╚═╝╚══════╝╚═╝     ╚══════╝╚══════╝│
// │                                                                         │
// │   THIS CLIENT IS STRICTLY READ-ONLY.                                    │
// │                                                                         │
// │   NO WRITE OPERATIONS ARE PERMITTED AGAINST THE SQUARE ACCOUNT.         │
// │   EVER.  UNDER ANY CIRCUMSTANCES.                                       │
// │                                                                         │
// │   Do NOT call any Square endpoint that creates, updates, deletes,       │
// │   publishes, subscribes, or modifies data on a connected production    │
// │   Square account. This includes (but is not limited to):                │
// │                                                                         │
// │     POST   /v2/team-members                      (create)               │
// │     PUT    /v2/team-members/{team_member_id}     (update)               │
// │     POST   /v2/labor/shifts                      (create shift)         │
// │     PUT    /v2/labor/shifts/{id}                 (update shift)         │
// │     POST   /v2/orders                           (create order)         │
// │     POST   /v2/payments/{id}/complete           (complete payment)      │
// │     POST   /v2/catalog/object                   (create catalog item)   │
// │     PUT    /v2/catalog/object                    (update catalog item)  │
// │     POST   /v2/webhook_subscriptions             (subscribe webhook)    │
// │     DELETE /v2/anything                          (delete anything)      │
// │                                                                         │
// │   Adding such a call REQUIRES the operator's explicit written approval.        │
// │   The read-only allowlist below enforces this at runtime — any HTTP      │
// │   request whose method+path is NOT in the allowlist will THROW and       │
// │   ABORT the operation before any network call is made.                  │
// │                                                                         │
// │   This is a HARD GUARD, not a suggestion.                                │
// │                                                                         │
// └─────────────────────────────────────────────────────────────────────────┘

// Server-only Square API client.
//
// Design goals from the spec:
//   - Read-only: only GET and POST-search endpoints. No create/update/delete.
//   - Pins an API version in every request header.
//   - Paginates every list/search endpoint with cursor semantics.
//   - Bounded exponential backoff with rate-limit handling.
//   - Redacted logging: request IDs, operation names, counts, durations, and
//     error codes — never bearer tokens, customer data, or response bodies.
//   - Mock mode: when SQUARE_ACCESS_TOKEN is unset or SQUARE_ENVIRONMENT=mock,
//     a fake transport serves from the redacted fixtures so local development
//         and tests never touch production Square.

import type { SquareConfig } from './config';
import { loadSquareConfig } from './config';
import {
  buildLocationsResponse,
  buildMerchantsMeResponse,
  buildTeamMembersResponse,
  buildScheduledShiftsResponse,
  buildWorkedShiftsResponse,
  buildWorkweekConfigsResponse,
  buildPaymentsResponse,
  buildOrdersResponse,
  buildCatalogResponse,
  TEST_LOCATION_ID,
  type SquareTeamMember,
  type SquareLocation,
  type SquareScheduledShift,
  type SquareWorkedShift,
  type SquarePayment,
  type SquareOrder,
  type SquareCatalogObject,
} from './fixtures';

// ── Types ────────────────────────────────────────────────────────────────────

export type HttpMethod = 'GET' | 'POST';

export interface RequestOptions {
  method: HttpMethod;
  path: string;
  body?: unknown;
  /** Stable identifier for the log line (never the URL with params). */
  operation: string;
  /** Cursor field name for pagination extraction. */
  cursorField?: string;
  /** Envelope field name that holds the array of results. */
  envelopeField: string;
  /** Max pages to prevent runaway loops. */
  maxPages?: number;
  /** Override the default query/filter inside the body (for POST search). */
  queryBody?: Record<string, unknown>;
}

export interface PaginatedResult<T> {
  results: T[];
  totalPages: number;
  requestId: string | null;
}

// ── Constants ────────────────────────────────────────────────────────────────

const DEFAULT_MAX_PAGES = 50;
const TIMEOUT_MS = 15_000;
const MAX_RETRIES = 3;
const BACKOFF_BASE_MS = 500;

// ── Custom errors ─────────────────────────────────────────────────────────────

export class SquareApiError extends Error {
  constructor(
    public operation: string,
    public statusCode: number,
    message: string,
    public requestId: string | null,
  ) {
    super(`[${operation}] ${statusCode}: ${message}`);
    this.name = 'SquareApiError';
  }
}

/**
 * Thrown when an HTTP request attempts to reach a Square endpoint that is NOT
 * on the read-only allowlist. This is a HARD BLOCK — the request never goes
 * to the wire. This error means someone tried to write to the Square account,
 * which is forbidden without the operator's explicit written approval.
 */
export class SquareWriteGuardError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'SquareWriteGuardError';
  }
}

// ── Mock transport ────────────────────────────────────────────────────────────

interface MockState {
  teamMembersOverride?: typeof buildTeamMembersResponse;
}

const mockState: MockState = {};

/** Replace the fixture-generated team members (for test injection). */
export function __setMockTeamMembers(fn: typeof buildTeamMembersResponse): void {
  mockState.teamMembersOverride = fn;
}
/** Reset mock overrides (call in test afterEach). */
export function __resetMockOverrides(): void {
  mockState.teamMembersOverride = undefined;
}

/**
 * Fake transport that resolves from redacted fixtures. Simulates latency
 * and pagination cursors. Never makes a network call.
 */
async function mockTransport(
  req: RequestOptions,
  _cursor: string | null,
): Promise<{ json: unknown; requestId: string }> {
  // Simulate small async delay
  await new Promise((r) => setTimeout(r, 5));

  const requestId = `mock-req-${Math.random().toString(36).slice(2, 10)}`;

  switch (req.operation) {
    case 'GetMerchant': {
      // Wraps the single merchant object in an array so the pagination
      // engine can treat it uniformly.
      const resp = buildMerchantsMeResponse();
      return { json: { merchant: [resp.merchant] }, requestId };
    }

    case 'ListLocations':
      return { json: buildLocationsResponse(), requestId };

    case 'SearchTeamMembers': {
      const resp = mockState.teamMembersOverride
        ? mockState.teamMembersOverride()
        : buildTeamMembersResponse();
      return { json: resp, requestId };
    }

    case 'SearchScheduledShifts': {
      // Extract the business date from the real filter shape:
      // query.filter.start.start_at = "YYYY-MM-DDTHH:MM:SS±HH:MM"
      const shiftQuery = req.queryBody as {
        query?: { filter?: { start?: { start_at?: string } } };
      };
      const bd = shiftQuery?.query?.filter?.start?.start_at?.slice(0, 10) ?? '2026-08-27';
      return {
        json: buildScheduledShiftsResponse(bd),
        requestId,
      };
    }

    case 'ListPayments': {
      const w = (req.queryBody?.location_id === TEST_LOCATION_ID ? 'lunch' : 'lunch');
      const resp = buildPaymentsResponse(w as 'lunch' | 'dinner');
      return { json: resp, requestId };
    }

    case 'SearchOrders': {
      const w = (req.queryBody as { window?: 'lunch' | 'dinner' })?.window ?? 'lunch';
      return { json: buildOrdersResponse(w), requestId };
    }

    case 'ListCatalog':
      return { json: buildCatalogResponse(), requestId };

    case 'SearchWorkedShifts': {
      // Body carries the workday date range; extract the business date.
      const wb = req.queryBody as {
        query?: { filter?: { workday?: { date_range?: { start_at?: string } } } };
      };
      const bd = wb?.query?.filter?.workday?.date_range?.start_at?.slice(0, 10) ?? '2026-08-27';
      return { json: buildWorkedShiftsResponse(bd), requestId };
    }

    case 'ListWorkweekConfigs':
      return { json: buildWorkweekConfigsResponse(), requestId };

    default:
      return {
        json: { error: `Mock: unknown operation ${req.operation}` },
        requestId,
      };
  }
}

// ── Real HTTP transport ──────────────────────────────────────────────────────

async function httpTransport(
  config: SquareConfig,
  req: RequestOptions,
  cursor: string | null,
): Promise<{ json: unknown; requestId: string }> {
  // ── HARD GUARD: enforce read-only allowlist before any network call. ──
  // This runs BEFORE fetch() so a disallowed endpoint never reaches the wire.
  // If you hit this guard, you are trying to WRITE to Square — STOP.
  // Adding an endpoint here REQUIRES the operator's explicit written approval.
  if (!assertReadOnlyEndpoint(req.method, req.path)) {
    throw new SquareWriteGuardError(
      `BLOCKED: ${req.method} ${req.path} is not on the read-only allowlist. ` +
      `Writing to the Square account is FORBIDDEN without explicit approval.`,
    );
  }

  const url = `https://connect.squareup.com${req.path}`;
  const headers: Record<string, string> = {
    Authorization: `Bearer ${config.accessToken}`,
    'Square-Version': config.apiVersion,
    'Content-Type': 'application/json',
  };

  // Merge cursor into body for POST, into query string for GET
  let body: string | undefined;
  let finalUrl = url;

  if (req.method === 'POST') {
    const payload = { ...req.queryBody };
    if (cursor && req.cursorField) {
      (payload as Record<string, unknown>)[req.cursorField] = cursor;
    }
    body = JSON.stringify(payload);
  } else {
    if (cursor && req.cursorField) {
      const sep = finalUrl.includes('?') ? '&' : '?';
      finalUrl = `${finalUrl}${sep}${req.cursorField}=${encodeURIComponent(cursor)}`;
    }
  }

  let lastError: Error | null = null;

  for (let attempt = 0; attempt <= MAX_RETRIES; attempt++) {
    if (attempt > 0) {
      const backoff = BACKOFF_BASE_MS * Math.pow(2, attempt - 1);
      await new Promise((r) => setTimeout(r, backoff));
    }

    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), TIMEOUT_MS);

    try {
      const res = await fetch(finalUrl, {
        method: req.method,
        headers,
        body,
        signal: controller.signal,
      });

      clearTimeout(timer);

      const requestId = res.headers.get('x-request-id') ?? null;

      if (res.status === 429) {
        // Rate limited — retry with backoff
        lastError = new Error('Rate limited (429)');
        continue;
      }

      if (res.status >= 500) {
        lastError = new Error(`Square server error (${res.status})`);
        continue;
      }

      if (!res.ok) {
        const errBody = await res.json().catch(() => ({}));
        const errMsg = (errBody as { errors?: { detail?: string }[] })?.errors?.[0]?.detail ?? res.statusText;
        throw new SquareApiError(req.operation, res.status, errMsg, requestId);
      }

      const json = await res.json();
      return { json, requestId: requestId ?? 'unknown' };
    } catch (e) {
      clearTimeout(timer);
      if (e instanceof SquareApiError) throw e;
      lastError = e as Error;
      // Retry on network/timeout errors
      if (attempt < MAX_RETRIES) continue;
    }
  }

  throw new SquareApiError(
    req.operation,
    0,
    `Network error after ${MAX_RETRIES} retries: ${lastError?.message ?? 'unknown'}`,
    null,
  );
}

// ── Pagination engine ────────────────────────────────────────────────────────

/**
 * Execute a paginated Square request. Follows cursor pagination to collect
 * all pages, with a hard ceiling on page count. Logs only redacted metadata:
 * operation, status, request IDs, counts, page count, duration — never
 * bodies, tokens, or customer data.
 */
export async function paginatedRequest<T>(
  req: RequestOptions,
): Promise<PaginatedResult<T>> {
  const config = loadSquareConfig();
  const maxPages = req.maxPages ?? DEFAULT_MAX_PAGES;
  const results: T[] = [];
  let cursor: string | null = null;
  let totalPages = 0;
  let lastRequestId: string | null = null;
  const startTime = Date.now();

  for (let page = 0; page < maxPages; page++) {
    const useMock = !config.configured || config.environment === 'mock' ||
      process.env.SQUARE_ENVIRONMENT === 'mock';

    const { json, requestId } = useMock
      ? await mockTransport(req, cursor)
      : await httpTransport(config, req, cursor);

    lastRequestId = requestId;
    totalPages++;

    const envelope = json as Record<string, unknown>;
    // Normalize the envelope: most endpoints return an array, but single-object
    // endpoints (e.g. /v2/merchants/me) return the object directly. Wrapping a
    // non-array keeps the spread below valid for both shapes.
    const raw = envelope[req.envelopeField];
    const items: T[] = Array.isArray(raw) ? raw : (raw != null ? [raw as T] : []);
    results.push(...items);

    // Extract next cursor
    cursor = null;
    if (req.cursorField && envelope[req.cursorField]) {
      cursor = envelope[req.cursorField] as string;
    }

    if (!cursor) break;
  }

  // Redacted log: operation, count, pages, duration — nothing else.
  console.log(
    `[square] ${req.operation}: ${results.length} records, ${totalPages} page(s), ${Date.now() - startTime}ms`,
  );

  return { results, totalPages, requestId: lastRequestId };
}

// ── Endpoint wrappers (read-only allowlist) ──────────────────────────────────
//
// Every wrapper here corresponds to a read-only Square endpoint from the
// spec's table. None call create, update, delete, publish, or webhook APIs.

export async function getMerchantMe(): Promise<{
  merchant: { id: string; country: string; currency: string; business_name: string };
}> {
  const { results } = await paginatedRequest<{ id: string; country: string; currency: string; business_name: string }>({
    method: 'GET',
    path: '/v2/merchants/me',
    operation: 'GetMerchant',
    envelopeField: 'merchant',
    maxPages: 1,
  });
  return { merchant: results[0] };
}

export async function listLocations(): Promise<{ locations: SquareLocation[] }> {
  const { results } = await paginatedRequest<SquareLocation>({
    method: 'GET',
    path: '/v2/locations',
    operation: 'ListLocations',
    envelopeField: 'locations',
  });
  return { locations: results };
}

export async function searchTeamMembers(
  locationId: string,
): Promise<{ team_members: SquareTeamMember[] }> {
  const { results } = await paginatedRequest<SquareTeamMember>({
    method: 'POST',
    path: '/v2/team-members/search',
    operation: 'SearchTeamMembers',
    envelopeField: 'team_members',
    cursorField: 'cursor',
    queryBody: {
      limit: 100,
      query: {
        filter: {
          location_ids: [locationId],
          status: 'ACTIVE',
        },
      },
    },
  });
  // Client-side filter to ACTIVE + location (defense in depth).
  // Some members have assignment_type ALL_CURRENT_AND_FUTURE_LOCATIONS,
  // meaning they're at every location implicitly.
  const filtered = results.filter(
    (tm) => {
      if (tm.status !== 'ACTIVE') return false;
      const al = tm.assigned_locations;
      if (!al) return false;
      if (al.assignment_type === 'ALL_CURRENT_AND_FUTURE_LOCATIONS') return true;
      return al.location_ids?.includes(locationId);
    },
  );
  return { team_members: filtered };
}

export async function searchScheduledShifts(
  locationId: string,
  startOfDayUtc: string,
  endOfDayUtc: string,
): Promise<{ scheduled_shifts: SquareScheduledShift[] }> {
  const { results } = await paginatedRequest<SquareScheduledShift>({
    method: 'POST',
    path: '/v2/labor/scheduled-shifts/search',
    operation: 'SearchScheduledShifts',
    envelopeField: 'scheduled_shifts',
    cursorField: 'cursor',
    // Real Beta filter shape (verified against production):
    //   location_ids (plural array), scheduled_shift_statuses, start: TimeRange
    queryBody: {
      limit: 50, // Beta caps page size — 100+ returns zero
      query: {
        filter: {
          location_ids: [locationId],
          scheduled_shift_statuses: ['PUBLISHED'],
          assignment_status: 'ASSIGNED',
          start: { start_at: startOfDayUtc, end_at: endOfDayUtc },
        },
      },
    },
  });
  // Defense in depth: keep only published, assigned, at this location,
  // starting inside the window (Beta filter is trusted but re-verified).
  const filtered = results.filter((s) => {
    const p = s.published_shift_details;
    if (!p || p.is_deleted) return false;
    if (p.location_id !== locationId) return false;
    if (!p.team_member_id) return false;
    const t = new Date(p.start_at).getTime();
    return t >= new Date(startOfDayUtc).getTime() && t < new Date(endOfDayUtc).getTime();
  });
  return { scheduled_shifts: filtered };
}

/**
 * Search ACTUAL worked shifts (clock in/out) for a date range at a location.
 * Source of labor hours + the wage rate charged per shift. Read-only search.
 *
 * The workday filter uses INTERSECTION so shifts straddling midnight land in
 * both days' results for the queried range; the business_date attribution
 * happens downstream from the shift's own start time.
 */
export async function searchWorkedShifts(
  locationId: string,
  timeZone: string,
  startAt: string,
  endAt: string,
): Promise<{ shifts: SquareWorkedShift[] }> {
  const { results } = await paginatedRequest<SquareWorkedShift>({
    method: 'POST',
    path: '/v2/labor/shifts/search',
    operation: 'SearchWorkedShifts',
    envelopeField: 'shifts',
    cursorField: 'cursor',
    queryBody: {
      limit: 100,
      query: {
        filter: {
          location_ids: [locationId],
          workday: {
            date_range: { start_at: startAt, end_at: endAt },
            match_shifts: 'INTERSECTION',
            default_timezone: timeZone,
          },
        },
      },
    },
  });
  // Defense in depth: same location, shift overlaps the range.
  const s = new Date(startAt).getTime();
  const e = new Date(endAt).getTime();
  const filtered = results.filter((sh) => {
    if (sh.location_id !== locationId) return false;
    if (!sh.team_member_id) return false;
    const st = new Date(sh.start_at).getTime();
    const en = sh.end_at ? new Date(sh.end_at).getTime() : Date.now();
    return st < e && en > s;
  });
  return { shifts: filtered };
}

/**
 * List workweek configurations — the overtime week definition (start day
 * and local cutoff). Determines how hours bucket into weeks for OT premium.
 * Read-only list endpoint under TIMECARDS_READ.
 */
export async function listWorkweekConfigs(): Promise<{
  workweek_configs: { id: string; start_of_week: string; start_of_day_local_time: string; version: number }[];
}> {
  const { results } = await paginatedRequest<{
    id: string; start_of_week: string; start_of_day_local_time: string; version: number;
  }>({
    method: 'GET',
    path: '/v2/labor/workweek-configs',
    operation: 'ListWorkweekConfigs',
    envelopeField: 'workweek_configs',
    cursorField: 'cursor',
    queryBody: {},
  });
  return { workweek_configs: results };
}

export async function listPayments(
  locationId: string,
  beginTime: string,
  endTime: string,
): Promise<{ payments: SquarePayment[] }> {
  const { results } = await paginatedRequest<SquarePayment>({
    method: 'GET',
    path: `/v2/payments?location_id=${encodeURIComponent(locationId)}&begin_time=${encodeURIComponent(beginTime)}&end_time=${encodeURIComponent(endTime)}`,
    operation: 'ListPayments',
    envelopeField: 'payments',
    cursorField: 'cursor',
    queryBody: {},
  });
  return { payments: results };
}

export async function searchOrders(
  locationId: string,
  beginTime: string,
  endTime: string,
): Promise<{ orders: SquareOrder[] }> {
  const { results } = await paginatedRequest<SquareOrder>({
    method: 'POST',
    path: '/v2/orders/search',
    operation: 'SearchOrders',
    envelopeField: 'orders',
    cursorField: 'cursor',
    queryBody: {
      location_ids: [locationId],
      limit: 500,
      query: {
        filter: {
          date_time_filter: {
            closed_at: {
              start_at: beginTime,
              end_at: endTime,
            },
          },
          state_filter: { states: ['COMPLETED'] },
        },
        sort: { sort_field: 'CLOSED_AT', sort_order: 'ASC' },
      },
    },
  });
  return { orders: results };
}

export async function listCatalog(): Promise<{ objects: SquareCatalogObject[] }> {
  const { results } = await paginatedRequest<SquareCatalogObject>({
    method: 'GET',
    path: '/v2/catalog/list',
    operation: 'ListCatalog',
    envelopeField: 'objects',
    cursorField: 'cursor',
    queryBody: {},
  });
  return { objects: results };
}

// ── READ-ONLY enforcement ────────────────────────────────────────────────────
//
// The allowlist below is the ONLY set of Square endpoints this client may
// call. Every endpoint is a read-only retrieval or search operation.
//
// ┌───────────────────────────────────────────────────────────────────────┐
// │                                                                       │
// │   BANNED Square endpoints — NEVER call these. No exceptions.          │
// │   Writing to Square requires the operator's explicit written approval.       │
// │                                                                       │
// │   POST   /v2/team-members                   (create team member)     │
// │   PUT    /v2/team-members/{id}              (update team member)      │
// │   POST   /v2/labor/shifts                   (create shift)           │
// │   PUT    /v2/labor/shifts/{id}              (update shift)           │
// │   POST   /v2/orders                        (create order)           │
// │   POST   /v2/payments                       (create payment)         │
// │   POST   /v2/payments/{id}/complete         (complete payment)       │
// │   POST   /v2/refunds                        (create refund)          │
// │   POST   /v2/catalog/object                 (create catalog item)    │
// │   PUT    /v2/catalog/object                 (update catalog item)    │
// │   POST   /v2/webhook_subscriptions          (subscribe webhook)      │
// │   DELETE /v2/ANYTHING                       (delete anything)        │
// │   POST   /v2/disputes/{id}/accept           (accept dispute)        │
// │   POST   /v2/terminal/checkouts             (terminal checkout)     │
// │                                                                       │
// │   Adding any write endpoint to the allowlist REQUIRES the operator's  │
// │   explicit written approval. The guard in httpTransport() will       │
// │   throw SquareWriteGuardError before the request hits the network.   │
// │                                                                       │
// └───────────────────────────────────────────────────────────────────────┘
const READ_ONLY_ALLOWLIST: ReadonlySet<string> = new Set([
  'GET:/v2/merchants/me',
  'GET:/v2/locations',
  'GET:/v2/locations/*',
  'POST:/v2/team-members/search',
  'POST:/v2/labor/scheduled-shifts/search',
  'POST:/v2/labor/shifts/search',
  'GET:/v2/labor/workweek-configs',
  'GET:/v2/payments',
  'POST:/v2/orders/search',
  'GET:/v2/catalog/list',
  'POST:/v2/catalog/batch-retrieve',
]);

/**
 * Assert that a method+path combination is on the read-only allowlist.
 * Called by httpTransport() before every real network request.
 *
 * Returns true if allowed, false if blocked. When false, the caller throws
 * SquareWriteGuardError, which halts the operation immediately.
 *
 * Adding an endpoint to the allowlist REQUIRES the operator's explicit
 * written approval. The allowlist is deliberately narrow: only GET and POST-search
 * endpoints that retrieve data without modifying the Square account.
 */
export function assertReadOnlyEndpoint(method: HttpMethod, path: string): boolean {
  const cleanPath = path.split('?')[0];
  const key = `${method}:${cleanPath}`;
  if (READ_ONLY_ALLOWLIST.has(key)) return true;
  // Wildcard check for GET:/v2/locations/{id}
  if (method === 'GET' && /^\/v2\/locations\/[^/]+$/.test(cleanPath)) return true;
  // Hard block on any method+path not explicitly allowed
  return false;
}

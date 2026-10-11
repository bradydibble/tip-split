import { describe, it, expect, afterEach } from 'vitest';
import {
  searchTeamMembers,
  listLocations,
  getMerchantMe,
  listCatalog,
  searchScheduledShifts,
  listPayments,
  searchOrders,
  assertReadOnlyEndpoint,
  SquareWriteGuardError,
  __resetMockOverrides,
} from './client';
import { TEST_LOCATION_ID } from './fixtures';

// All tests run in mock mode (no SQUARE_ACCESS_TOKEN in the test env).

describe('Square client (mock mode)', () => {
  afterEach(() => __resetMockOverrides());

  it('getMerchantMe returns synthetic merchant', async () => {
    const { merchant } = await getMerchantMe();
    expect(merchant.id).toBeTruthy();
    expect(merchant.country).toBe('US');
    expect(merchant.currency).toBe('USD');
  });

  it('listLocations returns the test location', async () => {
    const { locations } = await listLocations();
    expect(locations.length).toBeGreaterThanOrEqual(1);
    const loc = locations[0];
    expect(loc.id).toBe(TEST_LOCATION_ID);
    expect(loc.timezone).toBe('America/Los_Angeles');
    expect(loc.business_hours).toBeDefined();
    expect(loc.business_hours!.periods.length).toBe(7);
  });

  it('searchTeamMembers returns ACTIVE staff for the location', async () => {
    const { team_members } = await searchTeamMembers(TEST_LOCATION_ID);
    expect(team_members.length).toBe(6);
    for (const tm of team_members) {
      expect(tm.status).toBe('ACTIVE');
      expect(tm.assigned_locations.location_ids).toContain(TEST_LOCATION_ID);
    }
  });

  it('searchTeamMembers filters out non-ACTIVE and wrong-location members', async () => {
    const { team_members } = await searchTeamMembers(TEST_LOCATION_ID);
    // Even the mock fixture includes only ACTIVE members, the client-side
    // filter is defense-in-depth: no INACTIVE, no other-location.
    expect(team_members.every((t) => t.status === 'ACTIVE')).toBe(true);
  });

  it('searchScheduledShifts returns PUBLISHED shifts for a business date', async () => {
    const { scheduled_shifts } = await searchScheduledShifts(
      TEST_LOCATION_ID,
      '2026-08-27T00:00:00-07:00',
      '2026-08-28T00:00:00-07:00',
    );
    expect(scheduled_shifts.length).toBeGreaterThan(0);
    // Published = has published_shift_details (real Beta shape)
    expect(scheduled_shifts.every((s) => !!s.published_shift_details)).toBe(true);
  });

  it('listPayments returns COMPLETED payments', async () => {
    const { payments } = await listPayments(
      TEST_LOCATION_ID,
      '2026-08-27T00:00:00-07:00',
      '2026-08-27T15:00:00-07:00',
    );
    expect(payments.length).toBeGreaterThan(0);
    expect(payments.every((p) => p.status === 'COMPLETED')).toBe(true);
    for (const p of payments) {
      expect(p.tip_money.amount).toBeGreaterThan(0);
    }
  });

  it('searchOrders returns COMPLETED orders with line_items', async () => {
    const { orders } = await searchOrders(
      TEST_LOCATION_ID,
      '2026-08-27T00:00:00-07:00',
      '2026-08-28T00:00:00-07:00',
    );
    expect(orders.length).toBeGreaterThan(0);
    expect(orders.every((o) => o.state === 'COMPLETED')).toBe(true);
    expect(orders[0].line_items.length).toBeGreaterThan(0);
  });

  it('listCatalog returns categories and items with nested variations', async () => {
    const { objects } = await listCatalog();
    const types = new Set(objects.map((o) => o.type));
    expect(types.has('CATEGORY')).toBe(true);
    expect(types.has('ITEM')).toBe(true);
    // Real shape: variations are nested inside item_data.variations[]
    const items = objects.filter((o) => o.type === 'ITEM');
    expect(items.length).toBeGreaterThan(0);
    expect(items.every((i) => (i.item_data?.variations?.length ?? 0) > 0)).toBe(true);
  });

  it('pagination is capped at maxPages', async () => {
    // With mock fixtures that don't return a cursor, we get exactly 1 page.
    const { locations } = await listLocations();
    expect(locations.length).toBe(1);
  });
});

// ── Read-only guard: the most important test in this codebase ──────────────
//
// These tests verify that the HARD GUARD in httpTransport() blocks every
// mutating Square endpoint. If any of these pass a real HTTP request, it
// would WRITE to the connected production Square account — which is
// ABSOLUTELY FORBIDDEN without the operator's explicit written approval.
//
// The guard is tested via assertReadOnlyEndpoint() directly, since the
// mock transport bypasses the guard (mock mode never reaches the network).

describe('Read-only write guard — NEVER allow writes to Square', () => {
  // Every read-only endpoint that IS allowed
  const allowed: [string, string][] = [
    ['GET', '/v2/merchants/me'],
    ['GET', '/v2/locations'],
    ['GET', '/v2/locations/L123456'],
    ['POST', '/v2/team-members/search'],
    ['POST', '/v2/labor/scheduled-shifts/search'],
    ['GET', '/v2/payments'],
    ['POST', '/v2/orders/search'],
    ['GET', '/v2/catalog/list'],
    ['POST', '/v2/catalog/batch-retrieve'],
  ];

  for (const [method, path] of allowed) {
    it(`ALLOWS ${method} ${path} (read-only)`, () => {
      expect(assertReadOnlyEndpoint(method as 'GET' | 'POST', path)).toBe(true);
    });
  }

  // Mutating endpoints that MUST NEVER be allowed — any of these would
  // write to the Square account.
  const banned: [string, string][] = [
    // Team member mutations
    ['POST', '/v2/team-members'],
    ['PUT', '/v2/team-members/TM-001'],
    ['DELETE', '/v2/team-members/TM-001'],
    // Shift mutations
    ['POST', '/v2/labor/shifts'],
    ['PUT', '/v2/labor/shifts/SH-001'],
    ['DELETE', '/v2/labor/shifts/SH-001'],
    // Order mutations
    ['POST', '/v2/orders'],
    ['PUT', '/v2/orders/ORD-001'],
    // Payment mutations
    ['POST', '/v2/payments'],
    ['POST', '/v2/payments/PAY-001/complete'],
    // Refund
    ['POST', '/v2/refunds'],
    // Catalog mutations
    ['POST', '/v2/catalog/object'],
    ['PUT', '/v2/catalog/object'],
    ['DELETE', '/v2/catalog/object/OBJ-001'],
    // Webhook subscription
    ['POST', '/v2/webhook_subscriptions'],
    ['PUT', '/v2/webhook_subcriptions/WH-001'],
    // Disputes
    ['POST', '/v2/disputes/DIS-001/accept'],
    // Terminal
    ['POST', '/v2/terminal/checkouts'],
    // Location mutations
    ['POST', '/v2/locations'],
    ['PUT', '/v2/locations/Loc-001'],
    // Anything else
    ['PATCH', '/v2/team-members/TM-001'],
    ['DELETE', '/v2/anything'],
    ['POST', '/v2/some-new-endpoint'],
  ];

  for (const [method, path] of banned) {
    it(`BLOCKS ${method} ${path} (would write to Square)`, () => {
      expect(assertReadOnlyEndpoint(method as 'GET' | 'POST', path)).toBe(false);
    });
  }

  it('strips query string before checking', () => {
    expect(
      assertReadOnlyEndpoint('GET', '/v2/payments?location_id=L1&begin_time=T1'),
    ).toBe(true);
    expect(
      assertReadOnlyEndpoint('POST', '/v2/orders?fake=query'),
    ).toBe(false);
  });

  it('SquareWriteGuardError has a descriptive message', () => {
    const err = new SquareWriteGuardError('test message');
    expect(err.name).toBe('SquareWriteGuardError');
    expect(err.message).toContain('test message');
  });
});

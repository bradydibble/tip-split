import { describe, it, expect } from 'vitest';

// Force mock mode for this test
process.env.SQUARE_ENVIRONMENT = 'mock';

import { runCapabilityProbe } from './probe';
import { TEST_LOCATION_ID } from './fixtures';

describe('Square capability probe (mock mode)', () => {
  it('returns a result for every required endpoint', async () => {
    const result = await runCapabilityProbe();
    expect(result.endpoints.length).toBe(6);
    const labels = result.endpoints.map((e) => e.label);
    expect(labels).toContain('Validate merchant');
    expect(labels).toContain('Enumerate locations');
    expect(labels).toContain('Active staff roster');
    expect(labels).toContain('Read payments (tip_money)');
    expect(labels).toContain('Search orders (liquor classification)');
    expect(labels).toContain('Read catalog categories/items');
  });

  it('all endpoints pass in mock mode', async () => {
    const result = await runCapabilityProbe();
    expect(result.overall).toBe('pass');
    expect(result.missingScopes).toEqual([]);
    for (const ep of result.endpoints) {
      expect(ep.status).toBe('ok');
    }
  });

  it('discovers locations with ID, name, and timezone', async () => {
    const result = await runCapabilityProbe();
    expect(result.locations.length).toBeGreaterThanOrEqual(1);
    const loc = result.locations[0];
    expect(loc.id).toBe(TEST_LOCATION_ID);
    expect(loc.name).toBeTruthy();
    expect(loc.timezone).toBe('America/Los_Angeles');
  });

  it('reports mockMode = true when no token configured', async () => {
    const result = await runCapabilityProbe();
    expect(result.mockMode).toBe(true);
  });

  it('probedAt is a valid ISO timestamp', async () => {
    const result = await runCapabilityProbe();
    expect(() => new Date(result.probedAt)).not.toThrow();
    expect(new Date(result.probedAt).getTime()).toBeLessThanOrEqual(Date.now());
  });
});

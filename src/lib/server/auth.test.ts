import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { mkdtempSync, rmSync } from 'fs';
import { tmpdir } from 'os';
import { join } from 'path';

const tmp = mkdtempSync(join(tmpdir(), 'tipsplit-auth-test-'));
process.env.DATABASE_PATH = join(tmp, 'test.db');

let auth: typeof import('./auth');

beforeAll(async () => {
  auth = await import('./auth');
});

afterAll(() => {
  rmSync(tmp, { recursive: true, force: true });
});

// SvelteKit's redirect() throws a Redirect error carrying status + location.
// (The class is not exported from '@sveltejs/kit', so assert on the shape.)
function catchRedirect(fn: () => void): { status: number; location: string } {
  try {
    fn();
  } catch (e) {
    const r = e as { status?: number; location?: string };
    expect(typeof r.status).toBe('number');
    expect(typeof r.location).toBe('string');
    return { status: r.status as number, location: r.location as string };
  }
  throw new Error('expected redirect() to throw');
}

describe('requireManager', () => {
  it('lets managers through', () => {
    expect(() => auth.requireManager({ user: { id: 1, role: 'manager' } })).not.toThrow();
  });

  it('redirects shift leads away from admin', () => {
    const r = catchRedirect(() => auth.requireManager({ user: { id: 2, role: 'shift_lead' } }));
    expect(r.status).toBe(303);
    expect(r.location).toBe('/calculate');
  });

  it('redirects anonymous users to login', () => {
    const r = catchRedirect(() => auth.requireManager({ user: null }));
    expect(r.status).toBe(303);
    expect(r.location).toBe('/');
  });
});

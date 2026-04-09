import type { Actions, PageServerLoad } from './$types';
import { fail, redirect } from '@sveltejs/kit';
import { findUserByPin, createSession } from '$lib/server/auth';

const WINDOW_MS = 15 * 60 * 1000; // 15 minutes
const MAX_ATTEMPTS = 5;
const GLOBAL_MAX = 50;

// Per-IP failed attempt tracking
const failedAttempts = new Map<string, { count: number; firstAttempt: number }>();

// Global counter for distributed brute force detection
let globalFailed = { count: 0, firstAttempt: 0 };

// Sweep stale entries every 5 minutes
setInterval(() => {
  const now = Date.now();
  for (const [ip, entry] of failedAttempts) {
    if (now - entry.firstAttempt > WINDOW_MS) failedAttempts.delete(ip);
  }
  if (globalFailed.count > 0 && now - globalFailed.firstAttempt > WINDOW_MS) {
    globalFailed = { count: 0, firstAttempt: 0 };
  }
}, 5 * 60 * 1000);

export const load: PageServerLoad = ({ locals }) => {
  if (locals.user) redirect(303, '/calculate');
  return {};
};

export const actions: Actions = {
  default: async ({ request, cookies, locals, getClientAddress }) => {
    if (locals.user) redirect(303, '/calculate');

    const pin = String((await request.formData()).get('pin') ?? '').trim();

    if (pin.length < 4) return fail(400, { error: 'PIN must be at least 4 digits' });

    const ip = getClientAddress();
    const now = Date.now();

    // Lazy cleanup: expire this IP's window if stale
    const entry = failedAttempts.get(ip);
    if (entry && now - entry.firstAttempt > WINDOW_MS) {
      failedAttempts.delete(ip);
    }

    // Check per-IP rate limit
    const current = failedAttempts.get(ip);
    if (current && current.count >= MAX_ATTEMPTS) {
      return fail(429, { error: 'Too many attempts. Try again in a few minutes.' });
    }

    // Check global rate limit (distributed brute force)
    if (globalFailed.count > 0 && now - globalFailed.firstAttempt > WINDOW_MS) {
      globalFailed = { count: 0, firstAttempt: 0 };
    }
    if (globalFailed.count >= GLOBAL_MAX) {
      return fail(429, { error: 'Too many attempts. Try again in a few minutes.' });
    }

    const user = await findUserByPin(pin);
    if (!user) {
      // Increment per-IP counter
      const existing = failedAttempts.get(ip);
      if (existing) {
        existing.count++;
      } else {
        failedAttempts.set(ip, { count: 1, firstAttempt: now });
      }
      // Increment global counter
      if (globalFailed.count === 0) {
        globalFailed = { count: 1, firstAttempt: now };
      } else {
        globalFailed.count++;
      }
      return fail(401, { error: 'Incorrect PIN — try again' });
    }

    // Successful login: clear per-IP counter
    failedAttempts.delete(ip);

    const sessionId = createSession(user.id);
    cookies.set('session', sessionId, {
      path: '/',
      httpOnly: true,
      sameSite: 'strict',
      maxAge: 60 * 60 * 24,
      secure: process.env.NODE_ENV !== 'development',
    });

    redirect(303, '/calculate');
  },
};

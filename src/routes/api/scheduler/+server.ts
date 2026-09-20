import type { RequestHandler } from './$types';
import { runSchedulerTick } from '$lib/server/square/scheduler';
import { isSquareConfigured } from '$lib/server/square/config';

/**
 * Scheduler tick endpoint. Triggered periodically (every ~1 minute) by a
 * cron job, systemd timer, or external health-check pinger.
 *
 * The tick is idempotent: running it multiple times when a report is already
 * created just returns the existing report. No duplicate reports.
 *
 * Returns minimal info for monitoring: business date, actions, errors.
 * Never leaks customer data or Square credentials.
 */
export const POST: RequestHandler = async ({ request }) => {
  // Optional auth: a simple bearer token to prevent external abuse.
  // When unconfigured, the endpoint is open (network-level protection assumed).
  const expectedToken = process.env.SCHEDULER_TOKEN;
  if (expectedToken) {
    const auth = request.headers.get('authorization');
    if (auth !== `Bearer ${expectedToken}`) {
      return new Response(JSON.stringify({ error: 'Unauthorized' }), {
        status: 401,
        headers: { 'Content-Type': 'application/json' },
      });
    }
  }

  if (!isSquareConfigured()) {
    return new Response(JSON.stringify({
      skipped: true,
      reason: 'Square not configured',
    }), { headers: { 'Content-Type': 'application/json' } });
  }

  const result = await runSchedulerTick();

  return new Response(JSON.stringify(result), {
    headers: { 'Content-Type': 'application/json' },
  });
};

import type { Handle } from '@sveltejs/kit';
import { getSession } from '$lib/server/auth';

export const handle: Handle = async ({ event, resolve }) => {
  const sessionId = event.cookies.get('session') ?? null;
  event.locals.sessionId = sessionId;
  event.locals.user = sessionId ? getSession(sessionId) : null;
  return resolve(event);
};

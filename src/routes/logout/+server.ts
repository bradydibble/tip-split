import type { RequestHandler } from './$types';
import { redirect } from '@sveltejs/kit';
import { deleteSession } from '$lib/server/auth';

export const POST: RequestHandler = ({ cookies, locals }) => {
  if (locals.sessionId) deleteSession(locals.sessionId);
  cookies.delete('session', { path: '/' });
  redirect(303, '/');
};

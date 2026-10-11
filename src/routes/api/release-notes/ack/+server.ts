import type { RequestHandler } from './$types';
import { ackReleaseNotes } from '$lib/server/release-notes';

/**
 * Dismiss the release-notes modal for the signed-in user. The next release
 * (new RELEASE_VERSION) shows the modal again — once per release per user.
 */
export const POST: RequestHandler = async ({ locals }) => {
  if (!locals.user) return Response.json({ error: 'Not signed in' }, { status: 401 });
  ackReleaseNotes(locals.user.id);
  return new Response(null, { status: 204 });
};

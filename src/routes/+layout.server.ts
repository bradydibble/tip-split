import type { LayoutServerLoad } from './$types';
import { hasSeenReleaseNotes } from '$lib/server/release-notes';
import { RELEASE_VERSION, RELEASE_NOTES } from '$lib/release';

/**
 * Release-notes state for the "What's new" modal (layout level so every
 * page renders it). Null for signed-out users or when the current user
 * has already acknowledged this release.
 */
export const load: LayoutServerLoad = ({ locals }) => {
  if (!locals.user) return { releaseNotes: null };
  if (hasSeenReleaseNotes(locals.user.id)) return { releaseNotes: null };
  return {
    releaseNotes: { version: RELEASE_VERSION, bullets: RELEASE_NOTES },
  };
};

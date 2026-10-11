// Current release identity, shown in the "What's new" modal exactly once
// per user per release. Bump RELEASE_VERSION with every user-facing
// release and refresh RELEASE_NOTES — a unit test asserts the version stays
// in sync with package.json, so drift fails CI.

export const RELEASE_VERSION = '0.2.0';

/** Plain-language notes for this release. Keep them user-facing. */
export const RELEASE_NOTES: readonly string[] = [
  'New tip splits now start from the people scheduled for that shift — uncheck anyone who missed work, or open the full roster to add covers.',
  'Role suggestions follow the job each person is scheduled to work that day.',
  'Shift leads can now adjust tip percentages themselves.',
  'Settings adds a Square connection page and shift reports.',
];

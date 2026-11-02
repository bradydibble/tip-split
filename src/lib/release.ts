// Current release identity, shown in the "What's new" modal exactly once
// per user per release. Bump RELEASE_VERSION with every user-facing
// release and refresh RELEASE_NOTES — a unit test asserts the version stays
// in sync with package.json, so drift fails CI.

export const RELEASE_VERSION = '0.2.1';

/** Plain-language notes for this release. Keep them user-facing. */
export const RELEASE_NOTES: readonly string[] = [
  'Tip splits now start from who actually clocked in — no more guessing who showed up. Before service starts (nobody clocked in yet), it falls back to the published schedule.',
  'Role suggestions follow the job on the clock-in (or scheduled shift) for that day.',
  'Shift leads can now adjust tip percentages themselves.',
  'Settings adds a Square connection page and shift reports.',
];

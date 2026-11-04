// Current release identity, shown in the "What's new" modal exactly once
// per user per release. Bump RELEASE_VERSION with every user-facing
// release and refresh RELEASE_NOTES — a unit test asserts the version stays
// in sync with package.json, so drift fails CI.

export const RELEASE_VERSION = '0.2.2';

/** Plain-language notes for this release. Keep them user-facing. */
export const RELEASE_NOTES: readonly string[] = [
  'The bar pool is now deducted BEFORE the kitchen split — the kitchen percentage applies to what remains after the bar pool comes out.',
  'Tip splits start from who actually clocked in (published schedule only as a pre-service fallback).',
  'Shift leads can adjust tip percentages themselves.',
  'Settings adds a Square connection page and shift reports.',
];

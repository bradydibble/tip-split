// Square job-title → TipSplit role mapping.
//
// Pure function, no side effects, no IO — exhaustively unit-tested per the
// spec acceptance criteria. Normalises Square job titles by trimming
// whitespace and comparing case-insensitively. The mapping table and its
// treatment of unknown and multi-job members are defined in the Square
// Read-Only Integration Specification §"Default role mapping".

export type TipSplitRole = 'FOH' | 'BAR' | 'BUSSER' | 'KITCHEN';
export type ExtendedTipSplitRole = TipSplitRole | 'EXCLUDED';
export type MappingState = 'MAPPED' | 'NEEDS_REVIEW' | 'EXCLUDED';

export interface RoleMappingResult {
  /** The mapped role, or null when the title lands in NEEDS_REVIEW. */
  role: ExtendedTipSplitRole | null;
  /** The resulting mapping state. */
  state: MappingState;
}

/**
 * Exact initial mappings from the spec. Keys are compared
 * case-insensitively after trim. Values are immutable.
 */
const TITLE_TO_ROLE: ReadonlyRecord<string, ExtendedTipSplitRole> = {
  mod: 'EXCLUDED',
  manager: 'EXCLUDED',
  'operations manager': 'EXCLUDED',
  owner: 'EXCLUDED',
  bartender: 'BAR',
  busser: 'BUSSER',
  cashier: 'FOH',
  'foh assistant': 'FOH',
  'food runner': 'FOH',
  cook: 'KITCHEN',
  dishwasher: 'KITCHEN',
  kitchen: 'KITCHEN',
};

/** An object whose type also acts as a Record shorthand. */
type ReadonlyRecord<K extends string, V> = { readonly [key in K]: V };

/**
 * Map a single Square job title to a TipSplit role.
 *
 * Trims whitespace, lowercases, and looks up the exact mapping table.
 * Any title not in the table returns `NEEDS_REVIEW` — never a silent payout
 * role.
 */
export function mapJobTitle(title: string): RoleMappingResult {
  const normalized = title.trim().toLowerCase();
  if (!normalized) {
    return { role: null, state: 'NEEDS_REVIEW' };
  }

  const role = TITLE_TO_ROLE[normalized];
  if (!role) {
    return { role: null, state: 'NEEDS_REVIEW' };
  }

  return {
    role,
    state: role === 'EXCLUDED' ? 'EXCLUDED' : 'MAPPED',
  };
}

/**
 * Map one or more Square job titles held by the same team member.
 *
 * Spec: "For a team member with more than one applicable job, retain every
 * mapped job and mark the scheduled job as the report default when Square
 * supplies a job_id."
 *
 * If ANY of the held jobs produce conflicting non-excluded roles, the member
 * lands in NEEDS_REVIEW — we never silently pick one payout role.
 *
 * If all jobs are EXCLUDED, the member is EXCLUDED.
 */
export function mapJobs(
  titles: string[],
  opts: { scheduledJobTitle?: string } = {}
): {
  defaultRole: ExtendedTipSplitRole | null;
  state: MappingState;
  allMappedRoles: ExtendedTipSplitRole[];
} {
  const mapped = titles.map(mapJobTitle);

  // Collect all non-excluded roles.
  const nonExcludedRoles = mapped
    .filter((m) => m.state === 'MAPPED' && m.role !== null)
    .map((m) => m.role!) as ExtendedTipSplitRole[];

  const hasNeedsReview = mapped.some((m) => m.state === 'NEEDS_REVIEW');
  const allExcluded =
    mapped.length > 0 && mapped.every((m) => m.state === 'EXCLUDED');

  // If any title is unknown, the member needs review.
  if (hasNeedsReview) {
    return { defaultRole: null, state: 'NEEDS_REVIEW', allMappedRoles: [] };
  }

  // If all are excluded, the member is excluded.
  if (allExcluded) {
    return {
      defaultRole: 'EXCLUDED',
      state: 'EXCLUDED',
      allMappedRoles: ['EXCLUDED'],
    };
  }

  // Deduplicate the non-excluded roles.
  const uniqueRoles = [...new Set(nonExcludedRoles)];

  // If exactly one non-excluded role, that's the default.
  if (uniqueRoles.length === 1) {
    return {
      defaultRole: uniqueRoles[0],
      state: 'MAPPED',
      allMappedRoles: uniqueRoles,
    };
  }

  // Multiple conflicting non-excluded roles → needs review unless the
  // scheduled job resolves the ambiguity.
  if (opts.scheduledJobTitle) {
    const schedMapped = mapJobTitle(opts.scheduledJobTitle);
    if (
      schedMapped.state === 'MAPPED' &&
      uniqueRoles.includes(schedMapped.role!)
    ) {
      return {
        defaultRole: schedMapped.role!,
        state: 'MAPPED',
        allMappedRoles: uniqueRoles,
      };
    }
  }

  return { defaultRole: null, state: 'NEEDS_REVIEW', allMappedRoles: uniqueRoles };
}

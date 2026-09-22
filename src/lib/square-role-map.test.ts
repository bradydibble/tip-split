import { describe, it, expect } from 'vitest';
import { mapJobTitle, mapJobs } from './square-role-map';

// ── Single-title mapping: exact keys from the spec ──────────────────────────

describe('mapJobTitle — exact spec mappings', () => {
  // | Square job title | TipSplit default | Treatment |
  const cases: [string, 'FOH' | 'BAR' | 'BUSSER' | 'KITCHEN' | 'EXCLUDED', 'MAPPED' | 'EXCLUDED'][] = [
    // EXCLUDED group
    ['MOD',                 'EXCLUDED', 'EXCLUDED'],
    ['Manager',             'EXCLUDED', 'EXCLUDED'],
    ['Operations Manager',  'EXCLUDED', 'EXCLUDED'],
    ['Owner',               'EXCLUDED', 'EXCLUDED'],
    // BAR
    ['Bartender',           'BAR',      'MAPPED'],
    // BUSSER
    ['Busser',              'BUSSER',   'MAPPED'],
    // FOH
    ['Cashier',             'FOH',      'MAPPED'],
    ['FOH Assistant',       'FOH',      'MAPPED'],
    ['Food Runner',         'FOH',      'MAPPED'],
    // KITCHEN
    ['Cook',                'KITCHEN',  'MAPPED'],
    ['Dishwasher',          'KITCHEN',  'MAPPED'],
    ['Kitchen',             'KITCHEN',  'MAPPED'],
  ];

  for (const [title, expectedRole, expectedState] of cases) {
    it(`maps "${title}" → ${expectedRole} (${expectedState})`, () => {
      const r = mapJobTitle(title);
      expect(r.role).toBe(expectedRole);
      expect(r.state).toBe(expectedState);
    });
  }
});

// ── Case / whitespace normalization ──────────────────────────────────────────

describe('mapJobTitle — normalization', () => {
  it('trims leading/trailing whitespace', () => {
    expect(mapJobTitle('  Bartender  ').role).toBe('BAR');
  });

  it('compares case-insensitively', () => {
    expect(mapJobTitle('bartender').role).toBe('BAR');
    expect(mapJobTitle('BARTENDER').role).toBe('BAR');
    expect(mapJobTitle('BaRtEnDeR').role).toBe('BAR');
  });

  it('handles mixed-case multi-word titles', () => {
    expect(mapJobTitle('operations manager').role).toBe('EXCLUDED');
    expect(mapJobTitle('FOH ASSISTANT').role).toBe('FOH');
  });
});

// ── Unknown titles ──────────────────────────────────────────────────────────

describe('mapJobTitle — unknown titles land in NEEDS_REVIEW', () => {
  const unknowns = [
    'Host',
    'Server',
    'Waiter',
    'Sommelier',
    'Barback',
    '',
    '   ',
    'Some Random Title',
    'Assistant Manager',
    'Line Cook Prep',
  ];

  for (const title of unknowns) {
    it(`"${title}" → NEEDS_REVIEW (never a payout role)`, () => {
      const r = mapJobTitle(title);
      expect(r.state).toBe('NEEDS_REVIEW');
      expect(r.role).toBeNull();
    });
  }
});

// ── Multi-job mapping ────────────────────────────────────────────────────────

describe('mapJobs — multi-job members', () => {
  it('single role: returns that role as MAPPED', () => {
    const r = mapJobs(['Bartender']);
    expect(r.defaultRole).toBe('BAR');
    expect(r.state).toBe('MAPPED');
    expect(r.allMappedRoles).toEqual(['BAR']);
  });

  it('two jobs same role: returns that role as MAPPED', () => {
    const r = mapJobs(['Cashier', 'Food Runner']);
    expect(r.defaultRole).toBe('FOH');
    expect(r.state).toBe('MAPPED');
  });

  it('all excluded: returns EXCLUDED', () => {
    const r = mapJobs(['Manager', 'Owner']);
    expect(r.defaultRole).toBe('EXCLUDED');
    expect(r.state).toBe('EXCLUDED');
  });

  it('conflicting non-excluded roles without scheduled job: NEEDS_REVIEW', () => {
    const r = mapJobs(['Bartender', 'Cook']);
    expect(r.state).toBe('NEEDS_REVIEW');
    expect(r.defaultRole).toBeNull();
    expect(r.allMappedRoles).toEqual(expect.arrayContaining(['BAR', 'KITCHEN']));
  });

  it('conflicting roles resolved by scheduled job in the held set: MAPPED', () => {
    const r = mapJobs(['Bartender', 'Cook'], { scheduledJobTitle: 'Bartender' });
    expect(r.state).toBe('MAPPED');
    expect(r.defaultRole).toBe('BAR');
  });

  it('scheduled job not in held set: still NEEDS_REVIEW', () => {
    const r = mapJobs(['Bartender', 'Cook'], { scheduledJobTitle: 'Busser' });
    expect(r.state).toBe('NEEDS_REVIEW');
  });

  it('one known + one unknown: NEEDS_REVIEW', () => {
    const r = mapJobs(['Bartender', 'Host']);
    expect(r.state).toBe('NEEDS_REVIEW');
  });

  it('mixed excluded + non-excluded: non-excluded wins, no conflict', () => {
    const r = mapJobs(['Manager', 'Bartender']);
    expect(r.defaultRole).toBe('BAR');
    expect(r.state).toBe('MAPPED');
  });

  it('empty array: NEEDS_REVIEW', () => {
    const r = mapJobs([]);
    expect(r.state).toBe('NEEDS_REVIEW');
  });
});

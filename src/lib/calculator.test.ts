import { describe, it, expect } from 'vitest';
import { calculate, dollarsToCents } from './calculator';

// Deterministic LCG for reproducible tests
function makeRng(seed = 42): () => number {
  let s = seed >>> 0;
  return () => {
    s = (Math.imul(1664525, s) + 1013904223) >>> 0;
    return s / 0x100000000;
  };
}

// ── Shared fixture ────────────────────────────────────────────────────────────
// grossTips $1000, ccFeeRate 3.5%, kitchenPct 5%, barPct 10%
// liquorSales = tipsAfterFees = $965  (so barPool = 10% of $965 = $96.50)
// Staff: 5 FOH servers, 1 bartender, 3 kitchen cooks
const STAFF = [
  { id: 1, name: 'Server A',    role: 'FOH'     as const },
  { id: 2, name: 'Server B',    role: 'FOH'     as const },
  { id: 3, name: 'Server C',    role: 'FOH'     as const },
  { id: 4, name: 'Server D',    role: 'FOH'     as const },
  { id: 5, name: 'Server E',    role: 'FOH'     as const },
  { id: 6, name: 'Bartender F', role: 'Bar'     as const },
  { id: 7, name: 'Cook G',      role: 'Kitchen' as const },
  { id: 8, name: 'Cook H',      role: 'Kitchen' as const },
  { id: 9, name: 'Cook I',      role: 'Kitchen' as const },
];
const BASE_INPUT = {
  grossTipsCents:   dollarsToCents(1000),
  // liquorSales set equal to tipsAfterFees so barPool = 10% of tipsAfterFees
  liquorSalesCents: dollarsToCents(965),
  staff: STAFF,
  config: { ccFeeRate: 0.035, kitchenPct: 0.05, barLiquorPct: 0.10 },
};

// ── Intermediate amounts (same for both rounding modes) ───────────────────────
describe('calculate — intermediate amounts', () => {
  const r = calculate({ ...BASE_INPUT, config: { ...BASE_INPUT.config, roundToDollar: false } });

  it('ccFees = $1000 × 3.5% = $35', () => {
    expect(r.ccFeesCents).toBe(3500);
    expect(r.tipsAfterFeesCents).toBe(96500); // $965
  });

  it('kitchenPool = $965 × 5% = $48.25', () => {
    expect(r.kitchenPoolCents).toBe(4825);
    expect(r.remainingAfterKitchenCents).toBe(91675); // $916.75
  });

  it('barPool = $965 × 10% = $96.50', () => {
    expect(r.barPoolCents).toBe(9650);
  });

  it('fohPool = $916.75 − $96.50 = $820.25', () => {
    expect(r.fohPoolCents).toBe(82025);
  });

  it('bartender IS counted in FOH pool participants', () => {
    expect(r.fohStaffCount).toBe(5);              // only FOH staff
    expect(r.fohPoolParticipantCount).toBe(6);    // 5 FOH + 1 Bar share the FOH pool
    expect(r.barStaffCount).toBe(1);
  });
});

// ── roundToDollar: false (cent-precision, deterministic) ─────────────────────
describe('calculate — roundToDollar: false', () => {
  const r = calculate(
    { ...BASE_INPUT, config: { ...BASE_INPUT.config, roundToDollar: false } }
  );

  const foh     = r.distributions.filter(d => d.role === 'FOH');
  const bar     = r.distributions.filter(d => d.role === 'Bar');
  const kitchen = r.distributions.filter(d => d.role === 'Kitchen');

  it('5 FOH servers split $820.25 among 6 (FOH+Bar) → floor $136.70, 5¢ remainder to first 5', () => {
    // fohPool = 82025 cents, 6 participants: floor(82025/6) = 13670, remainder = 82025 - 13670*6 = 5
    // fohPoolParticipants = [...fohStaff, ...barStaff], so first 5 (all FOH) each get 13671¢
    expect(foh).toHaveLength(5);
    foh.forEach(d => {
      expect(d.totalCents).toBe(13671);
    });
  });

  it('bartender gets FOH share + bar pool share: FOH $136.70 + bar $96.50', () => {
    expect(bar).toHaveLength(1);
    // bartender is the 6th participant (index 5) — gets 13670¢ FOH share + 9650¢ bar pool
    expect(bar[0].fohShareCents).toBe(13670);
    expect(bar[0].barPoolShareCents).toBe(9650);
    expect(bar[0].totalCents).toBe(13670 + 9650);
  });

  it('3 kitchen cooks split $48.25 → $16.09, $16.08, $16.08 (1¢ remainder to first)', () => {
    expect(kitchen).toHaveLength(3);
    expect(kitchen[0].totalCents).toBe(1609); // $16.09 — gets remainder cent
    expect(kitchen[1].totalCents).toBe(1608); // $16.08
    expect(kitchen[2].totalCents).toBe(1608); // $16.08
  });

  it('kitchen distribution sums to kitchenPoolCents', () => {
    const sum = kitchen.reduce((s, d) => s + d.totalCents, 0);
    expect(sum).toBe(r.kitchenPoolCents); // 4825
  });
});

// ── roundToDollar: true (whole-dollar, random remainder) ─────────────────────
describe('calculate — roundToDollar: true (default)', () => {
  const r = calculate(BASE_INPUT, makeRng());

  const foh     = r.distributions.filter(d => d.role === 'FOH');
  const bar     = r.distributions.filter(d => d.role === 'Bar');
  const kitchen = r.distributions.filter(d => d.role === 'Kitchen');

  it('all per-person amounts are whole dollars (multiples of 100 cents)', () => {
    r.distributions.forEach(d => expect(d.totalCents % 100).toBe(0));
  });

  it('FOH pool rounds to $820, split 6 ways (5 FOH + 1 Bar) → base $136, 4 extras of $137', () => {
    // kitchenPool: round(4825/100)*100 = 4800; remaining = 96500-4800 = 91700
    // barPool: round(9650/100)*100 = 9700; fohPool = 91700-9700 = 82000 → $820
    // 820 / 6 = 136 base, extras = 820 - 136*6 = 820 - 816 = 4
    expect(foh).toHaveLength(5);
    const fohTotals = foh.map(d => d.totalCents);
    fohTotals.forEach(t => expect(t === 13600 || t === 13700).toBe(true));
    const fohSum = fohTotals.reduce((s, t) => s + t, 0);
    // all 5 FOH + 1 bar share $820 pool; check FOH portion is consistent
    expect(fohSum % 100).toBe(0);
  });

  it('bar pool rounds to $97, bartender gets FOH share + $97 bar', () => {
    // Math.round(9650 / 100) = 97
    expect(bar[0].barPoolShareCents).toBe(9700);
    expect(bar[0].fohShareCents === 13600 || bar[0].fohShareCents === 13700).toBe(true);
    expect(bar[0].totalCents).toBe(bar[0].fohShareCents + 9700);
  });

  it('FOH + Bar pool shares sum to $820', () => {
    const allFohShares = [...foh, ...bar].reduce((s, d) => s + d.fohShareCents, 0);
    expect(allFohShares).toBe(82000);
  });

  it('kitchen pool rounds to $48, 3 cooks → $16 each (exact)', () => {
    // Math.round(4825 / 100) = 48 (rounds 48.25 → 48), 48 / 3 = 16 exact
    kitchen.forEach(d => expect(d.totalCents).toBe(1600));
  });

  it('kitchen total = $48', () => {
    const sum = kitchen.reduce((s, d) => s + d.totalCents, 0);
    expect(sum).toBe(4800);
  });
});

// ── Edge cases ────────────────────────────────────────────────────────────────
describe('calculate — edge cases', () => {
  it('empty staff — no distributions, no throw', () => {
    const r = calculate({ ...BASE_INPUT, staff: [] });
    expect(r.distributions).toHaveLength(0);
  });

  it('zero tips — all distributions are zero', () => {
    const r = calculate({ ...BASE_INPUT, grossTipsCents: 0, liquorSalesCents: 0 });
    r.distributions.forEach(d => expect(d.totalCents).toBe(0));
  });

  it('multiple bartenders split bar pool and FOH pool equally (whole dollars)', () => {
    const r = calculate({
      grossTipsCents: dollarsToCents(500),
      liquorSalesCents: dollarsToCents(1000),
      staff: [
        { id: 1, name: 'Bartender A', role: 'Bar' as const },
        { id: 2, name: 'Bartender B', role: 'Bar' as const },
      ],
      config: { ccFeeRate: 0, kitchenPct: 0, barLiquorPct: 0.10 },
    }, makeRng());
    const bars = r.distributions.filter(d => d.role === 'Bar');
    expect(bars).toHaveLength(2);
    // fohPool = $500 - $0 kitchen - $100 bar = $400, split 2 ways → $200 each
    // barPool = $100, split 2 ways → $50 each
    // total per bartender = $200 + $50 = $250
    bars.forEach(d => {
      expect(d.fohShareCents).toBe(20000);
      expect(d.barPoolShareCents).toBe(5000);
      expect(d.totalCents).toBe(25000);
    });
  });
});

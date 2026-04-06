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

  it('bartender is NOT counted in FOH staff', () => {
    expect(r.fohStaffCount).toBe(5);
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

  it('5 FOH servers split $820.25 → $164.05 each (exact, no remainder)', () => {
    expect(foh).toHaveLength(5);
    foh.forEach(d => expect(d.totalCents).toBe(16405)); // $164.05
  });

  it('bartender gets bar pool share only: $96.50', () => {
    expect(bar).toHaveLength(1);
    expect(bar[0].totalCents).toBe(9650); // $96.50
    expect(bar[0].fohShareCents).toBe(0);
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

  it('FOH pool rounds to $820, split 5 ways → $164 each (exact)', () => {
    // Math.round(82025 / 100) = 820, 820 / 5 = 164 exact
    foh.forEach(d => expect(d.totalCents).toBe(16400));
  });

  it('bar pool rounds to $97, bartender gets $97', () => {
    // Math.round(9650 / 100) = 97 (rounds 96.50 → 97 with Math.round half-up)
    expect(bar[0].totalCents).toBe(9700);
    expect(bar[0].fohShareCents).toBe(0);
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

  it('multiple bartenders split bar pool equally (whole dollars)', () => {
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
    // barPool = $100, 2 bartenders → $50 each
    bars.forEach(d => expect(d.totalCents).toBe(5000));
  });
});

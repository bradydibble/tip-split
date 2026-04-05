import { describe, it, expect } from 'vitest';
import { calculate, dollarsToCents } from './calculator';

// Deterministic RNG for reproducible tests (LCG)
function makeRng(seed = 42): () => number {
  let s = seed >>> 0;
  return () => {
    s = (Math.imul(1664525, s) + 1013904223) >>> 0;
    return s / 0x100000000;
  };
}

// Appendix A fixture from PRD:
// $1,000 gross tips, $2,500 liquor sales
// 5 FOH servers + 1 bartender + 3 kitchen cooks
// CC fee 2.5%, kitchen 30%, bar 10%
const FIXTURE = {
  grossTipsCents:   dollarsToCents(1000),
  liquorSalesCents: dollarsToCents(2500),
  staff: [
    { id: 1, name: 'Server A',    role: 'FOH' as const },
    { id: 2, name: 'Server B',    role: 'FOH' as const },
    { id: 3, name: 'Server C',    role: 'FOH' as const },
    { id: 4, name: 'Server D',    role: 'FOH' as const },
    { id: 5, name: 'Server E',    role: 'FOH' as const },
    { id: 6, name: 'Bartender F', role: 'Bar' as const },
    { id: 7, name: 'Cook G',      role: 'Kitchen' as const },
    { id: 8, name: 'Cook H',      role: 'Kitchen' as const },
    { id: 9, name: 'Cook I',      role: 'Kitchen' as const },
  ],
  config: { ccFeeRate: 0.025, kitchenPct: 0.30, barLiquorPct: 0.10 },
};

describe('calculate — intermediate amounts (PRD Appendix A)', () => {
  const r = calculate(FIXTURE, makeRng());

  it('deducts CC fees: $1000 × 2.5% = $25', () => {
    expect(r.ccFeesCents).toBe(2500);
    expect(r.tipsAfterFeesCents).toBe(97500);
  });

  it('kitchen pool: $975 × 30% = $292.50', () => {
    expect(r.kitchenPoolCents).toBe(29250);
  });

  it('remaining after kitchen: $975 − $292.50 = $682.50', () => {
    expect(r.remainingAfterKitchenCents).toBe(68250);
  });

  it('bar pool: $2500 × 10% = $250', () => {
    expect(r.barPoolCents).toBe(25000);
  });

  it('FOH pool: $682.50 − $250 = $432.50', () => {
    expect(r.fohPoolCents).toBe(43250);
  });
});

describe('calculate — whole-dollar distribution invariants', () => {
  const r = calculate(FIXTURE, makeRng());

  const foh     = r.distributions.filter(d => d.role === 'FOH');
  const bar     = r.distributions.filter(d => d.role === 'Bar');
  const kitchen = r.distributions.filter(d => d.role === 'Kitchen');

  it('all per-person amounts are whole dollars (multiples of 100 cents)', () => {
    for (const d of r.distributions) {
      expect(d.totalCents % 100).toBe(0);
      expect(d.fohShareCents % 100).toBe(0);
      expect(d.barPoolShareCents % 100).toBe(0);
      expect(d.kitchenShareCents % 100).toBe(0);
    }
  });

  it('FOH pool distributes $433 (Math.round($432.50)) among 6 staff', () => {
    // pool rounded to nearest dollar = $433
    const fohTotal = [...foh, ...bar].reduce((s, d) => s + d.fohShareCents, 0);
    expect(fohTotal / 100).toBe(433);
  });

  it('each FOH person gets $72 or $73 (base $72, 1 extra)', () => {
    for (const d of foh) {
      expect(d.fohShareCents / 100).toBeGreaterThanOrEqual(72);
      expect(d.fohShareCents / 100).toBeLessThanOrEqual(73);
    }
    expect(bar[0].fohShareCents / 100).toBeGreaterThanOrEqual(72);
    expect(bar[0].fohShareCents / 100).toBeLessThanOrEqual(73);
  });

  it('exactly 1 of the 6 FOH-pool staff gets the extra dollar ($73)', () => {
    const allFohShares = [...foh, ...bar].map(d => d.fohShareCents / 100);
    expect(allFohShares.filter(v => v === 73)).toHaveLength(1);
    expect(allFohShares.filter(v => v === 72)).toHaveLength(5);
  });

  it('bartender receives FOH share + $250 bar pool', () => {
    expect(bar).toHaveLength(1);
    expect(bar[0].barPoolShareCents).toBe(25000); // $250 exactly
    // total is FOH share + $250
    expect(bar[0].totalCents).toBe(bar[0].fohShareCents + 25000);
  });

  it('kitchen distributes $293 (Math.round($292.50)) among 3 staff', () => {
    const kitTotal = kitchen.reduce((s, d) => s + d.kitchenShareCents, 0);
    expect(kitTotal / 100).toBe(293);
  });

  it('each kitchen person gets $97 or $98 (base $97, 2 extras)', () => {
    for (const d of kitchen) {
      expect(d.kitchenShareCents / 100).toBeGreaterThanOrEqual(97);
      expect(d.kitchenShareCents / 100).toBeLessThanOrEqual(98);
    }
    const extras = kitchen.filter(d => d.kitchenShareCents / 100 === 98);
    expect(extras).toHaveLength(2);
  });
});

describe('calculate — edge cases', () => {
  it('handles empty staff list without throwing', () => {
    const r = calculate({ ...FIXTURE, staff: [] });
    expect(r.distributions).toHaveLength(0);
  });

  it('handles zero liquor sales (bar pool = 0)', () => {
    const r = calculate({ ...FIXTURE, liquorSalesCents: 0 });
    expect(r.barPoolCents).toBe(0);
    const bar = r.distributions.find(d => d.role === 'Bar');
    expect(bar!.barPoolShareCents).toBe(0);
  });

  it('splits bar pool equally among multiple bartenders (whole dollars)', () => {
    const r = calculate({
      grossTipsCents:   dollarsToCents(1000),
      liquorSalesCents: dollarsToCents(1000),
      staff: [
        { id: 1, name: 'Server A',    role: 'FOH' as const },
        { id: 2, name: 'Bartender B', role: 'Bar' as const },
        { id: 3, name: 'Bartender C', role: 'Bar' as const },
      ],
      config: { ccFeeRate: 0, kitchenPct: 0, barLiquorPct: 0.10 },
    }, makeRng());
    // bar pool = $100, 2 bartenders → $50 each (exact)
    const bars = r.distributions.filter(d => d.role === 'Bar');
    expect(bars).toHaveLength(2);
    bars.forEach(d => {
      expect(d.barPoolShareCents % 100).toBe(0);
      expect(d.barPoolShareCents).toBe(5000);
    });
  });

  it('handles zero tips without throwing', () => {
    const r = calculate({ ...FIXTURE, grossTipsCents: 0 });
    const total = r.distributions.reduce((s, d) => s + d.totalCents, 0);
    expect(total).toBe(0);
  });

  it('all amounts are multiples of 100 with odd staff counts', () => {
    const r = calculate({
      grossTipsCents:   dollarsToCents(100),
      liquorSalesCents: 0,
      staff: [
        { id: 1, name: 'A', role: 'FOH' as const },
        { id: 2, name: 'B', role: 'FOH' as const },
        { id: 3, name: 'C', role: 'FOH' as const },
      ],
      config: { ccFeeRate: 0, kitchenPct: 0, barLiquorPct: 0 },
    }, makeRng());
    for (const d of r.distributions) {
      expect(d.totalCents % 100).toBe(0);
    }
  });
});

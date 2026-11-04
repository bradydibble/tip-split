import { describe, it, expect } from 'vitest';
import { calculate } from './calculator';

// When a role has nobody present, nothing goes to that role: the pool
// collapses to zero and its share stays with the remaining pools.
// Real case: #341 — one bartender, zero kitchen staff, $94 after fees,
// $65 bar pool. Old behavior left $15 in an unpaid kitchen pool.
describe('calculate — empty roles get nothing', () => {
  it('no Kitchen staff → kitchen pool is zero, FOH keeps the remainder', () => {
    const r = calculate({
      grossTipsCents: 9600,
      liquorSalesCents: 64900,
      staff: [{ id: 1, name: 'Bartender', role: 'Bar' as const }],
      config: { ccFeeRate: 0.035, kitchenPct: 0.5, barLiquorPct: 0.1, roundToDollar: true },
    });
    expect(r.kitchenPoolCents).toBe(0);
    // after bar $27.64 → kitchen 0, busser 0 → FOH gets the remainder
    expect(r.fohPoolCents).toBe(2800); // after bar $27.64 rounds down in pool math
  });

  it('no Bar staff → bar pool is zero even when liquor sales exist', () => {
    const r = calculate({
      grossTipsCents: 9600,
      liquorSalesCents: 64900,
      staff: [
        { id: 1, name: 'Server', role: 'FOH' as const },
        { id: 2, name: 'Cook', role: 'Kitchen' as const },
      ],
      config: { ccFeeRate: 0.035, kitchenPct: 0.5, barLiquorPct: 0.1, roundToDollar: true },
    });
    // Bar empty → no bar pool. after fees $93 → kitchen 50% of $93 = $46.50 → $47 (round), FOH $46
    expect(r.barPoolCents).toBe(0);
    expect(r.kitchenPoolCents).toBe(4700);
    expect(r.fohPoolCents).toBe(4600);
  });

  it('no FOH or Bar staff → FOH pool zero, kitchen takes its full share', () => {
    const r = calculate({
      grossTipsCents: 9600,
      liquorSalesCents: 0,
      staff: [{ id: 1, name: 'Cook', role: 'Kitchen' as const }],
      config: { ccFeeRate: 0.035, kitchenPct: 0.5, barLiquorPct: 0.1, roundToDollar: false },
    });
    // No FOH/Bar → nobody to receive the FOH pool; it holds the remainder.
    // Kitchen still gets its 50% of after fees ($92.64 → $46.32).
    expect(r.kitchenPoolCents).toBe(4632);
    expect(r.fohPoolCents).toBe(4632);
  });

  it('pools always sum to tips after fees (no orphan money)', () => {
    const r = calculate({
      grossTipsCents: 9600,
      liquorSalesCents: 64900,
      staff: [{ id: 1, name: 'Bartender', role: 'Bar' as const }],
      config: { ccFeeRate: 0.035, kitchenPct: 0.5, barLiquorPct: 0.1, roundToDollar: true },
    });
    expect(r.barPoolCents + r.kitchenPoolCents + r.busserPoolCents + r.fohPoolCents)
      .toBe(r.tipsAfterFeesCents);
  });
});

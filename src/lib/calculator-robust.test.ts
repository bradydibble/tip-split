import { describe, it, expect } from 'vitest';
import { calculate } from './calculator';

// Robustness: bad inputs, float noise, and degenerate staffing must not
// throw, produce NaN, or strand money.

const base = {
  grossTipsCents: 100000,
  liquorSalesCents: 50000,
  staff: [
    { id: 1, name: 'S', role: 'FOH' as const },
    { id: 2, name: 'B', role: 'Bar' as const },
    { id: 3, name: 'K', role: 'Kitchen' as const },
  ],
  config: { ccFeeRate: 0.03, kitchenPct: 0.05, barLiquorPct: 0.1 },
};

function expectSane(r: ReturnType<typeof calculate>) {
  // Every intermediate must be a finite integer; per-person shares must sum
  // to their pools. Pool conservation holds only when tips cover the claims;
  // when they don't, payouts floor at zero and the shortfall shows in the
  // pool breakdown.
  const nums = [r.grossTipsCents, r.ccFeesCents, r.tipsAfterFeesCents, r.barPoolCents,
    r.kitchenPoolCents, r.busserPoolCents, r.fohPoolCents, r.remainingAfterBarCents];
  for (const n of nums) { expect(Number.isFinite(n)).toBe(true); expect(Number.isInteger(n)).toBe(true); }
  if (r.tipsAfterFeesCents >= 0) {
    expect(r.barPoolCents + r.kitchenPoolCents + r.busserPoolCents + r.fohPoolCents)
      .toBe(r.tipsAfterFeesCents);
  }
  const fohSum = r.distributions.filter(d => d.role === 'FOH' || d.role === 'Bar')
    .reduce((s, d) => s + d.fohShareCents, 0);
  const kitSum = r.distributions.filter(d => d.role === 'Kitchen')
    .reduce((s, d) => s + d.kitchenShareCents, 0);
  const barSum = r.distributions.filter(d => d.role === 'Bar')
    .reduce((s, d) => s + d.barPoolShareCents, 0);
  if (r.fohStaffCount + r.barStaffCount > 0) expect(fohSum).toBe(r.fohPoolCents);
  if (r.kitchenStaffCount > 0) expect(kitSum).toBe(r.kitchenPoolCents);
  if (r.barStaffCount > 0) expect(barSum).toBe(r.barPoolCents);
}

describe('calculate — robustness', () => {
  it('float-noise percentages (0.1 + 0.2 style) stay finite and conserve', () => {
    const r = calculate({ ...base, config: { ccFeeRate: 0.1 + 0.2, kitchenPct: 0.30000000000000004, barLiquorPct: 0.07000000000000001 } });
    expectSane(r);
  });

  it('negative gross tips: distributions never go negative', () => {
    const r = calculate({ ...base, grossTipsCents: -5000 });
    expectSane(r);
    r.distributions.forEach(d => expect(d.totalCents).toBeGreaterThanOrEqual(0));
  });

  it('zero tips with liquor sales: bar pool clamps so nobody is negative', () => {
    const r = calculate({ ...base, grossTipsCents: 0 });
    expectSane(r);
    r.distributions.forEach(d => expect(d.totalCents).toBeGreaterThanOrEqual(0));
  });

  it('FOH-only staff: empty bar and kitchen pools are zero and conserve', () => {
    const r = calculate({
      ...base,
      staff: [{ id: 1, name: 'S', role: 'FOH' as const }],
    });
    expectSane(r);
    expect(r.kitchenPoolCents).toBe(0);
    expect(r.barPoolCents).toBe(0);
  });

  it('all-busser staff: nobody shares pools, bussers still paid, no NaN', () => {
    const r = calculate({
      ...base,
      staff: [
        { id: 1, name: 'B1', role: 'Busser' as const },
        { id: 2, name: 'B2', role: 'Busser' as const },
      ],
      config: { ccFeeRate: 0.03, kitchenPct: 0.05, barLiquorPct: 0.1, busserRateCents: 2000 },
    });
    expectSane(r);
    r.distributions.forEach(d => expect(d.totalCents).toBe(2000));
  });
});

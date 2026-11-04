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

  it('barPool = $965 liquor × 10% = $96.50 — deducted before the kitchen/FOH split', () => {
    expect(r.barPoolCents).toBe(9650);
    expect(r.remainingAfterBarCents).toBe(96500 - 9650); // $868.50
  });

  it('kitchenPool = 5% of the after-bar remainder ($868.50) = $43.43 — bar comes out first', () => {
    expect(r.kitchenPoolCents).toBe(4343);
    expect(r.fohPoolCents).toBe(86850 - 4343); // $820.25 → now $825.07
  });

  it('fohPool = $868.50 − $43.43 = $825.07', () => {
    expect(r.fohPoolCents).toBe(82507);
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

  it('5 FOH servers split $825.07 among 6 (FOH+Bar) → floor $137.51, 1¢ remainder to first', () => {
    // fohPool = 82507 cents, 6 participants: floor(82507/6) = 13751, remainder = 82507 - 13751*6 = 1
    // fohPoolParticipants = [...fohStaff, ...barStaff], so the first FOH gets 13752¢
    expect(foh).toHaveLength(5);
    expect(foh[0].totalCents).toBe(13752);
    foh.slice(1).forEach(d => {
      expect(d.totalCents).toBe(13751);
    });
  });

  it('bartender gets FOH share + bar pool share: FOH $137.51 + bar $96.50', () => {
    expect(bar).toHaveLength(1);
    // bartender is the 6th participant (index 5) — gets 13751¢ FOH share + 9650¢ bar pool
    expect(bar[0].fohShareCents).toBe(13751);
    expect(bar[0].barPoolShareCents).toBe(9650);
    expect(bar[0].totalCents).toBe(13751 + 9650);
  });

  it('3 kitchen cooks split $43.43 → $14.48, $14.48, $14.47 (1¢ remainder to first two)', () => {
    expect(kitchen).toHaveLength(3);
    expect(kitchen[0].totalCents).toBe(1448); // $14.48 — gets remainder cent
    expect(kitchen[1].totalCents).toBe(1448); // $14.48
    expect(kitchen[2].totalCents).toBe(1447); // $14.47
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

  it('FOH pool rounds to $825, split 6 ways (5 FOH + 1 Bar) → base $137, 3 extras of $138', () => {
    // kitchenPool: 5% of after-bar 86850 = 4343 → round(4343/100)*100 = 4300
    // fohPool = 86850 - 4300 = 82550 → distributes as $825 across people
    // 825 / 6 = 137 base, extras = 825 - 137*6 = 3
    expect(foh).toHaveLength(5);
    const fohTotals = foh.map(d => d.totalCents);
    fohTotals.forEach(t => expect(t === 13700 || t === 13800).toBe(true));
    const fohSum = fohTotals.reduce((s, t) => s + t, 0);
    // all 5 FOH + 1 bar share the pool; check FOH portion is consistent
    expect(fohSum % 100).toBe(0);
  });

  it('bar pool rounds to $97, bartender gets FOH share + $97 bar', () => {
    // Math.round(9650 / 100) = 97
    expect(bar[0].barPoolShareCents).toBe(9700);
    expect(bar[0].fohShareCents === 13700 || bar[0].fohShareCents === 13800).toBe(true);
    expect(bar[0].totalCents).toBe(bar[0].fohShareCents + 9700);
  });

  it('FOH + Bar pool shares sum to $825', () => {
    const allFohShares = [...foh, ...bar].reduce((s, d) => s + d.fohShareCents, 0);
    expect(allFohShares).toBe(82500);
  });

  it('kitchen pool rounds to $43, 3 cooks → random whole dollars summing to $43', () => {
    // Math.round(4343 / 100) = 43; remainder dollars go to random cooks
    kitchen.forEach(d => expect(d.totalCents === 1400 || d.totalCents === 1500).toBe(true));
  });

  it('kitchen total = $43', () => {
    const sum = kitchen.reduce((s, d) => s + d.totalCents, 0);
    expect(sum).toBe(4300);
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

// ── Negative liquor (net returns) ────────────────────────────────────────────
describe('calculate — negative liquor sales', () => {
  it('bar pool clamps at zero when net returns exceed liquor sales', () => {
    const r = calculate({
      ...BASE_INPUT,
      liquorSalesCents: -50000, // returns exceed sales → 10% = -$50
      config: { ...BASE_INPUT.config, roundToDollar: false },
    });
    expect(r.barPoolCents).toBe(0);
    // FOH pool is NOT inflated by the negative bar amount:
    expect(r.remainingAfterBarCents).toBe(96500);
    // Bar clamped at zero → kitchen base is the full tips after fees
    expect(r.fohPoolCents).toBe(96500 - 4825);
  });

  it('clamping holds in roundToDollar mode too', () => {
    const r = calculate({
      ...BASE_INPUT,
      liquorSalesCents: -96500, // 10% rounds to -$97
    });
    expect(r.barPoolCents).toBe(0);
  });
});

// ── Bussers ─────────────────────────────────────────────────────────────────
// Busser = fixed per-person cut from the post-kitchen remainder, taken before
// the bar/FOH split. Bussers do NOT share the FOH pool.
describe('calculate — bussers', () => {
  const STAFF_WITH_BUSSERS = [
    ...STAFF,
    { id: 10, name: 'Busser J', role: 'Busser' as const },
    { id: 11, name: 'Busser K', role: 'Busser' as const },
  ];
  const r = calculate({
    ...BASE_INPUT, staff: STAFF_WITH_BUSSERS,
    config: { ...BASE_INPUT.config, roundToDollar: false },
  });
  const bussers = r.distributions.filter(d => d.role === 'Busser');

  it('default busser rate is $20/person; pool = rate × count', () => {
    expect(r.busserStaffCount).toBe(2);
    expect(r.busserPoolCents).toBe(4000); // 2 × $20
  });

  it('each busser gets exactly the fixed rate, nothing else', () => {
    expect(bussers).toHaveLength(2);
    bussers.forEach(d => {
      expect(d.busserShareCents).toBe(2000);
      expect(d.totalCents).toBe(2000);
      expect(d.fohShareCents).toBe(0);
      expect(d.barPoolShareCents).toBe(0);
      expect(d.kitchenShareCents).toBe(0);
    });
  });

  it('bar deducted before the kitchen split; busser cut comes from the FOH side', () => {
    expect(r.barPoolCents).toBe(9650);                      // 10% of $965 liquor
    expect(r.remainingAfterBarCents).toBe(96500 - 9650);    // $868.50
    expect(r.kitchenPoolCents).toBe(4343);                  // 5% of the after-bar remainder
    expect(r.fohPoolCents).toBe(86850 - 4343 - 4000);       // $785.07
  });

  it('bussers do NOT participate in the FOH pool', () => {
    expect(r.fohPoolParticipantCount).toBe(6); // 5 FOH + 1 Bar only
  });

  it('custom busser rate is honored', () => {
    const r2 = calculate({
      ...BASE_INPUT, staff: STAFF_WITH_BUSSERS,
      config: { ...BASE_INPUT.config, busserRateCents: 2500, roundToDollar: false },
    });
    const b2 = r2.distributions.filter(d => d.role === 'Busser');
    expect(r2.busserPoolCents).toBe(5000); // 2 × $25
    b2.forEach(d => expect(d.totalCents).toBe(2500));
  });

  it('no bussers → pool zero and legacy FOH pool is unchanged', () => {
    const rNo = calculate({ ...BASE_INPUT, config: { ...BASE_INPUT.config, roundToDollar: false } });
    expect(rNo.busserStaffCount).toBe(0);
    expect(rNo.busserPoolCents).toBe(0);
    expect(rNo.fohPoolCents).toBe(82507); // unchanged from pre-busser behavior
  });

  it('roundToDollar mode: bussers still get exact whole-dollar rate', () => {
    const rRound = calculate({ ...BASE_INPUT, staff: STAFF_WITH_BUSSERS }, makeRng());
    const b = rRound.distributions.filter(d => d.role === 'Busser');
    b.forEach(d => {
      expect(d.totalCents).toBe(2000);
      expect(d.totalCents % 100).toBe(0);
    });
  });
});

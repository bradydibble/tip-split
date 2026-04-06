export type StaffRole = 'FOH' | 'Kitchen' | 'Bar';

export interface StaffMember {
  id: number;
  name: string;
  role: StaffRole;
}

export interface SplitConfig {
  ccFeeRate: number;      // decimal, e.g. 0.025 for 2.5%
  kitchenPct: number;     // decimal, e.g. 0.05 for 5%
  barLiquorPct: number;   // decimal, e.g. 0.10 for 10%
  roundToDollar?: boolean; // default true — whole-dollar payouts
}

export interface CalculatorInput {
  grossTipsCents: number;   // integer cents
  liquorSalesCents: number; // integer cents
  staff: StaffMember[];
  config: SplitConfig;
}

export interface Distribution {
  staffId: number;
  name: string;
  role: StaffRole;
  fohShareCents: number;       // 0 for Bar and Kitchen
  barPoolShareCents: number;   // 0 for FOH and Kitchen
  kitchenShareCents: number;   // 0 for FOH and Bar
  totalCents: number;
}

export interface CalculationResult {
  grossTipsCents: number;
  ccFeesCents: number;
  tipsAfterFeesCents: number;
  kitchenPoolCents: number;
  remainingAfterKitchenCents: number;
  liquorSalesCents: number;
  barPoolCents: number;
  fohPoolCents: number;
  fohStaffCount: number;
  kitchenStaffCount: number;
  barStaffCount: number;
  distributions: Distribution[];
  config: SplitConfig;
}

// ── Distribution helpers ──────────────────────────────────────────────────────

/**
 * `roundToDollar: true` — round pool to nearest dollar, distribute whole
 * dollars, assign remainder dollars randomly (Fisher-Yates).
 * Returns array of dollar amounts (integers).
 */
function distributePoolDollars(poolCents: number, count: number, rng: () => number): number[] {
  if (count === 0) return [];
  const poolDollars = Math.round(poolCents / 100);
  const base = Math.floor(poolDollars / count);
  const extras = poolDollars - base * count;
  const amounts = new Array<number>(count).fill(base);
  if (extras > 0) {
    const indices = Array.from({ length: count }, (_, i) => i);
    for (let i = count - 1; i > 0; i--) {
      const j = Math.floor(rng() * (i + 1));
      [indices[i], indices[j]] = [indices[j], indices[i]];
    }
    for (let i = 0; i < extras; i++) amounts[indices[i]]++;
  }
  return amounts; // whole dollars
}

/**
 * `roundToDollar: false` — distribute pool in cents, floor each share,
 * remainder cents (1¢ each) assigned to first persons in order.
 * Returns array of cent amounts.
 */
function distributePoolCents(poolCents: number, count: number): number[] {
  if (count === 0) return [];
  const base = Math.floor(poolCents / count);
  const extras = poolCents - base * count;
  return Array.from({ length: count }, (_, i) => base + (i < extras ? 1 : 0));
}

// ── Main calculator ───────────────────────────────────────────────────────────

/**
 * Pure tip calculation engine — no side effects, no DB access.
 *
 * Staff model:
 *   FOH staff    → share FOH pool equally
 *   Bar staff    → share bar pool only (NOT counted in FOH pool)
 *   Kitchen staff → share kitchen pool equally
 *
 * @param rng  Optional RNG; only used when roundToDollar is true. Pass a
 *             seeded function in tests for deterministic results.
 */
export function calculate(input: CalculatorInput, rng: () => number = Math.random): CalculationResult {
  const { grossTipsCents, liquorSalesCents, staff, config } = input;
  const roundToDollar = config.roundToDollar ?? true;

  const ccFeesCents = Math.round(grossTipsCents * config.ccFeeRate);
  const tipsAfterFeesCents = grossTipsCents - ccFeesCents;

  const kitchenPoolCents = Math.round(tipsAfterFeesCents * config.kitchenPct);
  const remainingAfterKitchenCents = tipsAfterFeesCents - kitchenPoolCents;

  const barPoolCents = Math.round(liquorSalesCents * config.barLiquorPct);
  const fohPoolCents = remainingAfterKitchenCents - barPoolCents;

  // Bar staff are NOT counted in the FOH pool — they receive bar pool share only
  const fohStaff     = staff.filter(s => s.role === 'FOH');
  const kitchenStaff = staff.filter(s => s.role === 'Kitchen');
  const barStaff     = staff.filter(s => s.role === 'Bar');

  const distributions: Distribution[] = [];

  if (roundToDollar) {
    const fohDollars     = distributePoolDollars(fohPoolCents,     fohStaff.length,     rng);
    const kitchenDollars = distributePoolDollars(kitchenPoolCents, kitchenStaff.length, rng);
    const barDollars     = distributePoolDollars(barPoolCents,     barStaff.length,     rng);

    for (let i = 0; i < fohStaff.length; i++) {
      const cents = fohDollars[i] * 100;
      distributions.push({ staffId: fohStaff[i].id, name: fohStaff[i].name, role: 'FOH',
        fohShareCents: cents, barPoolShareCents: 0, kitchenShareCents: 0, totalCents: cents });
    }
    for (let i = 0; i < barStaff.length; i++) {
      const cents = barDollars[i] * 100;
      distributions.push({ staffId: barStaff[i].id, name: barStaff[i].name, role: 'Bar',
        fohShareCents: 0, barPoolShareCents: cents, kitchenShareCents: 0, totalCents: cents });
    }
    for (let i = 0; i < kitchenStaff.length; i++) {
      const cents = kitchenDollars[i] * 100;
      distributions.push({ staffId: kitchenStaff[i].id, name: kitchenStaff[i].name, role: 'Kitchen',
        fohShareCents: 0, barPoolShareCents: 0, kitchenShareCents: cents, totalCents: cents });
    }
  } else {
    const fohCents     = distributePoolCents(fohPoolCents,     fohStaff.length);
    const kitchenCents = distributePoolCents(kitchenPoolCents, kitchenStaff.length);
    const barCents     = distributePoolCents(barPoolCents,     barStaff.length);

    for (let i = 0; i < fohStaff.length; i++) {
      distributions.push({ staffId: fohStaff[i].id, name: fohStaff[i].name, role: 'FOH',
        fohShareCents: fohCents[i], barPoolShareCents: 0, kitchenShareCents: 0, totalCents: fohCents[i] });
    }
    for (let i = 0; i < barStaff.length; i++) {
      distributions.push({ staffId: barStaff[i].id, name: barStaff[i].name, role: 'Bar',
        fohShareCents: 0, barPoolShareCents: barCents[i], kitchenShareCents: 0, totalCents: barCents[i] });
    }
    for (let i = 0; i < kitchenStaff.length; i++) {
      distributions.push({ staffId: kitchenStaff[i].id, name: kitchenStaff[i].name, role: 'Kitchen',
        fohShareCents: 0, barPoolShareCents: 0, kitchenShareCents: kitchenCents[i], totalCents: kitchenCents[i] });
    }
  }

  return {
    grossTipsCents, ccFeesCents, tipsAfterFeesCents, kitchenPoolCents,
    remainingAfterKitchenCents, liquorSalesCents, barPoolCents, fohPoolCents,
    fohStaffCount: fohStaff.length, kitchenStaffCount: kitchenStaff.length, barStaffCount: barStaff.length,
    distributions, config,
  };
}

/** Parse a dollar string or number to integer cents */
export function dollarsToCents(value: string | number): number {
  return Math.round(parseFloat(String(value)) * 100);
}

/** Format integer cents as a dollar string e.g. 9750 → "97.50" */
export function formatCents(cents: number): string {
  return (cents / 100).toFixed(2);
}

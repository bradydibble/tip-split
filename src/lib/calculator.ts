export type StaffRole = 'FOH' | 'Kitchen' | 'Bar';

export interface StaffMember {
  id: number;
  name: string;
  role: StaffRole;
}

export interface SplitConfig {
  ccFeeRate: number;    // decimal, e.g. 0.025 for 2.5%
  kitchenPct: number;   // decimal, e.g. 0.30 for 30%
  barLiquorPct: number; // decimal, e.g. 0.10 for 10%
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
  fohShareCents: number;      // always a multiple of 100 (whole dollars)
  barPoolShareCents: number;  // always a multiple of 100 (whole dollars)
  kitchenShareCents: number;  // always a multiple of 100 (whole dollars)
  totalCents: number;         // always a multiple of 100 (whole dollars)
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

/**
 * Distribute a pool (in cents) evenly across `count` people in whole dollars.
 * Remainder dollars are randomly assigned (+$1 to random recipients).
 * Returns array of dollar amounts (integers).
 *
 * @param rng - optional RNG for testing; defaults to Math.random
 */
function distributePool(poolCents: number, count: number, rng: () => number = Math.random): number[] {
  if (count === 0) return [];
  const poolDollars = Math.round(poolCents / 100);
  const base = Math.floor(poolDollars / count);
  const extras = poolDollars - base * count;

  const amounts = new Array<number>(count).fill(base);

  if (extras > 0) {
    // Fisher-Yates partial shuffle to pick `extras` random recipients
    const indices = Array.from({ length: count }, (_, i) => i);
    for (let i = count - 1; i > 0; i--) {
      const j = Math.floor(rng() * (i + 1));
      [indices[i], indices[j]] = [indices[j], indices[i]];
    }
    for (let i = 0; i < extras; i++) {
      amounts[indices[i]]++;
    }
  }

  return amounts; // integers, in dollars
}

/**
 * Pure tip calculation engine — no side effects, no DB access.
 * All monetary inputs are integer cents; all per-person outputs are
 * whole-dollar amounts (stored as cents, always multiples of 100).
 *
 * Calculation flow (per PRD):
 * 1. Deduct CC fees from gross tips
 * 2. Allocate kitchen pool (% of tips after fees)
 * 3. Allocate bar pool (% of liquor sales, sourced from remaining after kitchen)
 * 4. FOH pool = remaining after kitchen − bar pool
 * 5. Split FOH pool equally among FOH + Bar staff (bartenders count as FOH)
 * 6. Split kitchen pool equally among Kitchen staff
 * 7. Bartender total = FOH dollar share + bar pool dollar share
 * Remainder dollars are randomly assigned so nobody gets more than $1 over base.
 */
export function calculate(input: CalculatorInput, rng: () => number = Math.random): CalculationResult {
  const { grossTipsCents, liquorSalesCents, staff, config } = input;

  const ccFeesCents = Math.round(grossTipsCents * config.ccFeeRate);
  const tipsAfterFeesCents = grossTipsCents - ccFeesCents;

  const kitchenPoolCents = Math.round(tipsAfterFeesCents * config.kitchenPct);
  const remainingAfterKitchenCents = tipsAfterFeesCents - kitchenPoolCents;

  const barPoolCents = Math.round(liquorSalesCents * config.barLiquorPct);
  const fohPoolCents = remainingAfterKitchenCents - barPoolCents;

  // Bartenders (Bar) count as FOH for the equal-share split
  const fohStaff    = staff.filter(s => s.role === 'FOH' || s.role === 'Bar');
  const kitchenStaff = staff.filter(s => s.role === 'Kitchen');
  const barStaff    = staff.filter(s => s.role === 'Bar');

  // Distribute each pool in whole dollars, remainder randomly assigned
  const fohAmounts     = distributePool(fohPoolCents,     fohStaff.length,     rng);
  const kitchenAmounts = distributePool(kitchenPoolCents, kitchenStaff.length, rng);
  const barAmounts     = distributePool(barPoolCents,     barStaff.length,     rng);

  const distributions: Distribution[] = [];

  for (let i = 0; i < fohStaff.length; i++) {
    const person = fohStaff[i];
    const fohDollars = fohAmounts[i];

    if (person.role === 'Bar') {
      const barIndex = barStaff.indexOf(person);
      const barDollars = barAmounts[barIndex];
      distributions.push({
        staffId:         person.id,
        name:            person.name,
        role:            'Bar',
        fohShareCents:   fohDollars * 100,
        barPoolShareCents: barDollars * 100,
        kitchenShareCents: 0,
        totalCents:      (fohDollars + barDollars) * 100,
      });
    } else {
      distributions.push({
        staffId:           person.id,
        name:              person.name,
        role:              'FOH',
        fohShareCents:     fohDollars * 100,
        barPoolShareCents: 0,
        kitchenShareCents: 0,
        totalCents:        fohDollars * 100,
      });
    }
  }

  for (let i = 0; i < kitchenStaff.length; i++) {
    const person = kitchenStaff[i];
    const kitchenDollars = kitchenAmounts[i];
    distributions.push({
      staffId:           person.id,
      name:              person.name,
      role:              'Kitchen',
      fohShareCents:     0,
      barPoolShareCents: 0,
      kitchenShareCents: kitchenDollars * 100,
      totalCents:        kitchenDollars * 100,
    });
  }

  return {
    grossTipsCents,
    ccFeesCents,
    tipsAfterFeesCents,
    kitchenPoolCents,
    remainingAfterKitchenCents,
    liquorSalesCents,
    barPoolCents,
    fohPoolCents,
    fohStaffCount:     fohStaff.length,
    kitchenStaffCount: kitchenStaff.length,
    barStaffCount:     barStaff.length,
    distributions,
    config,
  };
}

/** Parse a dollar string or number to integer cents */
export function dollarsToCents(value: string | number): number {
  return Math.round(parseFloat(String(value)) * 100);
}

/** Format integer cents as a dollar string, e.g. 9750 → "97.50" */
export function formatCents(cents: number): string {
  return (cents / 100).toFixed(2);
}

/** Format integer cents as a whole-dollar string, e.g. 9750 → "$98" */
export function formatDollars(cents: number): string {
  return `$${Math.round(cents / 100)}`;
}

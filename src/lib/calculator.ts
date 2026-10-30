export type StaffRole = 'FOH' | 'Kitchen' | 'Bar' | 'Busser';

export interface StaffMember {
  id: number;
  name: string;
  role: StaffRole;
}

export interface SplitConfig {
  ccFeeRate: number;      // decimal, e.g. 0.025 for 2.5%
  kitchenPct: number;     // decimal, e.g. 0.05 for 5%
  barLiquorPct: number;   // decimal, e.g. 0.10 for 10%
  busserRateCents?: number; // fixed per-busser payout in cents; default 2000 ($20)
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
  fohShareCents: number;       // 0 for Kitchen/Busser; Bar staff also receive a FOH share (they participate in the FOH pool)
  barPoolShareCents: number;   // 0 for FOH, Kitchen, Busser
  kitchenShareCents: number;   // 0 for FOH, Bar, Busser
  busserShareCents: number;    // fixed per-person amount; 0 for FOH, Bar, Kitchen
  totalCents: number;
}

export interface CalculationResult {
  grossTipsCents: number;
  ccFeesCents: number;
  tipsAfterFeesCents: number;
  barPoolCents: number;
  remainingAfterBarCents: number;
  kitchenPoolCents: number;
  busserPoolCents: number;
  fohPoolCents: number;
  fohStaffCount: number;
  fohPoolParticipantCount: number;
  kitchenStaffCount: number;
  barStaffCount: number;
  busserStaffCount: number;
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
 *   FOH staff     → share FOH pool equally
 *   Bar staff     → share FOH pool equally AND receive bar pool share
 *   Kitchen staff → share kitchen pool equally
 *   Busser staff  → fixed per-person cut from the FOH side
 *
 * Order of operations: Tip → CC fee → Bar pool (barLiquorPct × liquor
 * sales) → kitchen pool (kitchenPct × tips-after-fees) and FOH pool
 * (remainder − busser cut) → per-person splits.
 *
 * When roundToDollar is true, every computed amount (CC fees, each pool) is
 * rounded to the nearest whole dollar before use, so all displayed values and
 * per-person payouts are whole dollars.
 *
 * @param rng  Optional RNG; only used when roundToDollar is true. Pass a
 *             seeded function in tests for deterministic results.
 */
export function calculate(input: CalculatorInput, rng: () => number = Math.random): CalculationResult {
  const { grossTipsCents, liquorSalesCents, staff, config } = input;
  const roundToDollar = config.roundToDollar ?? true;

  // Round each computed amount to the nearest dollar when roundToDollar: true
  const toDollars = (cents: number) => roundToDollar ? Math.round(cents / 100) * 100 : cents;

  const busserRateCents = config.busserRateCents ?? 2000; // fixed $20/busser default

  const ccFeesCents             = toDollars(Math.round(grossTipsCents * config.ccFeeRate));
  const tipsAfterFeesCents      = grossTipsCents - ccFeesCents;

const fohStaff     = staff.filter(s => s.role === 'FOH');
const kitchenStaff = staff.filter(s => s.role === 'Kitchen');
const barStaff     = staff.filter(s => s.role === 'Bar');
const busserStaff  = staff.filter(s => s.role === 'Busser');

  // Order of operations: Tip → CC fee → Bar pool (barLiquorPct × liquor sales)
  // → 50/50-style split of the remainder into kitchen and FOH pools →
  // busser fixed cut from the FOH side. Kitchen % applies to tips after
  // fees (the bar deduction does not change its base).
  // Net returns can drive liquor sales below zero (returns exceed sales).
  // A negative bar pool would inflate the FOH pool by that amount; clamp at
  // zero and let the display show the negative liquor figure for audit.
  const barPoolCents             = Math.max(0, toDollars(Math.round(liquorSalesCents * config.barLiquorPct)));
  const remainingAfterBarCents   = tipsAfterFeesCents - barPoolCents;
  const kitchenPoolCents         = toDollars(Math.round(tipsAfterFeesCents * config.kitchenPct));
  const busserPoolCents          = busserRateCents * busserStaff.length;
  const fohPoolCents             = remainingAfterBarCents - kitchenPoolCents - busserPoolCents;

  // Bar staff participate in the FOH pool split alongside FOH staff
  const fohPoolParticipants = [...fohStaff, ...barStaff];

  const distributions: Distribution[] = [];

  if (roundToDollar) {
    const fohDollars     = distributePoolDollars(fohPoolCents,     fohPoolParticipants.length, rng);
    const kitchenDollars = distributePoolDollars(kitchenPoolCents, kitchenStaff.length,        rng);
    const barDollars     = distributePoolDollars(barPoolCents,     barStaff.length,            rng);

for (let i = 0; i < fohStaff.length; i++) {
    const cents = fohDollars[i] * 100;
    distributions.push({ staffId: fohStaff[i].id, name: fohStaff[i].name, role: 'FOH',
      fohShareCents: cents, barPoolShareCents: 0, kitchenShareCents: 0, busserShareCents: 0, totalCents: cents });
  }
for (let i = 0; i < barStaff.length; i++) {
    const fohCents = fohDollars[fohStaff.length + i] * 100;
    const barCents = barDollars[i] * 100;
    distributions.push({ staffId: barStaff[i].id, name: barStaff[i].name, role: 'Bar',
      fohShareCents: fohCents, barPoolShareCents: barCents, kitchenShareCents: 0, busserShareCents: 0, totalCents: fohCents + barCents });
  }
for (let i = 0; i < kitchenStaff.length; i++) {
    const cents = kitchenDollars[i] * 100;
    distributions.push({ staffId: kitchenStaff[i].id, name: kitchenStaff[i].name, role: 'Kitchen',
      fohShareCents: 0, barPoolShareCents: 0, kitchenShareCents: cents, busserShareCents: 0, totalCents: cents });
  }
  } else {
    const fohCents     = distributePoolCents(fohPoolCents,     fohPoolParticipants.length);
    const kitchenCents = distributePoolCents(kitchenPoolCents, kitchenStaff.length);
    const barCents     = distributePoolCents(barPoolCents,     barStaff.length);

    for (let i = 0; i < fohStaff.length; i++) {
      distributions.push({ staffId: fohStaff[i].id, name: fohStaff[i].name, role: 'FOH',
        fohShareCents: fohCents[i], barPoolShareCents: 0, kitchenShareCents: 0, busserShareCents: 0, totalCents: fohCents[i] });
    }
    for (let i = 0; i < barStaff.length; i++) {
      const fohCents_i = fohCents[fohStaff.length + i];
      const barCents_i = barCents[i];
      distributions.push({ staffId: barStaff[i].id, name: barStaff[i].name, role: 'Bar',
        fohShareCents: fohCents_i, barPoolShareCents: barCents_i, kitchenShareCents: 0, busserShareCents: 0, totalCents: fohCents_i + barCents_i });
    }
    for (let i = 0; i < kitchenStaff.length; i++) {
      distributions.push({ staffId: kitchenStaff[i].id, name: kitchenStaff[i].name, role: 'Kitchen',
        fohShareCents: 0, barPoolShareCents: 0, kitchenShareCents: kitchenCents[i], busserShareCents: 0, totalCents: kitchenCents[i] });
    }
  }

  // Bussers each receive the fixed rate — identical in both rounding modes.
  for (const b of busserStaff) {
    distributions.push({ staffId: b.id, name: b.name, role: 'Busser',
      fohShareCents: 0, barPoolShareCents: 0, kitchenShareCents: 0,
      busserShareCents: busserRateCents, totalCents: busserRateCents });
  }

  return {
    grossTipsCents, ccFeesCents, tipsAfterFeesCents,
    barPoolCents, remainingAfterBarCents, kitchenPoolCents,
    busserPoolCents, fohPoolCents,
    fohStaffCount: fohStaff.length, fohPoolParticipantCount: fohPoolParticipants.length,
    kitchenStaffCount: kitchenStaff.length, barStaffCount: barStaff.length,
    busserStaffCount: busserStaff.length,
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

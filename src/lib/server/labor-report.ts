// Labor-cost aggregation: combines worked-shift costs (from Square),
// salary allocations, and the employer-tax estimate into an all-in view.
// Overtime premium is computed at read time by bucketing each person's
// shifts into workweeks (start day persisted from Square's workweek config
// by the sync action — reads stay synchronous and offline).
// Actuals from dropped payroll/bank files extend this once parsers exist.
//
// Minute/cost figures are precomputed and stored on each labor_shifts row
// at sync time (see labor-sync.ts), so base aggregation is a plain SUM.

import db from './db';
import {
  weekStartDateOf,
  otPremiumCents,
  weeklyOvertimeAllocation,
  type DayCode,
} from './square/labor-math';

export interface LaborRangeTotals {
  businessDates: string[];
  hoursMinutes: number;
  grossWageCents: number;
  overtimePremiumCents: number;
  overtimeMinutes: number;
  adjustedWageCents: number; // straight-time + OT premium
  provisionalWageCents: number;
  openShifts: number;
  shiftCount: number;
  salaryDailyCents: number;
  salaryRangeCents: number;
  salariedStaff: { name: string; annualCents: number; weeklyHours: number | null }[];
  taxPct: number;
  taxEstimateCents: number;
  allInEstimateCents: number;
  declaredCashTipsCents: number;
}

export interface LaborDayRow {
  businessDate: string;
  hoursMinutes: number;
  wageCents: number;
  provisional: boolean;
  shiftCount: number;
  declaredCashTipsCents: number;
}

export interface LaborPersonRow {
  teamMemberId: string;
  name: string;
  payType: string | null;
  hoursMinutes: number;
  wageCents: number;
  otMinutes: number;
  otPremiumCents: number;
  provisional: boolean;
  declaredCashTipsCents: number;
}

/** Count inclusive calendar days between two YYYY-MM-DD dates. */
function daysBetween(start: string, end: string): number {
  const s = new Date(`${start}T12:00:00Z`).getTime();
  const e = new Date(`${end}T12:00:00Z`).getTime();
  return Math.max(1, Math.round((e - s) / 86_400_000) + 1);
}

/** Persisted workweek start day (SUN default), written by the sync action. */
export function getWeekStartDay(): DayCode {
  const row = db.prepare(
    "SELECT value FROM settings WHERE key = 'labor_week_start_day' AND location_id = 1"
  ).get() as { value: string } | undefined;
  const v = (row?.value ?? 'SUN').toUpperCase();
  return (['SUN', 'MON', 'TUE', 'WED', 'THU', 'FRI', 'SAT'].includes(v) ? v : 'SUN') as DayCode;
}

/**
 * Overtime premium across the range, computed by bucketing each person's
 * shifts into workweeks (FIFO hours past 40h accrue 0.5× premium at the
 * crossing shift's rate). Pads the query window by 7 days each side so
 * edge-weeks are complete.
 */
export function computeOvertimePremium(startDate: string, endDate: string, weekStart: DayCode): {
  totalOtMinutes: number;
  totalPremiumCents: number;
  perPerson: Map<string, { otMinutes: number; premiumCents: number }>;
} {
  const rows = db.prepare(`
    SELECT team_member_id, business_date, worked_minutes, hourly_rate_cents
    FROM labor_shifts
    WHERE business_date >= date(?, '-7 days') AND business_date <= date(?, '+7 days')
    ORDER BY team_member_id, business_date
  `).all(startDate, endDate) as {
    team_member_id: string; business_date: string; worked_minutes: number; hourly_rate_cents: number;
  }[];

  const perPerson = new Map<string, { otMinutes: number; premiumCents: number }>();
  let totalOtMinutes = 0;
  let totalPremiumCents = 0;

  // Rows are ordered by member then date — walk contiguous runs per member.
  let run: typeof rows = [];
  const flush = () => {
    if (run.length === 0) return;
    const tm = run[0].team_member_id;
    // Bucket into weeks; OT threshold resets per week.
    const weeks = new Map<string, { businessDate: string; minutes: number; rate: number }[]>();
    for (const r of run) {
      const wk = weekStartDateOf(r.business_date, weekStart);
      if (!weeks.has(wk)) weeks.set(wk, []);
      weeks.get(wk)!.push({ businessDate: r.business_date, minutes: r.worked_minutes, rate: r.hourly_rate_cents });
    }
    let otMins = 0;
    let prem = 0;
    for (const weekShifts of weeks.values()) {
      const { otMinutes } = weeklyOvertimeAllocation(weekShifts);
      weekShifts.forEach((s, i) => {
        prem += otPremiumCents(s.rate, otMinutes[i]);
        otMins += otMinutes[i];
      });
    }
    perPerson.set(tm, { otMinutes: otMins, premiumCents: prem });
    totalOtMinutes += otMins;
    totalPremiumCents += prem;
    run = [];
  };

  for (const r of rows) {
    if (run.length > 0 && run[0].team_member_id !== r.team_member_id) flush();
    run.push(r);
  }
  flush();

  return { totalOtMinutes, totalPremiumCents, perPerson };
}

export function getLaborRangeTotals(startDate: string, endDate: string): LaborRangeTotals {
  const agg = db.prepare(`
    SELECT
      COUNT(DISTINCT business_date)                                   AS dates,
      COALESCE(SUM(worked_minutes), 0)                                AS minutes,
      COALESCE(SUM(cost_cents), 0)                                    AS wage_cents,
      COALESCE(SUM(CASE WHEN provisional = 1 THEN cost_cents END), 0) AS prov_cents,
      COALESCE(SUM(provisional), 0)                                   AS open_shifts,
      COUNT(*)                                                        AS shift_count,
      COALESCE(SUM(declared_cash_tips_cents), 0)                      AS tips_cents
    FROM labor_shifts
    WHERE business_date BETWEEN ? AND ?
  `).get(startDate, endDate) as {
    dates: number; minutes: number; wage_cents: number; prov_cents: number;
    open_shifts: number; shift_count: number; tips_cents: number;
  };

  const dateRows = db.prepare(`
    SELECT DISTINCT business_date FROM labor_shifts
    WHERE business_date BETWEEN ? AND ? ORDER BY business_date
  `).all(startDate, endDate) as { business_date: string }[];

  // Salaried staff: active with an annual salary from Square
  const salaried = db.prepare(`
    SELECT name, salary_annual_cents, salary_weekly_hours
    FROM staff
    WHERE pay_type = 'SALARY' AND salary_annual_cents IS NOT NULL AND active = 1
    ORDER BY name
  `).all() as { name: string; salary_annual_cents: number; salary_weekly_hours: number | null }[];

  const dailyPer = (annualCents: number) => Math.round(annualCents / 365);
  const salaryDaily = salaried.reduce((sum, s) => sum + dailyPer(s.salary_annual_cents), 0);
  const days = daysBetween(startDate, endDate);
  const salaryRange = salaryDaily * days;

  const taxPct = parseFloat(
    (db.prepare(
      "SELECT value FROM settings WHERE key = 'labor_employer_tax_pct' AND location_id = 1"
    ).get() as { value: string } | undefined)?.value ?? '0'
  ) || 0;

  const wageBase = agg.wage_cents + salaryRange;
  const taxEst = Math.round((wageBase * taxPct) / 100);

  const ot = computeOvertimePremium(startDate, endDate, getWeekStartDay());

  return {
    businessDates: dateRows.map((r) => r.business_date),
    hoursMinutes: agg.minutes,
    grossWageCents: agg.wage_cents,
    overtimePremiumCents: ot.totalPremiumCents,
    overtimeMinutes: ot.totalOtMinutes,
    adjustedWageCents: agg.wage_cents + ot.totalPremiumCents,
    provisionalWageCents: agg.prov_cents,
    openShifts: agg.open_shifts,
    shiftCount: agg.shift_count,
    salaryDailyCents: salaryDaily,
    salaryRangeCents: salaryRange,
    salariedStaff: salaried.map((s) => ({
      name: s.name,
      annualCents: s.salary_annual_cents,
      weeklyHours: s.salary_weekly_hours,
    })),
    taxPct,
    taxEstimateCents: taxEst,
    allInEstimateCents: agg.wage_cents + ot.totalPremiumCents + salaryRange + taxEst,
    declaredCashTipsCents: agg.tips_cents,
  };
}

export function getLaborByDay(startDate: string, endDate: string): LaborDayRow[] {
  const rows = db.prepare(`
    SELECT
      business_date,
      SUM(worked_minutes)        AS minutes,
      SUM(cost_cents)            AS wage_cents,
      MAX(provisional)            AS provisional,
      COUNT(*)                   AS shift_count,
      SUM(declared_cash_tips_cents) AS tips_cents
    FROM labor_shifts
    WHERE business_date BETWEEN ? AND ?
    GROUP BY business_date
    ORDER BY business_date DESC
  `).all(startDate, endDate) as {
    business_date: string; minutes: number; wage_cents: number;
    provisional: number; shift_count: number; tips_cents: number;
  }[];

  return rows.map((r) => ({
    businessDate: r.business_date,
    hoursMinutes: r.minutes,
    wageCents: r.wage_cents,
    provisional: r.provisional === 1,
    shiftCount: r.shift_count,
    declaredCashTipsCents: r.tips_cents,
  }));
}

export function getLaborByPerson(startDate: string, endDate: string): LaborPersonRow[] {
  const rows = db.prepare(`
    SELECT
      ls.team_member_id,
      COALESCE(s.name, 'Square: ' || substr(ls.team_member_id, 1, 14)) AS name,
      s.pay_type AS pay_type,
      SUM(ls.worked_minutes)          AS minutes,
      SUM(ls.cost_cents)              AS wage_cents,
      MAX(ls.provisional)             AS provisional,
      SUM(ls.declared_cash_tips_cents) AS tips_cents
    FROM labor_shifts ls
    LEFT JOIN staff s ON s.square_team_member_id = ls.team_member_id
    WHERE ls.business_date BETWEEN ? AND ?
    GROUP BY ls.team_member_id
    ORDER BY wage_cents DESC
  `).all(startDate, endDate) as {
    team_member_id: string; name: string; pay_type: string | null;
    minutes: number; wage_cents: number; provisional: number; tips_cents: number;
  }[];

  const ot = computeOvertimePremium(startDate, endDate, getWeekStartDay());

  return rows.map((r) => {
    const p = ot.perPerson.get(r.team_member_id);
    return {
      teamMemberId: r.team_member_id,
      name: r.name,
      payType: r.pay_type,
      hoursMinutes: r.minutes,
      wageCents: r.wage_cents,
      otMinutes: p?.otMinutes ?? 0,
      otPremiumCents: p?.premiumCents ?? 0,
      provisional: r.provisional === 1,
      declaredCashTipsCents: r.tips_cents,
    };
  });
}

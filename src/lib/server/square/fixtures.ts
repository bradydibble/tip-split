// Redacted Square test fixtures.
//
// These fixtures simulate Square API responses WITHOUT contacting production.
// All PII is synthetic: fake names, fake IDs, fake amounts. No real Square
// merchant data is used. Tests rely exclusively on these fixtures per the
// spec: "Use a test database and recorded redacted Square fixtures. Tests
// may not contact production Square."

// ── Types matching the Square API shapes we consume ────────────────────────

export interface SquareTeamMember {
  id: string;
  given_name: string;
  family_name: string;
  email: string;
  status: 'ACTIVE' | 'INACTIVE';
  assigned_locations: {
    assignment_type?: string;
    location_ids: string[];
  };
  wage_setting?: {
    job_assignments: {
      job_title: string;
      job_id?: string;
      pay_type?: string;
      hourly_rate?: { amount: number; currency: string };
      /** Present on SALARY assignments (annual amount, cents). */
      annual_rate?: { amount: number; currency: string };
      weekly_hours?: number;
    }[];
  };
}

export interface SquareLocation {
  id: string;
  name: string;
  timezone: string;
  country: string;
  currency: string;
  status?: 'ACTIVE' | 'INACTIVE';
  business_hours?: {
    periods: { day_of_week: string; start_local_time: string; end_local_time: string }[];
  };
}

// Real ScheduledShifts (Beta) shape: details live in draft_shift_details /
// published_shift_details. The server-side filter shape is undocumented for
// this Beta, so callers filter client-side on published_shift_details.
export interface SquareScheduledShift {
  id: string;
  draft_shift_details?: SquareShiftDetails | null;
  published_shift_details?: SquareShiftDetails | null;
  version?: number;
  created_at?: string;
  updated_at?: string;
}

export interface SquareShiftDetails {
  team_member_id: string;
  location_id: string;
  job_id?: string;
  start_at: string;
  end_at: string;
  is_deleted?: boolean;
  timezone?: string;
}

// Real Worked Shifts (Shifts API) shape — actual clock in/out data with the
// wage rate charged on the shift. Verified against production 2026-09-06.
export interface SquareWorkedShift {
  id: string;
  team_member_id: string;
  employee_id?: string;
  location_id: string;
  timezone?: string;
  start_at: string;
  end_at?: string;
  status: 'OPEN' | 'CLOSED';
  wage?: {
    title?: string;
    hourly_rate?: { amount: number; currency: string };
    job_id?: string;
    tip_eligible?: boolean;
  };
  breaks?: SquareShiftBreak[];
  declared_cash_tip_money?: { amount: number; currency: string };
}

export interface SquareShiftBreak {
  id?: string;
  start_at: string;
  end_at: string;
  name?: string;
  is_paid?: boolean;
  expected_duration?: number;
}

export interface SquarePayment {
  id: string;
  location_id: string;
  created_at: string;
  order_id?: string;
  status: 'COMPLETED' | 'PENDING' | 'APPROVED';
  total_money: { amount: number; currency: string };
  tip_money: { amount: number; currency: string };
}

export interface SquareOrderLineItem {
  uid: string;
  name: string;
  quantity: string;
  catalog_object_id?: string;
  variation_name?: string;
  gross_sales_money: { amount: number; currency: string };
  total_discount_money: { amount: number; currency: string };
  total_tax_money: { amount: number; currency: string };
  total_money: { amount: number; currency: string };
  item_type?: string;
  is_custom_amount?: boolean;
}

export interface SquareOrder {
  id: string;
  location_id: string;
  created_at: string;
  updated_at: string;
  closed_at?: string;
  state: 'COMPLETED' | 'OPEN' | 'CANCELED';
  total_money: { amount: number; currency: string };
  total_tax_money: { amount: number; currency: string };
  total_discount_money: { amount: number; currency: string };
  total_tip_money: { amount: number; currency: string };
  line_items: SquareOrderLineItem[];
  refunds?: { id: string; amount_money: { amount: number; currency: string } }[];
}

export interface SquareCatalogObject {
  type: 'CATEGORY' | 'ITEM' | 'ITEM_VARIATION' | 'MODIFIER_LIST' | 'TAX' | 'DISCOUNT';
  id: string;
  is_deleted?: boolean;
  present_at_all_locations?: boolean;
  present_at_location_ids?: string[];
  category_data?: {
    name: string;
    parent_category?: { id: string };
  };
  item_data?: {
    name: string;
    /** Modern multi-category membership: [{id, ordinal}] */
    categories?: { id: string; ordinal?: number }[];
    /** Nested variations (real catalog embeds them in the item) */
    variations?: SquareCatalogVariation[];
  };
  item_variation_data?: {
    item_id: string;
    price_money?: { amount: number; currency: string };
  };
}

export interface SquareCatalogVariation {
  type: 'ITEM_VARIATION';
  id: string;
  is_deleted?: boolean;
  item_variation_data?: {
    item_id: string;
    name?: string;
    price_money?: { amount: number; currency: string };
  };
}

// ── Constants ──────────────────────────────────────────────────────────────

export const TEST_LOCATION_ID = 'LTEST000000000001';
export const TEST_MERCHANT_ID = 'MLXXXXXXXXXXXXXXXXXXX';
export const TEST_API_VERSION = '2024-12-18';
export const TEST_CURRENCY = 'USD';

// Category IDs for the taxonomy tree
export const CAT_LIQUOR_ROOT = 'CAT_LIQUOR_ROOT_001';
export const CAT_COCKTAILS = 'CAT_COCKTAILS_002';
export const CAT_SPIRITS = 'CAT_SPIRITS_003';
export const CAT_BEER = 'CAT_BEER_004';
export const CAT_WINE = 'CAT_WINE_005';
export const CAT_FOOD = 'CAT_FOOD_006';
export const CAT_BOTTLED_BEER = 'CAT_BOTTLED_BEER_007';
export const CAT_CANNED_BEER = 'CAT_CANNED_BEER_008';

// Staff / team member IDs (synthetic)
export const TM_BARKEEP = 'TM-barkeep-0001';
export const TM_SERVER_A = 'TM-servera-0002';
export const TM_COOK_B = 'TM-cookb-0003';
export const TM_BUSBOY = 'TM-busboy-0004';
export const TM_MANAGER_X = 'TM-managerx-0005';
export const TM_UNKNOWN_J = 'TM-unknownj-0006'; // Unknown job title

// Payment IDs (synthetic)
export const PAY_LUNCH_1 = 'PAY-lunch-0001';
export const PAY_LUNCH_2 = 'PAY-lunch-0002';
export const PAY_DINNER_1 = 'PAY-dinner-0001';
export const PAY_DINNER_2 = 'PAY-dinner-0002';

// Order IDs (synthetic)
export const ORD_LUNCH_1 = 'ORD-lunch-0001';
export const ORD_LUNCH_2 = 'ORD-lunch-0002';
export const ORD_DINNER_1 = 'ORD-dinner-0001';
export const ORD_RETURN_1 = 'ORD-return-0001';

// Item / variation IDs (synthetic)
export const ITEM_NEGRONI = 'ITEM-negroni-001';
export const VAR_NEGRONI = 'VAR-negroni-001';
export const ITEM_OLD_FASHIONED = 'ITEM-oldfas-002';
export const VAR_OLD_FASHIONED = 'VAR-oldfas-002';
export const ITEM_DRAFT_BEER = 'ITEM-draftbeer-003';
export const VAR_DRAFT_BEER = 'VAR-draftbeer-003';
export const ITEM_HOUSE_RED = 'ITEM-housered-004';
export const VAR_HOUSE_RED = 'VAR-housered-004';
export const ITEM_BURGER = 'ITEM-burger-005';
export const VAR_BURGER = 'VAR-burger-005';
export const ITEM_CUSTOM_COCKTAIL = 'ITEM-customck-006';

// ── Fixture builders ───────────────────────────────────────────────────────

export function buildLocationsResponse(): {
  locations: SquareLocation[];
} {
  return {
    locations: [
      {
        id: TEST_LOCATION_ID,
        name: 'Test Restaurant (Mock)',
        timezone: 'America/Los_Angeles',
        country: 'US',
        currency: TEST_CURRENCY,
        business_hours: {
          periods: [
            { day_of_week: 'MON', start_local_time: '11:00:00', end_local_time: '21:00:00' },
            { day_of_week: 'TUE', start_local_time: '11:00:00', end_local_time: '21:00:00' },
            { day_of_week: 'WED', start_local_time: '11:00:00', end_local_time: '21:00:00' },
            { day_of_week: 'THU', start_local_time: '11:00:00', end_local_time: '21:00:00' },
            { day_of_week: 'FRI', start_local_time: '11:00:00', end_local_time: '22:00:00' },
            { day_of_week: 'SAT', start_local_time: '11:00:00', end_local_time: '22:00:00' },
            { day_of_week: 'SUN', start_local_time: '11:00:00', end_local_time: '21:00:00' },
          ],
        },
      },
    ],
  };
}

export function buildMerchantsMeResponse(): {
  merchant: { id: string; country: string; currency: string; business_name: string };
} {
  return {
    merchant: {
      id: TEST_MERCHANT_ID,
      country: 'US',
      currency: TEST_CURRENCY,
      business_name: 'Test Restaurant LLC (Mock)',
    },
  };
}

export function buildTeamMembersResponse(
  extra?: Partial<SquareTeamMember>[],
): {
  team_members: SquareTeamMember[];
} {
  const base: SquareTeamMember[] = [
    {
      id: TM_BARKEEP,
      given_name: 'Pat',
      family_name: 'Mixwell',
      email: 'pat.test@example.com',
      status: 'ACTIVE',
      assigned_locations: { location_ids: [TEST_LOCATION_ID] },
      wage_setting: { job_assignments: [{ job_title: 'Bartender', job_id: 'JOB-bartender', pay_type: 'HOURLY', hourly_rate: { amount: 2000, currency: TEST_CURRENCY } }] },
    },
    {
      id: TM_SERVER_A,
      given_name: 'Jordan',
      family_name: 'Carries',
      email: 'jordan.test@example.com',
      status: 'ACTIVE',
      assigned_locations: { location_ids: [TEST_LOCATION_ID] },
      wage_setting: { job_assignments: [{ job_title: 'Food Runner', job_id: 'JOB-food-runner', pay_type: 'HOURLY', hourly_rate: { amount: 1800, currency: TEST_CURRENCY } }] },
    },
    {
      id: TM_COOK_B,
      given_name: 'Sam',
      family_name: 'Grills',
      email: 'sam.test@example.com',
      status: 'ACTIVE',
      assigned_locations: { location_ids: [TEST_LOCATION_ID] },
      wage_setting: { job_assignments: [{ job_title: 'Cook', job_id: 'JOB-cook', pay_type: 'HOURLY', hourly_rate: { amount: 2200, currency: TEST_CURRENCY } }] },
    },
    {
      id: TM_BUSBOY,
      given_name: 'Robin',
      family_name: 'Clears',
      email: 'robin.test@example.com',
      status: 'ACTIVE',
      assigned_locations: { location_ids: [TEST_LOCATION_ID] },
      wage_setting: { job_assignments: [{ job_title: 'Busser', job_id: 'JOB-busser', pay_type: 'HOURLY', hourly_rate: { amount: 1600, currency: TEST_CURRENCY } }] },
    },
    {
      id: TM_MANAGER_X,
      given_name: 'Alex',
      family_name: 'Leads',
      email: 'alex.test@example.com',
      status: 'ACTIVE',
      assigned_locations: { location_ids: [TEST_LOCATION_ID] },
      wage_setting: { job_assignments: [{ job_title: 'Manager', job_id: 'JOB-manager', pay_type: 'HOURLY', hourly_rate: { amount: 3000, currency: TEST_CURRENCY } }] },
    },
    {
      id: TM_UNKNOWN_J,
      given_name: 'Casey',
      family_name: 'Wildcard',
      email: 'casey.test@example.com',
      status: 'ACTIVE',
      assigned_locations: { location_ids: [TEST_LOCATION_ID] },
      wage_setting: { job_assignments: [{ job_title: 'Host', job_id: 'JOB-host', pay_type: 'HOURLY', hourly_rate: { amount: 1700, currency: TEST_CURRENCY } }] },
    },
  ];
  return { team_members: [...base, ...((extra ?? []) as SquareTeamMember[])] };
}

export function buildScheduledShiftsResponse(
  businessDate: string,
  opts?: { includeUnpublished?: boolean; extra?: Partial<SquareScheduledShift>[] },
): {
  scheduled_shifts: SquareScheduledShift[];
} {
  const lunchStart = `${businessDate}T11:00:00-07:00`;
  const lunchEnd = `${businessDate}T15:00:00-07:00`;
  const dinnerStart = `${businessDate}T15:00:00-07:00`;
  const dinnerEnd = `${businessDate}T21:00:00-07:00`;

  // Real shape: details in published_shift_details (draft only if unpublished)
  const mk = (
    id: string,
    tm: string,
    start: string,
    end: string,
    jobId: string,
    published: boolean,
  ): SquareScheduledShift => ({
    id,
    ...(published
      ? { published_shift_details: { team_member_id: tm, location_id: TEST_LOCATION_ID, job_id: jobId, start_at: start, end_at: end } }
      : { draft_shift_details: { team_member_id: tm, location_id: TEST_LOCATION_ID, job_id: jobId, start_at: start, end_at: end } }),
  });

  const shifts: SquareScheduledShift[] = [
    mk('SHIFT-lunch-barkeep', TM_BARKEEP, lunchStart, lunchEnd, 'JOB-bartender', true),
    mk('SHIFT-lunch-server', TM_SERVER_A, lunchStart, lunchEnd, 'JOB-food-runner', true),
    mk('SHIFT-dinner-barkeep', TM_BARKEEP, dinnerStart, dinnerEnd, 'JOB-bartender', true),
    mk('SHIFT-dinner-cook', TM_COOK_B, dinnerStart, dinnerEnd, 'JOB-cook', true),
    mk('SHIFT-dinner-busser', TM_BUSBOY, dinnerStart, dinnerEnd, 'JOB-busser', true),
    mk('SHIFT-all-day-manager', TM_MANAGER_X, lunchStart, dinnerEnd, 'JOB-manager', true),
  ];

  if (opts?.includeUnpublished) {
    shifts.push(mk('SHIFT-unpub-server', TM_SERVER_A, dinnerStart, dinnerEnd, 'JOB-food-runner', false));
  }

  return { scheduled_shifts: [...shifts, ...((opts?.extra ?? []) as SquareScheduledShift[])] };
}

export function buildPaymentsResponse(
  window: 'lunch' | 'dinner',
  opts?: { extra?: Partial<SquarePayment>[]; includeOffline?: boolean },
): {
  payments: SquarePayment[];
} {
  const payments: SquarePayment[] =
    window === 'lunch'
      ? [
          {
            id: PAY_LUNCH_1,
            location_id: TEST_LOCATION_ID,
            created_at: '2026-08-27T12:30:00-07:00',
            order_id: ORD_LUNCH_1,
            status: 'COMPLETED',
            total_money: { amount: 4500, currency: TEST_CURRENCY },
            tip_money: { amount: 500, currency: TEST_CURRENCY },
          },
          {
            id: PAY_LUNCH_2,
            location_id: TEST_LOCATION_ID,
            created_at: '2026-08-27T14:00:00-07:00',
            order_id: ORD_LUNCH_2,
            status: 'COMPLETED',
            total_money: { amount: 3200, currency: TEST_CURRENCY },
            tip_money: { amount: 300, currency: TEST_CURRENCY },
          },
        ]
      : [
          {
            id: PAY_DINNER_1,
            location_id: TEST_LOCATION_ID,
            created_at: '2026-08-27T18:00:00-07:00',
            order_id: ORD_DINNER_1,
            status: 'COMPLETED',
            total_money: { amount: 8900, currency: TEST_CURRENCY },
            tip_money: { amount: 1200, currency: TEST_CURRENCY },
          },
          {
            id: PAY_DINNER_2,
            location_id: TEST_LOCATION_ID,
            created_at: '2026-08-27T19:30:00-07:00',
            status: 'COMPLETED',
            total_money: { amount: 5600, currency: TEST_CURRENCY },
            tip_money: { amount: 700, currency: TEST_CURRENCY },
          },
        ];

  if (opts?.includeOffline && window === 'dinner') {
    payments.push({
      id: 'PAY-offline-delayed',
      location_id: TEST_LOCATION_ID,
      created_at: '2026-08-27T20:45:00-07:00',
      status: 'COMPLETED',
      total_money: { amount: 2400, currency: TEST_CURRENCY },
      tip_money: { amount: 200, currency: TEST_CURRENCY },
    });
  }

  return { payments: [...payments, ...((opts?.extra ?? []) as SquarePayment[])] };
}

export function buildOrdersResponse(
  window: 'lunch' | 'dinner',
  opts?: { includeReturn?: boolean; includeCustomLine?: boolean },
): {
  orders: SquareOrder[];
} {
  const negroniLines: SquareOrderLineItem[] = [
    {
      uid: 'LI-001',
      name: 'Negroni',
      quantity: '1',
      catalog_object_id: VAR_NEGRONI,
      variation_name: 'Regular',
      gross_sales_money: { amount: 1400, currency: TEST_CURRENCY },
      total_discount_money: { amount: 0, currency: TEST_CURRENCY },
      total_tax_money: { amount: 140, currency: TEST_CURRENCY },
      total_money: { amount: 1540, currency: TEST_CURRENCY },
      item_type: 'ITEM',
    },
    {
      uid: 'LI-002',
      name: 'Draft Beer',
      quantity: '1',
      catalog_object_id: VAR_DRAFT_BEER,
      variation_name: 'Pint',
      gross_sales_money: { amount: 600, currency: TEST_CURRENCY },
      total_discount_money: { amount: 0, currency: TEST_CURRENCY },
      total_tax_money: { amount: 60, currency: TEST_CURRENCY },
      total_money: { amount: 660, currency: TEST_CURRENCY },
      item_type: 'ITEM',
    },
  ];

  const cocktailLines: SquareOrderLineItem[] = [
    {
      uid: 'LI-003',
      name: 'Old Fashioned',
      quantity: '1',
      catalog_object_id: VAR_OLD_FASHIONED,
      variation_name: 'Regular',
      gross_sales_money: { amount: 1300, currency: TEST_CURRENCY },
      total_discount_money: { amount: 0, currency: TEST_CURRENCY },
      total_tax_money: { amount: 130, currency: TEST_CURRENCY },
      total_money: { amount: 1430, currency: TEST_CURRENCY },
      item_type: 'ITEM',
    },
    {
      uid: 'LI-004',
      name: 'House Red Wine',
      quantity: '2',
      catalog_object_id: VAR_HOUSE_RED,
      variation_name: 'Glass',
      gross_sales_money: { amount: 1200, currency: TEST_CURRENCY },
      total_discount_money: { amount: 0, currency: TEST_CURRENCY },
      total_tax_money: { amount: 120, currency: TEST_CURRENCY },
      total_money: { amount: 1320, currency: TEST_CURRENCY },
      item_type: 'ITEM',
    },
    {
      uid: 'LI-005',
      name: 'Cheeseburger',
      quantity: '1',
      catalog_object_id: VAR_BURGER,
      variation_name: 'Regular',
      gross_sales_money: { amount: 1500, currency: TEST_CURRENCY },
      total_discount_money: { amount: 0, currency: TEST_CURRENCY },
      total_tax_money: { amount: 150, currency: TEST_CURRENCY },
      total_money: { amount: 1650, currency: TEST_CURRENCY },
      item_type: 'ITEM',
    },
  ];

  const orders: SquareOrder[] =
    window === 'lunch'
      ? [
          {
            id: ORD_LUNCH_1,
            location_id: TEST_LOCATION_ID,
            created_at: '2026-08-27T12:30:00-07:00',
            updated_at: '2026-08-27T12:30:00-07:00',
            closed_at: '2026-08-27T12:30:00-07:00',
            state: 'COMPLETED',
            total_money: { amount: 4500, currency: TEST_CURRENCY },
            total_tax_money: { amount: 200, currency: TEST_CURRENCY },
            total_discount_money: { amount: 0, currency: TEST_CURRENCY },
            total_tip_money: { amount: 500, currency: TEST_CURRENCY },
            line_items: negroniLines,
          },
        ]
      : [
          {
            id: ORD_DINNER_1,
            location_id: TEST_LOCATION_ID,
            created_at: '2026-08-27T18:00:00-07:00',
            updated_at: '2026-08-27T18:00:00-07:00',
            closed_at: '2026-08-27T18:00:00-07:00',
            state: 'COMPLETED',
            total_money: { amount: 8900, currency: TEST_CURRENCY },
            total_tax_money: { amount: 400, currency: TEST_CURRENCY },
            total_discount_money: { amount: 0, currency: TEST_CURRENCY },
            total_tip_money: { amount: 1200, currency: TEST_CURRENCY },
            line_items: cocktailLines,
          },
        ];

  if (opts?.includeReturn) {
    orders.push({
      id: ORD_RETURN_1,
      location_id: TEST_LOCATION_ID,
      created_at: '2026-08-27T19:00:00-07:00',
      updated_at: '2026-08-27T19:00:00-07:00',
      closed_at: '2026-08-27T19:00:00-07:00',
      state: 'COMPLETED',
      total_money: { amount: -1400, currency: TEST_CURRENCY },
      total_tax_money: { amount: -140, currency: TEST_CURRENCY },
      total_discount_money: { amount: 0, currency: TEST_CURRENCY },
      total_tip_money: { amount: 0, currency: TEST_CURRENCY },
      line_items: [
        {
          uid: 'LI-RETURN-001',
          name: 'Negroni (Returned)',
          quantity: '-1',
          catalog_object_id: VAR_NEGRONI,
          variation_name: 'Regular',
          gross_sales_money: { amount: -1400, currency: TEST_CURRENCY },
          total_discount_money: { amount: 0, currency: TEST_CURRENCY },
          total_tax_money: { amount: -140, currency: TEST_CURRENCY },
          total_money: { amount: -1540, currency: TEST_CURRENCY },
          item_type: 'ITEM',
        },
      ],
      refunds: [{ id: 'REFUND-001', amount_money: { amount: -1400, currency: TEST_CURRENCY } }],
    });
  }

  if (opts?.includeCustomLine) {
    orders.push({
      id: 'ORD-custom-0001',
      location_id: TEST_LOCATION_ID,
      created_at: '2026-08-27T19:15:00-07:00',
      updated_at: '2026-08-27T19:15:00-07:00',
      closed_at: '2026-08-27T19:15:00-07:00',
      state: 'COMPLETED',
      total_money: { amount: 500, currency: TEST_CURRENCY },
      total_tax_money: { amount: 0, currency: TEST_CURRENCY },
      total_discount_money: { amount: 0, currency: TEST_CURRENCY },
      total_tip_money: { amount: 50, currency: TEST_CURRENCY },
      line_items: [
        {
          uid: 'LI-CUSTOM-001',
          name: 'Special Cocktail',
          quantity: '1',
          gross_sales_money: { amount: 500, currency: TEST_CURRENCY },
          total_discount_money: { amount: 0, currency: TEST_CURRENCY },
          total_tax_money: { amount: 0, currency: TEST_CURRENCY },
          total_money: { amount: 500, currency: TEST_CURRENCY },
          item_type: 'CUSTOM_AMOUNT',
          is_custom_amount: true,
        },
      ],
    });
  }

  return { orders };
}

export function buildCatalogResponse(): {
  objects: SquareCatalogObject[];
} {
  const objects: SquareCatalogObject[] = [
    // Categories
    {
      type: 'CATEGORY',
      id: CAT_LIQUOR_ROOT,
      category_data: { name: 'Cocktails/Liquors' },
      present_at_all_locations: true,
    },
    {
      type: 'CATEGORY',
      id: CAT_COCKTAILS,
      category_data: { name: 'Classic Cocktails', parent_category: { id: CAT_LIQUOR_ROOT } },
      present_at_all_locations: true,
    },
    {
      type: 'CATEGORY',
      id: CAT_SPIRITS,
      category_data: { name: 'Straight Spirits', parent_category: { id: CAT_LIQUOR_ROOT } },
      present_at_all_locations: true,
    },
    {
      type: 'CATEGORY',
      id: CAT_BEER,
      category_data: { name: 'Beer' },
      present_at_all_locations: true,
    },
    {
      type: 'CATEGORY',
      id: CAT_BOTTLED_BEER,
      category_data: { name: 'Bottled Beer', parent_category: { id: CAT_BEER } },
      present_at_all_locations: true,
    },
    {
      type: 'CATEGORY',
      id: CAT_CANNED_BEER,
      category_data: { name: 'Canned Beer', parent_category: { id: CAT_BEER } },
      present_at_all_locations: true,
    },
    {
      type: 'CATEGORY',
      id: CAT_WINE,
      category_data: { name: 'Wine' },
      present_at_all_locations: true,
    },
    {
      type: 'CATEGORY',
      id: CAT_FOOD,
      category_data: { name: 'Food' },
      present_at_all_locations: true,
    },
    // Items — real shape: categories[] membership + nested variations[]
    {
      type: 'ITEM',
      id: ITEM_NEGRONI,
      item_data: {
        name: 'Negroni',
        categories: [{ id: CAT_COCKTAILS, ordinal: 0 }],
        variations: [{
          type: 'ITEM_VARIATION',
          id: VAR_NEGRONI,
          item_variation_data: { item_id: ITEM_NEGRONI, price_money: { amount: 1400, currency: TEST_CURRENCY } },
        }],
      },
      present_at_all_locations: true,
    },
    {
      type: 'ITEM',
      id: ITEM_OLD_FASHIONED,
      item_data: {
        name: 'Old Fashioned',
        categories: [{ id: CAT_SPIRITS, ordinal: 0 }],
        variations: [{
          type: 'ITEM_VARIATION',
          id: VAR_OLD_FASHIONED,
          item_variation_data: { item_id: ITEM_OLD_FASHIONED, price_money: { amount: 1300, currency: TEST_CURRENCY } },
        }],
      },
      present_at_all_locations: true,
    },
    {
      type: 'ITEM',
      id: ITEM_DRAFT_BEER,
      item_data: {
        name: 'Draft Beer',
        categories: [{ id: CAT_BEER, ordinal: 0 }],
        variations: [{
          type: 'ITEM_VARIATION',
          id: VAR_DRAFT_BEER,
          item_variation_data: { item_id: ITEM_DRAFT_BEER, price_money: { amount: 600, currency: TEST_CURRENCY } },
        }],
      },
      present_at_all_locations: true,
    },
    {
      type: 'ITEM',
      id: ITEM_HOUSE_RED,
      item_data: {
        name: 'House Red Wine',
        categories: [{ id: CAT_WINE, ordinal: 0 }],
        variations: [{
          type: 'ITEM_VARIATION',
          id: VAR_HOUSE_RED,
          item_variation_data: { item_id: ITEM_HOUSE_RED, price_money: { amount: 600, currency: TEST_CURRENCY } },
        }],
      },
      present_at_all_locations: true,
    },
    {
      type: 'ITEM',
      id: ITEM_BURGER,
      item_data: {
        name: 'Cheeseburger',
        categories: [{ id: CAT_FOOD, ordinal: 0 }],
        variations: [{
          type: 'ITEM_VARIATION',
          id: VAR_BURGER,
          item_variation_data: { item_id: ITEM_BURGER, price_money: { amount: 1500, currency: TEST_CURRENCY } },
        }],
      },
      present_at_all_locations: true,
    },
  ];

  return { objects };
}

/**
 * Worked-shift fixtures mirroring the real Shifts API (verified against
 * production 2026-09-06): two closed shifts (one with an unpaid break and a
 * declared cash tip), one salaried-rate shift, one open (in-progress) shift.
 */
export function buildWorkedShiftsResponse(businessDate: string): {
  shifts: SquareWorkedShift[];
} {
  const mk = (
    id: string,
    tm: string,
    startLocal: string,
    endLocal: string | null,
    rateCents: number,
    opts?: { title?: string; jobId?: string; unpaidBreak?: [string, string]; declaredCashCents?: number },
  ): SquareWorkedShift => ({
    id,
    team_member_id: tm,
    employee_id: tm,
    location_id: TEST_LOCATION_ID,
    timezone: 'America/Los_Angeles',
    start_at: `${businessDate}T${startLocal}:00-07:00`,
    end_at: endLocal ? `${businessDate}T${endLocal}:00-07:00` : undefined,
    status: endLocal ? 'CLOSED' : 'OPEN',
    wage: {
      title: opts?.title ?? 'Cashier',
      hourly_rate: { amount: rateCents, currency: TEST_CURRENCY },
      job_id: opts?.jobId ?? 'JOB-cashier',
      tip_eligible: true,
    },
    breaks: opts?.unpaidBreak
      ? [{
          start_at: `${businessDate}T${opts.unpaidBreak[0]}:00-07:00`,
          end_at: `${businessDate}T${opts.unpaidBreak[1]}:00-07:00`,
          name: 'Meal',
          is_paid: false,
        }]
      : [],
    declared_cash_tip_money: { amount: opts?.declaredCashCents ?? 0, currency: TEST_CURRENCY },
  });

  return {
    shifts: [
      // Closed lunch shift, 4h, no break — cost = 4h × $18.00
      mk('WS-closed-1', TM_SERVER_A, '10:30', '14:30', 1800, { title: 'Cashier', declaredCashCents: 1200 }),
      // Closed double-length shift with 30min unpaid meal break — 6h30 worked of 7h
      mk('WS-closed-2', TM_COOK_B, '10:00', '17:00', 2200, {
        title: 'Kitchen', unpaidBreak: ['12:00', '12:30'],
      }),
      // Overnight-kitchen style later shift
      mk('WS-closed-3', TM_BARKEEP, '17:00', '23:00', 2400, { title: 'Bartender', declaredCashCents: 3000 }),
      // Salaried-rate shift (implied hourly from annual)
      mk('WS-closed-4', TM_MANAGER_X, '09:00', '17:00', 3000, { title: 'Operations Manager', jobId: 'JOB-salary' }),
      // OPEN shift (clocked in, not yet out) — provisional cost
      mk('WS-open-1', TM_BUSBOY, '11:00', null, 1600, { title: 'Busser' }),
    ],
  };
}

/** Workweek configuration fixture (real shape verified 2026-09-06: SUN / 00:00). */
export function buildWorkweekConfigsResponse(): {
  workweek_configs: {
    id: string;
    start_of_week: string;
    start_of_day_local_time: string;
    version: number;
  }[];
} {
  return {
    workweek_configs: [
      { id: 'WWC-1', start_of_week: 'SUN', start_of_day_local_time: '00:00', version: 1 },
    ],
  };
}

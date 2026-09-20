import { describe, it, expect } from 'vitest';
import {
  buildCategoryTree,
  descendantClosure,
  computeLiquorVariationIds,
  classifyOrder,
  classifyOrders,
  sumTips,
} from './catalog';
import {
  buildCatalogResponse,
  buildOrdersResponse,
  buildPaymentsResponse,
  CAT_LIQUOR_ROOT,
  CAT_COCKTAILS,
  CAT_SPIRITS,
  CAT_BEER,
  CAT_BOTTLED_BEER,
  CAT_CANNED_BEER,
  CAT_WINE,
  CAT_FOOD,
  VAR_NEGRONI,
  VAR_BURGER,
  type SquareOrder,
} from './fixtures';

const tree = buildCategoryTree(buildCatalogResponse().objects);
const liquorClosure = descendantClosure(tree, CAT_LIQUOR_ROOT);
const liquorVariationIds = computeLiquorVariationIds(tree, liquorClosure);

// ── Category tree construction ────────────────────────────────────────────────

describe('buildCategoryTree', () => {
  it('contains all categories', () => {
    expect(tree.nodes.size).toBe(8);
    expect(tree.nodes.has(CAT_LIQUOR_ROOT)).toBe(true);
    expect(tree.nodes.has(CAT_COCKTAILS)).toBe(true);
    expect(tree.nodes.has(CAT_BEER)).toBe(true);
  });

  it('resolves parent-child relationships', () => {
    const root = tree.nodes.get(CAT_LIQUOR_ROOT)!;
    expect(root.children).toContain(CAT_COCKTAILS);
    expect(root.children).toContain(CAT_SPIRITS);

    const beer = tree.nodes.get(CAT_BEER)!;
    expect(beer.children).toContain(CAT_BOTTLED_BEER);
    expect(beer.children).toContain(CAT_CANNED_BEER);
  });

  it('maps items to their categories (multi-category membership)', () => {
    // Negroni is under Cocktails, Old Fashioned under Spirits
    expect(tree.itemToCategories.get('ITEM-negroni-001')).toContain(CAT_COCKTAILS);
    expect(tree.itemToCategories.get('ITEM-oldfas-002')).toContain(CAT_SPIRITS);
  });

  it('maps nested variations to items', () => {
    expect(tree.variationToItem.get(VAR_NEGRONI)).toBe('ITEM-negroni-001');
    expect(tree.variationToItem.get(VAR_BURGER)).toBe('ITEM-burger-005');
  });
});

// ── Descendant closure ────────────────────────────────────────────────────────

describe('descendantClosure', () => {
  it('includes the root itself', () => {
    const closure = descendantClosure(tree, CAT_LIQUOR_ROOT);
    expect(closure.has(CAT_LIQUOR_ROOT)).toBe(true);
  });

  it('includes direct children', () => {
    const closure = descendantClosure(tree, CAT_LIQUOR_ROOT);
    expect(closure.has(CAT_COCKTAILS)).toBe(true);
    expect(closure.has(CAT_SPIRITS)).toBe(true);
  });

  it('includes nested descendants (transitive)', () => {
    const closure = descendantClosure(tree, CAT_BEER);
    expect(closure.has(CAT_BEER)).toBe(true);
    expect(closure.has(CAT_BOTTLED_BEER)).toBe(true);
    expect(closure.has(CAT_CANNED_BEER)).toBe(true);
  });

  it('does NOT include siblings outside the root', () => {
    const closure = descendantClosure(tree, CAT_LIQUOR_ROOT);
    expect(closure.has(CAT_BEER)).toBe(false);
    expect(closure.has(CAT_WINE)).toBe(false);
    expect(closure.has(CAT_FOOD)).toBe(false);
  });

  it('handles a leaf category (no children)', () => {
    const closure = descendantClosure(tree, CAT_WINE);
    expect(closure.size).toBe(1);
    expect(closure.has(CAT_WINE)).toBe(true);
  });
});

// ── Liquor variation ID precomputation ───────────────────────────────────────

describe('computeLiquorVariationIds', () => {
  it('contains Negroni and Old Fashioned variations (under liquor root)', () => {
    expect(liquorVariationIds.has(VAR_NEGRONI)).toBe(true);
    // VAR_OLD_FASHIONED = 'VAR-oldfas-002'
    expect(liquorVariationIds.has('VAR-oldfas-002')).toBe(true);
  });

  it('does NOT contain beer, wine, or food variations', () => {
    expect(liquorVariationIds.has('VAR-draftbeer-003')).toBe(false);
    expect(liquorVariationIds.has('VAR-housered-004')).toBe(false);
    expect(liquorVariationIds.has(VAR_BURGER)).toBe(false);
  });

  it('works with an empty closure', () => {
    const empty = computeLiquorVariationIds(tree, new Set());
    expect(empty.size).toBe(0);
  });

  it('produces a flat set for fast membership checks', () => {
    expect(liquorVariationIds instanceof Set).toBe(true);
    expect(liquorVariationIds.size).toBe(2); // Negroni + Old Fashioned
  });
});

// ── Order line classification ────────────────────────────────────────────────

describe('classifyOrder — liquor classification', () => {
  const lunchOrders = buildOrdersResponse('lunch').orders;
  const dinnerOrders = buildOrdersResponse('dinner').orders;

  it('classifies Negroni (under Cocktails) as liquor', () => {
    const result = classifyOrder(lunchOrders[0], tree, liquorVariationIds, liquorClosure);
    const negroniLine = result.lines.find((l) =>
      l.classification === 'liquor'
    );
    expect(negroniLine).toBeDefined();
    expect(negroniLine!.isLiquor).toBe(true);
    // Negroni: gross 1400, discount 0 → net 1400
    expect(negroniLine!.netAmountCents).toBe(1400);
  });

  it('classifies Draft Beer as NON-liquor (outside the tree)', () => {
    const result = classifyOrder(lunchOrders[0], tree, liquorVariationIds, liquorClosure);
    const beerLine = result.lines.find((l) =>
      l.classification === 'non_liquor'
    );
    expect(beerLine).toBeDefined();
    expect(beerLine!.isLiquor).toBe(false);
  });

  it('computes liquor total as sum of liquor line net amounts', () => {
    const result = classifyOrder(lunchOrders[0], tree, liquorVariationIds, liquorClosure);
    // Lunch order has Negroni (1400 liquor) + Draft Beer (600 non-liquor)
    expect(result.liquorTotalCents).toBe(1400);
    expect(result.excludedCount).toBe(0);
  });

  it('classifies Old Fashioned (under Spirits, child of liquor root) as liquor', () => {
    const result = classifyOrder(dinnerOrders[0], tree, liquorVariationIds, liquorClosure);
    const oldFashionedLine = result.lines.find((l) =>
      l.classification === 'liquor' && l.netAmountCents === 1300
    );
    expect(oldFashionedLine).toBeDefined();
  });

  it('excludes House Red Wine from liquor total', () => {
    const result = classifyOrder(dinnerOrders[0], tree, liquorVariationIds, liquorClosure);
    const wineLine = result.lines.find((l) =>
      l.classification === 'non_liquor' && l.netAmountCents === 1200
    );
    expect(wineLine).toBeDefined();
    expect(wineLine!.isLiquor).toBe(false);
  });

  it('excludes Cheeseburger (Food category) from liquor total', () => {
    const result = classifyOrder(dinnerOrders[0], tree, liquorVariationIds, liquorClosure);
    const foodLine = result.lines.find((l) =>
      l.classification === 'non_liquor' && l.netAmountCents === 1500
    );
    expect(foodLine).toBeDefined();
  });

  it('dinner liquor total = Old Fashioned only (wine and food excluded)', () => {
    const result = classifyOrder(dinnerOrders[0], tree, liquorVariationIds, liquorClosure);
    // Old Fashioned: gross 1300, no discount → 1300
    expect(result.liquorTotalCents).toBe(1300);
  });
});

// ── Returns and netting ──────────────────────────────────────────────────────

describe('classifyOrder — returns and netting', () => {
  it('nets returned items as negative amounts exactly once', () => {
    const orders = buildOrdersResponse('dinner', { includeReturn: true }).orders;
    const results = classifyOrders(orders, tree, liquorVariationIds, liquorClosure);

    // Dinner order 1: Old Fashioned = +1300
    // Return order: Negroni returned = -1400
    // Net liquor total = 1300 + (-1400) = -100
    expect(results.totalLiquorCents).toBe(-100);
  });

  it('return order shows negative line amount', () => {
    const orders = buildOrdersResponse('dinner', { includeReturn: true }).orders;
    const returnOrder = orders.find((o) => o.refunds && o.refunds.length > 0);
    expect(returnOrder).toBeDefined();

    const result = classifyOrder(returnOrder!, tree, liquorVariationIds, liquorClosure);
    const returnLine = result.lines[0];
    expect(returnLine.netAmountCents).toBe(-1400);
    expect(returnLine.isLiquor).toBe(true);
  });
});

// ── Custom and unmapped lines ────────────────────────────────────────────────

describe('classifyOrder — exclusions', () => {
  it('excludes custom line items and surfaces count/value', () => {
    const orders = buildOrdersResponse('dinner', { includeCustomLine: true }).orders;
    const customOrder = orders.find((o) =>
      o.line_items.some((li) => li.is_custom_amount)
    );
    expect(customOrder).toBeDefined();

    const result = classifyOrder(customOrder!, tree, liquorVariationIds, liquorClosure);
    expect(result.excludedCount).toBe(1);
    expect(result.customLineCount).toBe(1);
    expect(result.excludedValueCents).toBe(500);
    expect(result.liquorTotalCents).toBe(0);
  });

  it('excludes lines with no catalog_object_id', () => {
    const order: SquareOrder = {
      id: 'ORD-no-cat',
      location_id: 'TEST',
      created_at: '2026-08-27T12:00:00-07:00',
      updated_at: '2026-08-27T12:00:00-07:00',
      closed_at: '2026-08-27T12:00:00-07:00',
      state: 'COMPLETED',
      total_money: { amount: 500, currency: 'USD' },
      total_tax_money: { amount: 0, currency: 'USD' },
      total_discount_money: { amount: 0, currency: 'USD' },
      total_tip_money: { amount: 0, currency: 'USD' },
      line_items: [
        {
          uid: 'LI-NOCAT',
          name: 'Mystery Item',
          quantity: '1',
          gross_sales_money: { amount: 500, currency: 'USD' },
          total_discount_money: { amount: 0, currency: 'USD' },
          total_tax_money: { amount: 0, currency: 'USD' },
          total_money: { amount: 500, currency: 'USD' },
        },
      ],
    };

    const result = classifyOrder(order, tree, liquorVariationIds, liquorClosure);
    expect(result.lines[0].excluded).toBe(true);
    expect(result.lines[0].classification).toBe('unmapped');
    expect(result.excludedCount).toBe(1);
  });

  it('excludes lines with unknown variation IDs', () => {
    const order: SquareOrder = {
      id: 'ORD-unk-var',
      location_id: 'TEST',
      created_at: '2026-08-27T12:00:00-07:00',
      updated_at: '2026-08-27T12:00:00-07:00',
      closed_at: '2026-08-27T12:00:00-07:00',
      state: 'COMPLETED',
      total_money: { amount: 800, currency: 'USD' },
      total_tax_money: { amount: 0, currency: 'USD' },
      total_discount_money: { amount: 0, currency: 'USD' },
      total_tip_money: { amount: 0, currency: 'USD' },
      line_items: [
        {
          uid: 'LI-UNK',
          name: 'Unknown Drink',
          quantity: '1',
          catalog_object_id: 'VAR-DOES-NOT-EXIST',
          gross_sales_money: { amount: 800, currency: 'USD' },
          total_discount_money: { amount: 0, currency: 'USD' },
          total_tax_money: { amount: 0, currency: 'USD' },
          total_money: { amount: 800, currency: 'USD' },
        },
      ],
    };

    const result = classifyOrder(order, tree, liquorVariationIds, liquorClosure);
    expect(result.lines[0].excluded).toBe(true);
    expect(result.lines[0].classification).toBe('unmapped_variation');
  });
});

// ── Renamed category resilience ──────────────────────────────────────────────

describe('renamed category resilience', () => {
  it('still works when the root category is renamed (ID is unchanged)', () => {
    const objects = buildCatalogResponse().objects.map((o) => {
      if (o.id === CAT_LIQUOR_ROOT && o.category_data) {
        return {
          ...o,
          category_data: { ...o.category_data, name: 'Adult Beverages' },
        };
      }
      return o;
    });

    const renamedTree = buildCategoryTree(objects);
    const closure = descendantClosure(renamedTree, CAT_LIQUOR_ROOT);
    const renamedVariationIds = computeLiquorVariationIds(renamedTree, closure);

    // The closure is by ID, not by name
    expect(closure.has(CAT_LIQUOR_ROOT)).toBe(true);
    expect(closure.has(CAT_COCKTAILS)).toBe(true);
    expect(closure.has(CAT_SPIRITS)).toBe(true);

    // Classification still works
    const orders = buildOrdersResponse('lunch').orders;
    const result = classifyOrder(orders[0], renamedTree, renamedVariationIds, closure);
    expect(result.liquorTotalCents).toBe(1400);
  });
});

// ── Aggregate ────────────────────────────────────────────────────────────────

describe('classifyOrders — aggregation', () => {
  it('aggregates liquor totals across multiple orders', () => {
    const lunch = buildOrdersResponse('lunch').orders;
    const dinner = buildOrdersResponse('dinner').orders;
    const all = [...lunch, ...dinner];

    const result = classifyOrders(all, tree, liquorVariationIds, liquorClosure);
    // Lunch: Negroni = 1400
    // Dinner: Old Fashioned = 1300
    // Total = 2700
    expect(result.totalLiquorCents).toBe(2700);
    expect(result.orders.length).toBe(2);
  });
});

// ── Tips aggregation ──────────────────────────────────────────────────────────

describe('sumTips', () => {
  it('sums tip_money for COMPLETED payments only', () => {
    const { payments } = buildPaymentsResponse('lunch');
    const total = sumTips(payments);
    // 500 + 300 = 800
    expect(total).toBe(800);
  });

  it('excludes non-COMPLETED payments', () => {
    const payments = [
      { status: 'COMPLETED', tip_money: { amount: 500 } },
      { status: 'PENDING', tip_money: { amount: 999 } },
      { status: 'APPROVED', tip_money: { amount: 777 } },
    ];
    expect(sumTips(payments)).toBe(500);
  });

  it('handles empty array', () => {
    expect(sumTips([])).toBe(0);
  });
});

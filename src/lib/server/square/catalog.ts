// Catalog taxonomy and Cocktails/Liquors liquor classifier.
//
// Implements spec §"Liquor sales: the Cocktails/Liquors tree":
//   1. Build category hierarchy from Square catalog objects.
//   2. Resolve the configured root category by immutable category ID.
//   3. Compute the descendant closure of the root.
//   4. Classify each order line item: is its category in the liquor closure?
//   5. Sum the net item-sales basis: catalog-backed line items after item and
//      order discounts, excluding taxes, service charges, and tips.
//   6. Exclude custom line items and unmapped variations.
//
// Netting rule for returns: Square reports a return as a negative line item
// in a separate order (or as a refund). Apply exactly ONE netting rule:
// sum signed line amounts. A return's negative `gross_sales_money.amount`
// naturally nets against the original positive sale. Never count both the
// original sale and the refund as separate positive amounts.

import type {
  SquareCatalogObject,
  SquareOrder,
  SquareOrderLineItem,
} from './fixtures';

// ── Category tree construction ───────────────────────────────────────────────

export interface CategoryNode {
  id: string;
  name: string;
  parentId: string | null;
  children: string[];
}

export interface CategoryTree {
  /** All categories keyed by ID. */
  nodes: Map<string, CategoryNode>;
  /** Item ID → ALL category IDs it belongs to (multi-category membership). */
  itemToCategories: Map<string, Set<string>>;
  /** Variation ID → item ID (flattened from nested variations). */
  variationToItem: Map<string, string>;
}

/**
 * Build a category tree from raw Square catalog objects. Handles the modern
 * catalog shape (verified against production):
 *   - Items carry categories: [{id, ordinal}] (multi-category membership)
 *   - Variations are nested inside item_data.variations[]
 * Also tolerates legacy shapes (item_data.category_id singular, top-level
 * ITEM_VARIATION objects) for older catalog snapshots.
 */
export function buildCategoryTree(
  objects: SquareCatalogObject[]
): CategoryTree {
  const nodes = new Map<string, CategoryNode>();
  const itemToCategories = new Map<string, Set<string>>();
  const variationToItem = new Map<string, string>();

  for (const obj of objects) {
    if (obj.is_deleted) continue;

    if (obj.type === 'CATEGORY' && obj.category_data) {
      nodes.set(obj.id, {
        id: obj.id,
        name: obj.category_data.name,
        parentId: obj.category_data.parent_category?.id ?? null,
        children: [],
      });
    } else if (obj.type === 'ITEM' && obj.item_data) {
      const cats = new Set<string>();
      // Modern: categories[] array (an item can live in multiple categories)
      for (const c of obj.item_data.categories ?? []) {
        if (c.id) cats.add(c.id);
      }
      // Legacy: singular category_id
      const legacy = (obj.item_data as { category_id?: string }).category_id;
      if (legacy) cats.add(legacy);
      if (cats.size > 0) itemToCategories.set(obj.id, cats);

      // Nested variations (real catalog embeds them in the item)
      for (const v of obj.item_data.variations ?? []) {
        if (v.is_deleted) continue;
        const itemId = v.item_variation_data?.item_id ?? obj.id;
        variationToItem.set(v.id, itemId);
      }
    } else if (obj.type === 'ITEM_VARIATION' && obj.item_variation_data) {
      // Legacy top-level variation object
      variationToItem.set(obj.id, obj.item_variation_data.item_id);
    }
  }

  // Wire up parent → children
  for (const node of nodes.values()) {
    if (node.parentId && nodes.has(node.parentId)) {
      nodes.get(node.parentId)!.children.push(node.id);
    }
  }

  return { nodes, itemToCategories, variationToItem };
}

// ── Descendant closure computation ───────────────────────────────────────────

/**
 * Compute the complete descendant closure of a root category ID. Includes
 * the root itself plus every transitive child.
 *
 * Uses iterative DFS to avoid stack overflow on deeply nested trees.
 */
export function descendantClosure(
  tree: CategoryTree,
  rootId: string
): Set<string> {
  const closure = new Set<string>();
  const stack = [rootId];

  while (stack.length > 0) {
    const id = stack.pop()!;
    if (closure.has(id)) continue;
    closure.add(id);

    const node = tree.nodes.get(id);
    if (node) {
      for (const childId of node.children) {
        stack.push(childId);
      }
    }
  }

  return closure;
}

// ── Line-item classification ────────────────────────────────────────────────

export interface LineClassificationResult {
  /** The order line item UID. */
  lineUid: string;
  /** Net amount in cents (signed — negatives are returns). */
  netAmountCents: number;
  /** Whether this line is classified as liquor. */
  isLiquor: boolean;
  /** Classification reason for audit. */
  classification: string;
  /** True if the line was excluded from the liquor total. */
  excluded: boolean;
  /** Exclusion reason, if excluded. */
  exclusionReason?: string;
}

export interface OrderClassificationResult {
  orderId: string;
  /** All line classifications. */
  lines: LineClassificationResult[];
  /** Sum of liquor lines (net, signed). */
  liquorTotalCents: number;
  /** Lines excluded from the liquor total. */
  excludedCount: number;
  /** Dollar value of excluded lines. */
  excludedValueCents: number;
  /** Count of custom/unmapped lines. */
  customLineCount: number;
}

/**
 * Precompute the set of catalog variation IDs that belong to the liquor
 * category closure. Built once at catalog-sync time from the category tree
 * and the configured root category's descendant closure.
 *
 * This flattens the variation → item → category chain into a single
 * membership set, so order-line classification is a flat `Set.has()` check
 * instead of a three-hop walk on every line.
 *
 * Spec: "every active catalog item whose category is Cocktails/Liquors or
 * any descendant of that category."
 */
export function computeLiquorVariationIds(
  tree: CategoryTree,
  liquorCategoryIds: Set<string>
): Set<string> {
  const liquorVariationIds = new Set<string>();

  // Build item → variations index once (variation lists per item)
  const itemToVariations = new Map<string, string[]>();
  for (const [variationId, itemId] of tree.variationToItem) {
    const list = itemToVariations.get(itemId);
    if (list) list.push(variationId);
    else itemToVariations.set(itemId, [variationId]);
  }

  // An item is liquor if ANY of its categories is in the closure
  // (multi-category membership).
  for (const [itemId, cats] of tree.itemToCategories) {
    let isLiquor = false;
    for (const c of cats) {
      if (liquorCategoryIds.has(c)) { isLiquor = true; break; }
    }
    if (isLiquor) {
      for (const variationId of itemToVariations.get(itemId) ?? []) {
        liquorVariationIds.add(variationId);
      }
    }
  }

  return liquorVariationIds;
}

/**
 * Classify a single order line item.
 *
 * Net amount = gross_sales_money - total_discount_money (item + order
 * discounts allocated by Square). Taxes, service charges, and tips are
 * excluded per spec.
 *
 * Returns are represented as negative gross_sales_money, so the signed
 * sum naturally nets originals against returns — applied exactly once.
 *
 * Liquor membership is a flat lookup against the precomputed
 * `liquorVariationIds` set (derived from the category closure at sync time).
 * The category tree is still consulted for audit/exclusion diagnostics.
 */
function classifyLine(
  line: SquareOrderLineItem,
  tree: CategoryTree,
  liquorVariationIds: Set<string>,
  _liquorCategoryIds: Set<string>,
): LineClassificationResult {
  // Custom line items: exclude entirely, surface for review
  if (line.is_custom_amount || line.item_type === 'CUSTOM_AMOUNT') {
    return {
      lineUid: line.uid,
      netAmountCents: line.gross_sales_money.amount - line.total_discount_money.amount,
      isLiquor: false,
      classification: 'custom_line',
      excluded: true,
      exclusionReason: 'Custom line item — not catalog-backed',
    };
  }

  const variationId = line.catalog_object_id;
  if (!variationId) {
    return {
      lineUid: line.uid,
      netAmountCents: line.gross_sales_money.amount - line.total_discount_money.amount,
      isLiquor: false,
      classification: 'unmapped',
      excluded: true,
      exclusionReason: 'No catalog_object_id on line item',
    };
  }

  // Flat membership lookup — no three-hop walk
  const isLiquor = liquorVariationIds.has(variationId);
  const netAmount = line.gross_sales_money.amount - line.total_discount_money.amount;

  // Diagnostic path for audit: classify the exclusion reason
  if (!isLiquor) {
    // Check if the variation exists at all for accurate diagnostics
    const itemId = tree.variationToItem.get(variationId);
    if (!itemId) {
      return {
        lineUid: line.uid,
        netAmountCents: netAmount,
        isLiquor: false,
        classification: 'unmapped_variation',
        excluded: true,
        exclusionReason: `Variation ${variationId} not found in catalog`,
      };
    }

    const categories = tree.itemToCategories.get(itemId);
    if (!categories || categories.size === 0) {
      return {
        lineUid: line.uid,
        netAmountCents: netAmount,
        isLiquor: false,
        classification: 'uncategorized_item',
        excluded: true,
        exclusionReason: `Item ${itemId} has no category`,
      };
    }

    // Known variation, known category, just not in the liquor tree
    return {
      lineUid: line.uid,
      netAmountCents: netAmount,
      isLiquor: false,
      classification: 'non_liquor',
      excluded: false,
    };
  }

  return {
    lineUid: line.uid,
    netAmountCents: netAmount,
    isLiquor: true,
    classification: 'liquor',
    excluded: false,
  };
}

/**
 * Classify all line items in an order and compute the net liquor total.
 *
 * Accepts the precomputed `liquorVariationIds` set (flat membership by
 * variation ID, derived from the category closure) plus the original
 * `liquorCategoryIds` closure for audit diagnostics.
 *
 * Applies exactly one netting rule: signed sum of `gross_sales_money -
 * total_discount_money` for each classified liquor line. Negative values
 * from returns naturally reduce the total.
 */
export function classifyOrder(
  order: SquareOrder,
  tree: CategoryTree,
  liquorVariationIds: Set<string>,
  liquorCategoryIds: Set<string>,
): OrderClassificationResult {
  const lines: LineClassificationResult[] = [];
  let liquorTotalCents = 0;
  let excludedCount = 0;
  let excludedValueCents = 0;
  let customLineCount = 0;

  for (const line of order.line_items ?? []) {
    const cls = classifyLine(line, tree, liquorVariationIds, liquorCategoryIds);
    lines.push(cls);

    if (cls.excluded) {
      excludedCount++;
      excludedValueCents += Math.abs(cls.netAmountCents);
      if (cls.classification === 'custom_line') customLineCount++;
    } else if (cls.isLiquor) {
      liquorTotalCents += cls.netAmountCents;
    }
  }

  return {
    orderId: order.id,
    lines,
    liquorTotalCents,
    excludedCount,
    excludedValueCents,
    customLineCount,
  };
}

/**
 * Classify multiple orders and aggregate the total liquor sales.
 *
 * Returns per-order breakdowns plus the aggregate net liquor total.
 */
export interface AggregateLiquorResult {
  orders: OrderClassificationResult[];
  totalLiquorCents: number;
  totalExcludedCount: number;
  totalExcludedValueCents: number;
  totalCustomLineCount: number;
}

export function classifyOrders(
  orders: SquareOrder[],
  tree: CategoryTree,
  liquorVariationIds: Set<string>,
  liquorCategoryIds: Set<string>,
): AggregateLiquorResult {
  const orderResults = orders.map((o) =>
    classifyOrder(o, tree, liquorVariationIds, liquorCategoryIds),
  );

  return {
    orders: orderResults,
    totalLiquorCents: orderResults.reduce((sum, o) => sum + o.liquorTotalCents, 0),
    totalExcludedCount: orderResults.reduce((sum, o) => sum + o.excludedCount, 0),
    totalExcludedValueCents: orderResults.reduce((sum, o) => sum + o.excludedValueCents, 0),
    totalCustomLineCount: orderResults.reduce((sum, o) => sum + o.customLineCount, 0),
  };
}

// ── Tips aggregation ────────────────────────────────────────────────────────

/**
 * Sum `Payment.tip_money.amount` for COMPLETED payments only.
 *
 * Spec: "Sum `Payment.tip_money.amount` in cents. Do not derive tips from
 * order totals because Square records tips at the payment level. Do not
 * treat `total_money` as tips."
 */
export function sumTips(
  payments: { status: string; tip_money: { amount: number } }[]
): number {
  return payments
    .filter((p) => p.status === 'COMPLETED')
    .reduce((sum, p) => sum + p.tip_money.amount, 0);
}

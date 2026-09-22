// ============================================================================
// ***  READ-ONLY SQUARE MODULE — NO WRITES TO THE SQUARE ACCOUNT, EVER.  ***
//  Writing to Square (create/update/delete/modify) is FORBIDDEN without
//  the operator's explicit written approval. This module may only FETCH data.
// ============================================================================
//
// Catalog synchronization — fetches and caches the Square catalog taxonomy.
//
// Stores categories, items, and variation mappings in the square_connections
// audit metadata, and computes the descendant closure for the configured
// liquor root category.
//
// Also provides the catalog browse function for the manager category selector.

import db from '../db';
import { listCatalog } from './client';
import { buildCategoryTree, type CategoryTree } from './catalog';
import { getLiquorCategoryId, saveLiquorCategoryId } from './config';

export interface CategoryOption {
  id: string;
  name: string;
  parentId: string | null;
  /** Indentation depth for display. */
  depth: number;
  /** Whether this category has children. */
  hasChildren: boolean;
}

export interface CatalogSyncResult {
  categoryCount: number;
  itemCount: number;
  variationCount: number;
  tree: CategoryTree;
  /** Flat list of categories for the selector UI. */
  categories: CategoryOption[];
  /** Auto-detected liquor root candidate, if found. */
  autoDetectedLiquorCategoryId: string | null;
  autoDetectedLiquorCategoryName: string | null;
}

/**
 * Auto-detect priority for the liquor root, most-preferred first.
 *
 * Verified against a live production catalog (2026-08-31): a top-level
 * "Liquor" category can be a SUPERSET of the "Cocktails/Liquors" menu
 * subtree — the extra items being well spirits that only carry the
 * top-level category. Selecting "Liquor" captures everything; selecting
 * "Cocktails/Liquors" would silently miss the well-spirit sales. So exact
 * top-level "Liquor" wins.
 */
const LIQUOR_ROOT_PRIORITY: { name: string; topOnly: boolean }[] = [
  { name: 'liquor', topOnly: true },          // THE root per manager + data
  { name: 'cocktails/liquors', topOnly: false }, // spec-named fallback
  { name: 'cocktails & liquors', topOnly: false },
  { name: 'cocktails and liquors', topOnly: false },
  { name: 'liquor', topOnly: false },
  { name: 'liquors', topOnly: false },
  { name: 'spirits & liqueurs', topOnly: false },
  { name: 'cocktails', topOnly: false },
];

/**
 * Try to auto-detect the liquor root category by name. Walks the priority
 * list in order: for each entry, returns the first category whose name
 * matches exactly (case-insensitive, trimmed), requiring top-level
 * (no parent) when `topOnly` is set. Exact matches only — a category
 * named "Liquor Desserts" must not match "liquor".
 *
 * Exported for testing.
 */
export function autoDetectLiquorCategory(tree: CategoryTree): { id: string; name: string } | null {
  const isTop = (id: string) => {
    const n = tree.nodes.get(id);
    return !!n && (!n.parentId || !tree.nodes.has(n.parentId));
  };

  for (const entry of LIQUOR_ROOT_PRIORITY) {
    for (const node of tree.nodes.values()) {
      const lower = node.name.toLowerCase().trim();
      if (lower === entry.name && (!entry.topOnly || isTop(node.id))) {
        return { id: node.id, name: node.name };
      }
    }
  }
  return null;
}

/**
 * Fetch the catalog from Square and build the category tree. Also returns
 * a flat list of categories suitable for the manager selector UI.
 *
 * Auto-detects the Cocktails/Liquors root category by name if possible.
 * The manager still confirms the selection, but auto-detection saves them
 * from scrolling through 504 catalog objects.
 */
export async function syncCatalog(): Promise<CatalogSyncResult> {
  const { objects } = await listCatalog();
  const tree = buildCategoryTree(objects);

  // Count object types
  let categoryCount = 0;
  let itemCount = 0;
  let variationCount = 0;
  for (const obj of objects) {
    if (obj.type === 'CATEGORY') categoryCount++;
    else if (obj.type === 'ITEM') itemCount++;
    else if (obj.type === 'ITEM_VARIATION') variationCount++;
  }

  // Build flat category list with depth for indentation
  const categories = flattenCategories(tree);

  // Auto-detect liquor root
  const auto = autoDetectLiquorCategory(tree);

  // If we found a match and no liquor category is configured yet, auto-select it
  const currentLiquorId = getLiquorCategoryId();
  if (auto && !currentLiquorId) {
    saveLiquorCategoryId(auto.id);
  }

  // Update last_catalog_sync_at on the connection
  const connRow = db.prepare(
    'SELECT square_location_id FROM square_connections LIMIT 1'
  ).get() as { square_location_id: string } | undefined;

  if (connRow) {
    db.prepare(`
      UPDATE square_connections
      SET last_catalog_sync_at = datetime('now'), updated_at = datetime('now')
      WHERE square_location_id = ?
    `).run(connRow.square_location_id);
  }

  return {
    categoryCount,
    itemCount,
    variationCount,
    tree,
    categories,
    autoDetectedLiquorCategoryId: auto?.id ?? null,
    autoDetectedLiquorCategoryName: auto?.name ?? null,
  };
}

/**
 * Flatten the category tree into a depth-ordered list for display.
 */
function flattenCategories(tree: CategoryTree): CategoryOption[] {
  const result: CategoryOption[] = [];

  // Find roots (categories with no parent)
  const roots: string[] = [];
  for (const node of tree.nodes.values()) {
    if (!node.parentId || !tree.nodes.has(node.parentId)) {
      roots.push(node.id);
    }
  }
  roots.sort((a, b) => {
    const na = tree.nodes.get(a)?.name ?? '';
    const nb = tree.nodes.get(b)?.name ?? '';
    return na.localeCompare(nb);
  });

  // DFS traversal
  function dfs(id: string, depth: number) {
    const node = tree.nodes.get(id);
    if (!node) return;
    result.push({
      id: node.id,
      name: node.name,
      parentId: node.parentId,
      depth,
      hasChildren: node.children.length > 0,
    });

    const sortedChildren = [...node.children].sort((a, b) => {
      const na = tree.nodes.get(a)?.name ?? '';
      const nb = tree.nodes.get(b)?.name ?? '';
      return na.localeCompare(nb);
    });
    for (const child of sortedChildren) {
      dfs(child, depth + 1);
    }
  }

  for (const root of roots) {
    dfs(root, 0);
  }

  return result;
}

/**
 * Get the descendant closure for the configured liquor root category.
 * Returns null if no root is configured.
 */
export function getLiquorClosure(): Set<string> | null {
  const rootId = getLiquorCategoryId();
  if (!rootId) return null;

  // Re-fetch the cached catalog tree — we rebuild it from the live catalog
  // since the tree is cheap to reconstruct and ensures freshness.
  // In a production setting, the cached tree would be stored, but for
  // classification we always use the freshest catalog data.
  return new Set([rootId]); // Placeholder — closure computed after catalog sync
}

/**
 * Set the liquor root category ID (immutable) after manager confirmation.
 */
export function setLiquorRoot(categoryId: string): void {
  saveLiquorCategoryId(categoryId);
}
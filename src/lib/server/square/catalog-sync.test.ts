import { describe, it, expect } from 'vitest';
import { buildCategoryTree } from './catalog';
import { autoDetectLiquorCategory } from './catalog-sync';
import {
  buildCatalogResponse,
  type SquareCatalogObject,
} from './fixtures';

// ── Real-world fork: top-level "Liquor" vs nested "Cocktails/Liquors" ────────
//
// Verified against a live production catalog 2026-08-31: a catalog can have
// BOTH a top-level "Liquor" (superset incl. well spirits) and a
// "Cocktails/Liquors" subtree under "Full Menu". The top-level
// "Liquor" must win — it contains everything the subtree does plus the
// well spirits that only carry the top-level category.

const realWorldObjects: SquareCatalogObject[] = [
  { type: 'CATEGORY', id: 'CAT_FULL_MENU', category_data: { name: 'Full Menu' } },
  { type: 'CATEGORY', id: 'CAT_LIQUOR_TOP', category_data: { name: 'Liquor' } },
  { type: 'CATEGORY', id: 'CAT_CK_LIQUORS', category_data: { name: 'Cocktails/Liquors', parent_category: { id: 'CAT_FULL_MENU' } } },
  { type: 'CATEGORY', id: 'CAT_CLASSIC_CK', category_data: { name: 'Classic Cocktails', parent_category: { id: 'CAT_CK_LIQUORS' } } },
  { type: 'CATEGORY', id: 'CAT_BEER', category_data: { name: 'Beer' } },
  { type: 'CATEGORY', id: 'CAT_WINE', category_data: { name: 'Wine' } },
];

describe('autoDetectLiquorCategory — priority order', () => {
  it('prefers top-level "Liquor" over nested "Cocktails/Liquors" (real catalog shape)', () => {
    const tree = buildCategoryTree(realWorldObjects);
    const found = autoDetectLiquorCategory(tree);
    expect(found).not.toBeNull();
    expect(found!.id).toBe('CAT_LIQUOR_TOP');
    expect(found!.name).toBe('Liquor');
  });

  it('falls back to "Cocktails/Liquors" when no top-level "Liquor" exists', () => {
    const noTop = realWorldObjects.filter((o) => o.id !== 'CAT_LIQUOR_TOP');
    const tree = buildCategoryTree(noTop);
    const found = autoDetectLiquorCategory(tree);
    expect(found).not.toBeNull();
    expect(found!.id).toBe('CAT_CK_LIQUORS');
  });

  it('matches case-insensitively with trimmed whitespace', () => {
    const noisy: SquareCatalogObject[] = [
      { type: 'CATEGORY', id: 'CAT_X', category_data: { name: '  liquor  ' } },
    ];
    const tree = buildCategoryTree(noisy);
    expect(autoDetectLiquorCategory(tree)?.id).toBe('CAT_X');
  });

  it('does NOT match substring-only names ("Liquor Desserts")', () => {
    const trap: SquareCatalogObject[] = [
      { type: 'CATEGORY', id: 'CAT_TRAP', category_data: { name: 'Liquor Desserts' } },
    ];
    const tree = buildCategoryTree(trap);
    expect(autoDetectLiquorCategory(tree)).toBeNull();
  });

  it('does NOT match nested "liquor" when topOnly is required and only nested exists... unless fallback allows', () => {
    // 'liquor' topOnly=true is priority 1; a NESTED 'Liquor' should not win
    // priority 1 but CAN win via the non-topOnly 'liquor' entry (priority 5).
    const nestedOnly: SquareCatalogObject[] = [
      { type: 'CATEGORY', id: 'CAT_PARENT', category_data: { name: 'Beverages' } },
      { type: 'CATEGORY', id: 'CAT_NESTED', category_data: { name: 'Liquor', parent_category: { id: 'CAT_PARENT' } } },
    ];
    const tree = buildCategoryTree(nestedOnly);
    const found = autoDetectLiquorCategory(tree);
    expect(found?.id).toBe('CAT_NESTED'); // still detected via the fallback entry
  });

  it('returns null when nothing matches', () => {
    const none: SquareCatalogObject[] = [
      { type: 'CATEGORY', id: 'CAT_FOOD', category_data: { name: 'Food' } },
    ];
    expect(autoDetectLiquorCategory(buildCategoryTree(none))).toBeNull();
  });

  it('finds the fixture catalog root ("Cocktails/Liquors" top-level)', () => {
    const tree = buildCategoryTree(buildCatalogResponse().objects);
    const found = autoDetectLiquorCategory(tree);
    expect(found?.name).toBe('Cocktails/Liquors');
  });
});

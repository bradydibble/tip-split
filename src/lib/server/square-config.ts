// Re-export barrel: the canonical Square config lives in ./square/config.ts.
// This file ensures backwards-compatible imports from `$lib/server/square-config`.
export {
  loadSquareConfig,
  isSquareConfigured,
  saveSquareLocation,
  saveLiquorCategoryId,
  getLiquorCategoryId,
  type SquareConfig,
} from './square/config';

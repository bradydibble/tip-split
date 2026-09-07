import { describe, it, expect } from 'vitest';
import type { ActionResult } from '@sveltejs/kit';
import { interpretActionResult } from './adjust-result';

// These fixtures are the real envelopes captured from a running dev server by
// POSTing to `/calculate/151?/adjust`. The important, non-obvious property they
// encode: a SvelteKit form action answers a `fetch()` POST with HTTP 200 for
// EVERY outcome — success and `fail()` alike — so `res.ok` cannot distinguish
// them. Only `result.type` can.

describe('interpretActionResult', () => {
  it('treats a redirect as applied (the action committed and wants a reload)', () => {
    const result: ActionResult = { type: 'redirect', status: 303, location: '/calculate/151' };
    expect(interpretActionResult(result)).toEqual({ kind: 'applied' });
  });

  it('treats a plain success as applied', () => {
    const result: ActionResult = { type: 'success', status: 200 };
    expect(interpretActionResult(result)).toEqual({ kind: 'applied' });
  });

  // Regression: this arrived over the wire as HTTP 200, so the old
  // `if (res.ok)` branch closed the modal and reloaded as if it had worked.
  // The adjustment was never applied and the user was told nothing.
  it('treats a 409 failure as rejected and surfaces the server message', () => {
    const result: ActionResult = {
      type: 'failure',
      status: 409,
      data: {
        error:
          'This person already has an adjustment for this shift. Void the calculation and re-enter it to change it.',
      },
    };
    expect(interpretActionResult(result)).toEqual({
      kind: 'rejected',
      message:
        'This person already has an adjustment for this shift. Void the calculation and re-enter it to change it.',
    });
  });

  it('treats a 403 failure as rejected and surfaces the server message', () => {
    const result: ActionResult = {
      type: 'failure',
      status: 403,
      data: { error: 'Manager access required' },
    };
    expect(interpretActionResult(result)).toEqual({
      kind: 'rejected',
      message: 'Manager access required',
    });
  });

  it('falls back to a generic message when a failure carries no error text', () => {
    const result: ActionResult = { type: 'failure', status: 400, data: undefined };
    expect(interpretActionResult(result)).toEqual({
      kind: 'rejected',
      message: 'Could not apply the adjustment. Please try again.',
    });
  });

  it('treats a thrown server error as rejected', () => {
    const result: ActionResult = {
      type: 'error',
      status: 500,
      error: { message: 'Internal Error' },
    };
    expect(interpretActionResult(result)).toEqual({
      kind: 'rejected',
      message: 'Internal Error',
    });
  });
});

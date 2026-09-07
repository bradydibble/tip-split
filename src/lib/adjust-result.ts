import type { ActionResult } from '@sveltejs/kit';

/**
 * What a form action's response means to the UI.
 *
 * `applied` — the action committed; refresh the page data.
 * `rejected` — nothing changed; show `message` and keep the form open.
 */
export type ActionOutcome =
  | { kind: 'applied' }
  | { kind: 'rejected'; message: string };

const GENERIC_FAILURE = 'Could not apply the adjustment. Please try again.';

/**
 * Classify a SvelteKit `ActionResult`.
 *
 * Why this exists: a form action answers with HTTP 200 for *every* outcome —
 * a `redirect`, a `success`, and a `fail()` all come back 200 with the real
 * outcome in a JSON envelope. Branching on `response.ok` therefore reports
 * every rejection as a success. Only `result.type` carries the truth.
 */
export function interpretActionResult(result: ActionResult): ActionOutcome {
  switch (result.type) {
    case 'success':
    case 'redirect':
      return { kind: 'applied' };
    case 'failure':
      return { kind: 'rejected', message: failureMessage(result.data) };
    case 'error':
      return { kind: 'rejected', message: result.error?.message || GENERIC_FAILURE };
  }
}

/** `fail(status, { error })` is this app's convention for action rejections. */
function failureMessage(data: Record<string, unknown> | undefined): string {
  const error = data?.error;
  return typeof error === 'string' && error.length > 0 ? error : GENERIC_FAILURE;
}

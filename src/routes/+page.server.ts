import type { Actions, PageServerLoad } from './$types';
import { fail, redirect } from '@sveltejs/kit';
import { findUserByPin, createSession } from '$lib/server/auth';

export const load: PageServerLoad = ({ locals }) => {
  if (locals.user) redirect(303, '/calculate');
  return {};
};

export const actions: Actions = {
  default: async ({ request, cookies, locals }) => {
    if (locals.user) redirect(303, '/calculate');

    const pin = String((await request.formData()).get('pin') ?? '').trim();

    if (pin.length < 4) return fail(400, { error: 'PIN must be at least 4 digits' });

    const user = await findUserByPin(pin);
    if (!user) return fail(401, { error: 'Incorrect PIN — try again' });

    const sessionId = createSession(user.id);
    cookies.set('session', sessionId, {
      path: '/',
      httpOnly: true,
      sameSite: 'strict',
      maxAge: 60 * 60 * 24,
      secure: process.env.NODE_ENV === 'production',
    });

    redirect(303, '/calculate');
  },
};

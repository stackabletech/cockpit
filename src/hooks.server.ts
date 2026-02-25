import { paraglideMiddleware } from '$lib/paraglide/server';
import { building } from '$app/environment';
import { redirect, type Handle } from '@sveltejs/kit';
import { sequence } from '@sveltejs/kit/hooks';
import { svelteKitHandler } from 'better-auth/svelte-kit';
import { auth } from '$lib/server/auth';

const handleParaglide: Handle = ({ event, resolve }) =>
  paraglideMiddleware(event.request, ({ request, locale }) => {
    event.request = request;

    return resolve(event, {
      transformPageChunk: ({ html }) => html.replace('%paraglide.lang%', locale)
    });
  });

const handleAuth: Handle = ({ event, resolve }) =>
  svelteKitHandler({ event, resolve, auth, building });

const PUBLIC_PATHS = ['/auth/login', '/auth/logout', '/api/auth'];

const handleAuthGuard: Handle = async ({ event, resolve }) => {
  const session = await auth.api.getSession({ headers: event.request.headers });
  event.locals.user = session?.user ?? null;
  event.locals.session = session?.session ?? null;

  const isPublic = PUBLIC_PATHS.some((p) => event.url.pathname.startsWith(p));
  if (!isPublic && !event.locals.user) {
    const redirectTo = encodeURIComponent(event.url.pathname + event.url.search);
    throw redirect(302, `/auth/login?redirectTo=${redirectTo}`);
  }

  return resolve(event);
};

export const handle = sequence(handleParaglide, handleAuth, handleAuthGuard);

import { redirect } from '@sveltejs/kit';
import { env } from '$env/dynamic/private';
import type { PageServerLoad } from './$types';

// better-auth 1.5 rejects percent-encoded relative callback URLs.
function resolveRedirectTo(value: string | null, baseUrl: string): string {
  const home = new URL('/', baseUrl);

  if (!value) {
    return home.href;
  }

  try {
    const target = new URL(value, home);
    return target.origin === home.origin ? target.href : home.href;
  } catch {
    return home.href;
  }
}

export const load: PageServerLoad = async ({ locals, url }) => {
  if (locals.user) {
    throw redirect(302, '/');
  }

  return {
    redirectTo: resolveRedirectTo(
      url.searchParams.get('redirectTo'),
      env.STACKABLE_COCKPIT_BASE_URL ?? url.origin
    )
  };
};

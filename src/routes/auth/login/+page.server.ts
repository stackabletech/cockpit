import { redirect } from '@sveltejs/kit';
import type { PageServerLoad } from './$types';

function sanitiseRedirectTo(value: string | null): string {
  if (!value || !value.startsWith('/') || value.startsWith('//')) {
    return '/';
  }
  return value;
}

export const load: PageServerLoad = async ({ locals, url }) => {
  if (locals.user) {
    throw redirect(302, '/');
  }

  const redirectTo = sanitiseRedirectTo(url.searchParams.get('redirectTo'));

  return { redirectTo };
};

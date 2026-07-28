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

  const raw = url.searchParams.get('redirectTo');
  const redirectTo = sanitiseRedirectTo(raw);
  // Resolve relative path against the request origin so Better Auth
  // validates it as an absolute URL (comparing origins only), avoiding
  // its restrictive relative-path regex which rejects % in the path.
  const abs = redirectTo.startsWith('/') ? new URL(redirectTo, url.origin).href : redirectTo;

  return { redirectTo: abs };
};

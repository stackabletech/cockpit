import type { PageServerLoad } from './$types';

export const load: PageServerLoad = async ({ params }) => {
  const prefix = params.prefix ? params.prefix + '/' : '';
  const bucket = params.bucket;
  return { bucket, prefix };
};

import { register } from '$lib/server/metrics';
import type { RequestHandler } from './$types';

export const GET: RequestHandler = async () => {
  return new Response(await register.metrics(), {
    headers: { 'Content-Type': register.contentType }
  });
};

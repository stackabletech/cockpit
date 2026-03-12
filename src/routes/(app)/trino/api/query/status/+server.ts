import { json } from '@sveltejs/kit';
import { getUserId, getQuerySnapshot } from '$lib/server/query-store.js';
import type { RequestHandler } from './$types';

export const GET: RequestHandler = async ({ url, locals }) => {
  const userId = getUserId(locals);
  const trinoQueryId = url.searchParams.get('queryId') ?? undefined;
  const snapshot = getQuerySnapshot(userId, trinoQueryId);

  if (!snapshot) return json(null);
  return json(snapshot);
};

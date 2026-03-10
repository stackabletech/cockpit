import { fail } from '@sveltejs/kit';
import { superValidate, message } from 'sveltekit-superforms';
import { zod4 as zod } from 'sveltekit-superforms/adapters';
import * as m from '$lib/paraglide/messages.js';
import {
  trinoFetch,
  evictStale,
  queryCache,
  POLL_TIMEOUT_MS,
  MAX_CACHED_ROWS,
  type AuthConfig,
  type TrinoColumn,
  type TrinoResponse
} from '$lib/server/trino.js';
import { QuerySchema, PaginateSchema, type FormMessage } from './schemas.js';
import type { Actions, PageServerLoad } from './$types';

export const load: PageServerLoad = async ({ locals }) => {
  locals.logger.debug('loading Trino page');
  const [queryForm, paginateForm] = await Promise.all([
    superValidate(zod(QuerySchema)),
    superValidate(zod(PaginateSchema))
  ]);
  return { queryForm, paginateForm };
};

export const actions: Actions = {
  query: async ({ request, locals }) => {
    const log = locals.logger;
    const form = await superValidate(request, zod(QuerySchema));

    if (!form.valid) {
      log.debug({ errors: form.errors }, 'query form validation failed');
      return fail(400, { form });
    }

    const {
      sql,
      pageSize,
      connectionUrl,
      authType,
      authUsername,
      authPassword,
      defaultCatalog,
      defaultSchema,
      impersonation
    } = form.data;
    const auth: AuthConfig =
      authType === 'basic'
        ? { type: 'basic', username: authUsername, password: authPassword }
        : { type: 'none' };
    const impersonateUser =
      impersonation && locals.user?.username ? locals.user.username : undefined;

    evictStale();

    const queryStart = Date.now();
    log.info({ trino_url: connectionUrl }, 'executing query');

    const deadline = queryStart + POLL_TIMEOUT_MS;
    let columns: TrinoColumn[] = [];
    const rows: unknown[][] = [];
    let nextUri: string | undefined = `${connectionUrl}/v1/statement`;
    const contextHeaders: Record<string, string> = {};
    if (defaultCatalog) contextHeaders['X-Trino-Catalog'] = defaultCatalog;
    if (defaultSchema) contextHeaders['X-Trino-Schema'] = defaultSchema;

    let fetchOptions: RequestInit = {
      method: 'POST',
      body: sql.replace(/;\s*$/, '').trim(),
      headers: { 'Content-Type': 'text/plain', ...contextHeaders }
    };

    try {
      while (nextUri && rows.length < MAX_CACHED_ROWS) {
        if (Date.now() > deadline) {
          log.info({ trino_url: connectionUrl, timeout_ms: POLL_TIMEOUT_MS }, 'query timed out');
          return message(
            form,
            { type: 'error', message: m.trino_query_timeout() } satisfies FormMessage,
            { status: 408 }
          );
        }

        const response: TrinoResponse = await trinoFetch(
          nextUri,
          auth,
          fetchOptions,
          impersonateUser
        );

        if (response.error) {
          log.info({ err: response.error }, 'query error');
          return message(
            form,
            { type: 'error', message: response.error.message } satisfies FormMessage,
            { status: 400 }
          );
        }

        if (response.columns && columns.length === 0) columns = response.columns;
        if (response.data) rows.push(...response.data);

        nextUri = response.nextUri;
        // Subsequent requests are GETs to the nextUri
        fetchOptions = {};
      }

      const queryId = crypto.randomUUID();
      queryCache.set(queryId, { columns, rows, createdAt: Date.now() });

      log.info(
        {
          query_id: queryId,
          rows: rows.length,
          cols: columns.length,
          duration_ms: Date.now() - queryStart
        },
        'query complete'
      );

      return message(form, {
        type: 'result',
        queryId,
        columns,
        rows: rows.slice(0, pageSize),
        hasMore: rows.length > pageSize,
        totalRows: rows.length
      } satisfies FormMessage);
    } catch (err) {
      log.error({ err, trino_url: connectionUrl }, 'unexpected error');
      const msg = err instanceof Error ? err.message : m.trino_unknown_error();
      return message(form, { type: 'error', message: msg } satisfies FormMessage, { status: 500 });
    }
  },

  paginate: async ({ request, locals }) => {
    const log = locals.logger;
    const form = await superValidate(request, zod(PaginateSchema));

    if (!form.valid) {
      return fail(400, { form });
    }

    const { queryId, page, pageSize } = form.data;
    const cached = queryCache.get(queryId);

    if (!cached) {
      log.info({ query_id: queryId }, 'cache miss (session expired)');
      return message(form, { type: 'error', message: 'session_expired' } satisfies FormMessage, {
        status: 404
      });
    }

    const start = page * pageSize;
    log.debug({ query_id: queryId, page, page_size: pageSize }, 'cache hit');

    return message(form, {
      type: 'result',
      queryId,
      columns: cached.columns,
      rows: cached.rows.slice(start, start + pageSize),
      hasMore: start + pageSize < cached.rows.length,
      totalRows: cached.rows.length
    } satisfies FormMessage);
  }
};

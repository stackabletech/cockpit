// Monaco CompletionItemProvider for the 'trinosql' language.
//
// Runs on every keystroke (via Monaco's quickSuggestions). Uses
// analyseCompletion() for grammar-driven keywords and identifier classification,
// then calls /trino/completion/metadata for live catalog/schema/table/column
// names (with a short in-memory client cache).

import type * as Monaco from 'monaco-editor';
import { analyseCompletion, type RelationAlias } from './completion.js';
import {
  categoryForKind,
  rankOf,
  recordUse,
  sortPrefixForRank,
  type HistoryCategory
} from './completion-history.js';
import * as m from '$lib/paraglide/messages.js';

const RECORD_USE_COMMAND = 'stackable.completion.recordUse';
let recordUseCommandRegistered = false;

function ensureRecordUseCommandRegistered(monaco: typeof Monaco): void {
  if (recordUseCommandRegistered) return;
  recordUseCommandRegistered = true;
  monaco.editor.registerCommand(RECORD_USE_COMMAND, (_accessor, category, label) => {
    if (typeof category === 'string' && typeof label === 'string') {
      recordUse(category as HistoryCategory, label);
    }
  });
}

export interface CompletionDefaults {
  catalog?: string;
  schema?: string;
}

type DefaultsGetter = () => CompletionDefaults;

// --- client-side metadata cache ---------------------------------------------

export type TableKind = 'table' | 'view' | 'materialized_view';

export interface TableEntry {
  name: string;
  kind: TableKind;
}

interface CacheEntry<T> {
  value: T;
  expiresAt: number;
}

const CLIENT_CACHE_TTL_MS = 5_000;
const CLIENT_CACHE_SWEEP_MS = 5 * 60_000;
const clientCache = new Map<string, CacheEntry<unknown> | Promise<unknown>>();

// Periodic sweep of expired entries to prevent unbounded growth.
if (typeof setInterval !== 'undefined') {
  setInterval(() => {
    const now = Date.now();
    for (const [key, entry] of clientCache.entries()) {
      if (!(entry instanceof Promise) && entry.expiresAt <= now) {
        clientCache.delete(key);
      }
    }
  }, CLIENT_CACHE_SWEEP_MS);
}

type NameLevel = 'catalogs' | 'schemas' | 'columns' | 'functions';

async function fetchCached<T>(cacheKey: string, qs: URLSearchParams, empty: T): Promise<T> {
  const now = Date.now();
  const hit = clientCache.get(cacheKey);
  if (hit) {
    if (hit instanceof Promise) return hit as Promise<T>;
    if (hit.expiresAt > now) return hit.value as T;
  }

  const promise = (async () => {
    const res = await fetch(`/trino/completion/metadata?${qs.toString()}`);
    if (!res.ok) return empty;
    const value = (await res.json()) as T;
    clientCache.set(cacheKey, { value, expiresAt: Date.now() + CLIENT_CACHE_TTL_MS });
    return value;
  })();

  clientCache.set(cacheKey, promise);
  try {
    return await promise;
  } catch {
    clientCache.delete(cacheKey);
    return empty;
  }
}

async function fetchNames(params: {
  level: NameLevel;
  catalog?: string;
  schema?: string;
  table?: string;
}): Promise<string[]> {
  const key = `${params.level}:${params.catalog ?? ''}:${params.schema ?? ''}:${params.table ?? ''}`;
  const qs = new URLSearchParams({ level: params.level });
  if (params.catalog) qs.set('catalog', params.catalog);
  if (params.schema) qs.set('schema', params.schema);
  if (params.table) qs.set('table', params.table);
  return fetchCached<string[]>(key, qs, []);
}

async function fetchTables(catalog: string, schema: string): Promise<TableEntry[]> {
  const key = `tables:${catalog}:${schema}:`;
  const qs = new URLSearchParams({ level: 'tables', catalog, schema });
  return fetchCached<TableEntry[]>(key, qs, []);
}

// --- item builders ----------------------------------------------------------

function makeItem(
  monaco: typeof Monaco,
  label: string,
  kind: Monaco.languages.CompletionItemKind,
  range: Monaco.IRange,
  detail: string,
  sortPrefix: string
): Monaco.languages.CompletionItem {
  return decorateWithHistory(monaco, {
    label,
    kind,
    insertText: label,
    range,
    detail,
    sortText: `${sortPrefix}${label}`
  });
}

/** Bias `sortText` for items in the user's recently-used list of their kind,
 *  and attach a Monaco command that records each acceptance into the LRU. */
function decorateWithHistory(
  monaco: typeof Monaco,
  item: Monaco.languages.CompletionItem
): Monaco.languages.CompletionItem {
  const category = categoryForKind(monaco, item.kind);
  if (!category) return item;
  const label = typeof item.label === 'string' ? item.label : item.label.label;
  const rank = rankOf(category, label);
  if (rank !== null) {
    item.sortText = `${sortPrefixForRank(rank)}${label}`;
  }
  item.command = {
    id: RECORD_USE_COMMAND,
    title: '',
    arguments: [category, label]
  };
  return item;
}

// --- provider ---------------------------------------------------------------

export function createCompletionProvider(
  monaco: typeof Monaco,
  getDefaults: DefaultsGetter
): Monaco.languages.CompletionItemProvider {
  return {
    triggerCharacters: ['.', ' ', ',', '('],

    async provideCompletionItems(model, position) {
      ensureRecordUseCommandRegistered(monaco);
      const sql = model.getValue();
      const cursorOffset = model.getOffsetAt(position);
      const ctx = analyseCompletion({ sql, cursorOffset });

      const word = model.getWordUntilPosition(position);
      const range: Monaco.IRange = {
        startLineNumber: position.lineNumber,
        endLineNumber: position.lineNumber,
        startColumn: word.startColumn,
        endColumn: word.endColumn
      };

      const suggestions: Monaco.languages.CompletionItem[] = [];
      const defaults = getDefaults();

      // --- Identifier suggestions (catalog → schema → table → column) -------
      if (ctx.identifierKind === 'relation') {
        await appendRelationItems(monaco, suggestions, range, ctx.prefixParts, defaults);
      } else if (ctx.identifierKind === 'column') {
        await appendColumnItems(
          monaco,
          suggestions,
          range,
          ctx.prefixParts,
          ctx.aliasMap,
          defaults
        );
      }

      // --- Keyword suggestions ---------------------------------------------
      // Suppress keywords when the user is resolving a dotted path (`a.b.|`)
      // because keywords don't appear after a dot.
      if (ctx.prefixParts.length === 0) {
        for (const kw of ctx.keywords) {
          suggestions.push(
            makeItem(
              monaco,
              kw,
              monaco.languages.CompletionItemKind.Keyword,
              range,
              m.completion_detail_keyword(),
              '3_'
            )
          );
        }
      }

      return { suggestions };
    }
  };
}

/** Pick (icon, detail) for a relation completion based on its kind. */
function relationKindPresentation(
  monaco: typeof Monaco,
  kind: TableKind,
  path: string
): { completionKind: Monaco.languages.CompletionItemKind; detail: string } {
  switch (kind) {
    case 'view':
      return {
        completionKind: monaco.languages.CompletionItemKind.Interface,
        detail: m.completion_detail_view_in({ path })
      };
    case 'materialized_view':
      return {
        completionKind: monaco.languages.CompletionItemKind.Struct,
        detail: m.completion_detail_materialized_view_in({ path })
      };
    case 'table':
    default:
      return {
        completionKind: monaco.languages.CompletionItemKind.Class,
        detail: m.completion_detail_table_in({ path })
      };
  }
}

function pushRelationItems(
  monaco: typeof Monaco,
  out: Monaco.languages.CompletionItem[],
  range: Monaco.IRange,
  entries: TableEntry[],
  path: string
): void {
  for (const entry of entries) {
    const { completionKind, detail } = relationKindPresentation(monaco, entry.kind, path);
    out.push(makeItem(monaco, entry.name, completionKind, range, detail, '0_'));
  }
}

async function appendRelationItems(
  monaco: typeof Monaco,
  out: Monaco.languages.CompletionItem[],
  range: Monaco.IRange,
  prefixParts: string[],
  defaults: CompletionDefaults
): Promise<void> {
  if (prefixParts.length === 0) {
    // Catalogs + (optionally) schemas of default catalog + tables of default schema.
    const catalogs = await fetchNames({ level: 'catalogs' });
    for (const c of catalogs) {
      out.push(
        makeItem(
          monaco,
          c,
          monaco.languages.CompletionItemKind.Folder,
          range,
          m.completion_detail_catalog(),
          '2_'
        )
      );
    }
    if (defaults.catalog) {
      const schemas = await fetchNames({ level: 'schemas', catalog: defaults.catalog });
      for (const s of schemas) {
        out.push(
          makeItem(
            monaco,
            s,
            monaco.languages.CompletionItemKind.Module,
            range,
            m.completion_detail_schema_in({ catalog: defaults.catalog }),
            '1_'
          )
        );
      }
      if (defaults.schema) {
        const tables = await fetchTables(defaults.catalog, defaults.schema);
        pushRelationItems(monaco, out, range, tables, `${defaults.catalog}.${defaults.schema}`);
      }
    }
    return;
  }

  if (prefixParts.length === 1) {
    const part = prefixParts[0];
    // Try as catalog name first (schemas in that catalog).
    const catalogs = await fetchNames({ level: 'catalogs' });
    if (catalogs.includes(part)) {
      const schemas = await fetchNames({ level: 'schemas', catalog: part });
      for (const s of schemas) {
        out.push(
          makeItem(
            monaco,
            s,
            monaco.languages.CompletionItemKind.Module,
            range,
            m.completion_detail_schema_in({ catalog: part }),
            '0_'
          )
        );
      }
      return;
    }
    // Otherwise, if defaultCatalog is set, treat `part` as a schema in it.
    if (defaults.catalog) {
      const schemas = await fetchNames({ level: 'schemas', catalog: defaults.catalog });
      if (schemas.includes(part)) {
        const tables = await fetchTables(defaults.catalog, part);
        pushRelationItems(monaco, out, range, tables, `${defaults.catalog}.${part}`);
      }
    }
    return;
  }

  if (prefixParts.length === 2) {
    const [a, b] = prefixParts;
    const catalogs = await fetchNames({ level: 'catalogs' });
    if (catalogs.includes(a)) {
      const tables = await fetchTables(a, b);
      pushRelationItems(monaco, out, range, tables, `${a}.${b}`);
    }
    return;
  }
  // 3+ parts in relation position doesn't make sense — ignore.
}

async function appendColumnItems(
  monaco: typeof Monaco,
  out: Monaco.languages.CompletionItem[],
  range: Monaco.IRange,
  prefixParts: string[],
  aliasMap: Map<string, RelationAlias>,
  defaults: CompletionDefaults
): Promise<void> {
  // `alias.col` / `table.col` / `schema.table.col` / `cat.schema.table.col`
  if (prefixParts.length >= 1) {
    const resolved = resolveRelation(prefixParts, aliasMap, defaults);
    if (resolved) {
      const cols = await fetchNames({
        level: 'columns',
        catalog: resolved.catalog,
        schema: resolved.schema,
        table: resolved.table
      });
      for (const c of cols) {
        out.push(
          makeItem(
            monaco,
            c,
            monaco.languages.CompletionItemKind.Field,
            range,
            m.completion_detail_column_in({ table: resolved.table }),
            '0_'
          )
        );
      }
    }
    return;
  }

  // Bare column position: suggest columns of every in-scope relation, plus
  // built-in Trino functions (callable anywhere a primary expression is).
  const relations = [...new Map(Array.from(aliasMap.entries())).values()];
  const seen = new Set<string>();
  // De-duplicate by fully qualified name.
  const unique = relations.filter((r) => {
    const k = `${r.catalog ?? ''}.${r.schema ?? ''}.${r.table}`;
    if (seen.has(k)) return false;
    seen.add(k);
    return true;
  });

  await Promise.all([
    ...unique.map(async (r) => {
      const resolved = resolveRelationRef(r, defaults);
      if (!resolved) return;
      const cols = await fetchNames({
        level: 'columns',
        catalog: resolved.catalog,
        schema: resolved.schema,
        table: resolved.table
      });
      for (const c of cols) {
        out.push(
          makeItem(
            monaco,
            c,
            monaco.languages.CompletionItemKind.Field,
            range,
            unique.length > 1
              ? m.completion_detail_column_in({ table: resolved.table })
              : m.completion_detail_column(),
            '0_'
          )
        );
      }
    }),
    (async () => {
      const fns = await fetchNames({ level: 'functions' });
      for (const fn of fns) {
        out.push(
          decorateWithHistory(monaco, {
            label: fn,
            kind: monaco.languages.CompletionItemKind.Function,
            // Snippet inserts `name($0)` and parks the cursor between the
            // parens so the user can immediately type arguments.
            insertText: `${fn}($0)`,
            insertTextRules: monaco.languages.CompletionItemInsertTextRule.InsertAsSnippet,
            range,
            detail: m.completion_detail_function(),
            // Sort below columns (`0_`) but above keywords (`3_`).
            sortText: `2_${fn}`
          })
        );
      }
    })()
  ]);
}

interface Resolved {
  catalog: string;
  schema: string;
  table: string;
}

/** Resolve prefix parts in column position to a concrete (cat, sch, tab). */
function resolveRelation(
  parts: string[],
  aliasMap: Map<string, RelationAlias>,
  defaults: CompletionDefaults
): Resolved | null {
  // `alias.` or `table.`
  if (parts.length === 1) {
    const r = aliasMap.get(parts[0]);
    if (r) return resolveRelationRef(r, defaults);
    return null;
  }
  // `schema.table.` — under default catalog
  if (parts.length === 2 && defaults.catalog) {
    return { catalog: defaults.catalog, schema: parts[0], table: parts[1] };
  }
  // `catalog.schema.table.`
  if (parts.length === 3) {
    return { catalog: parts[0], schema: parts[1], table: parts[2] };
  }
  return null;
}

function resolveRelationRef(r: RelationAlias, defaults: CompletionDefaults): Resolved | null {
  const catalog = r.catalog ?? defaults.catalog;
  const schema = r.schema ?? defaults.schema;
  if (!catalog || !schema) return null;
  return { catalog, schema, table: r.table };
}

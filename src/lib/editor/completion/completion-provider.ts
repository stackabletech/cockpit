// Monaco CompletionItemProvider for the 'trinosql' language.
//
// Uses the grammar-analysis classification (identifierKind) to dispatch on
// what the cursor position expects: a relation reference (offer catalog /
// schema / table / view / MV names), a column reference (offer column
// names from in-scope relations), or a keyword-only position. Column-name
// resolution uses the alias map built by cursor-context to turn `t.col`
// into the real relation behind `t`, and pools in-scope relations for the
// bare column position (`SELECT | FROM foo`). Metadata comes from
// /trino/completion/metadata with a 5-minute client cache.

import type * as Monaco from 'monaco-editor';
import { analyseCompletion, type RelationAlias } from './completion.js';
import { fetchNames, fetchTables, type TableEntry, type TableKind } from './completion-metadata.js';
import * as m from '$lib/paraglide/messages.js';

export interface CompletionDefaults {
  catalog?: string;
  schema?: string;
}

type DefaultsGetter = () => CompletionDefaults;

function makeItem(
  label: string,
  kind: Monaco.languages.CompletionItemKind,
  range: Monaco.IRange,
  detail: string
): Monaco.languages.CompletionItem {
  return { label, kind, insertText: label, range, detail };
}

export function createCompletionProvider(
  monaco: typeof Monaco,
  getDefaults: DefaultsGetter
): Monaco.languages.CompletionItemProvider {
  return {
    triggerCharacters: ['.', ' ', ',', '('],

    async provideCompletionItems(model, position) {
      const sql = model.getValue();
      const cursorOffset = model.getOffsetAt(position);
      const analysis = analyseCompletion({ sql, cursorOffset });

      const word = model.getWordUntilPosition(position);
      const range: Monaco.IRange = {
        startLineNumber: position.lineNumber,
        endLineNumber: position.lineNumber,
        startColumn: word.startColumn,
        endColumn: word.endColumn
      };

      const suggestions: Monaco.languages.CompletionItem[] = [];
      const defaults = getDefaults();

      if (analysis.identifierKind === 'relation') {
        await appendRelationItems(monaco, suggestions, range, analysis.prefixParts, defaults);
      } else if (analysis.identifierKind === 'column') {
        await appendColumnItems(
          monaco,
          suggestions,
          range,
          analysis.prefixParts,
          analysis.aliasMap,
          defaults
        );
      }

      // Suppress keywords when the user is resolving a dotted path (`a.b.|`)
      // because keywords don't appear after a dot.
      if (analysis.prefixParts.length === 0) {
        for (const kw of analysis.keywords) {
          suggestions.push(
            makeItem(
              kw,
              monaco.languages.CompletionItemKind.Keyword,
              range,
              m.completion_detail_keyword()
            )
          );
        }
      }

      return { suggestions };
    }
  };
}

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
    out.push(makeItem(entry.name, completionKind, range, detail));
  }
}

/** Relation-slot suggestions: catalog / schema / table / view / materialised
 *  view names at the level implied by the prefix depth. */
async function appendRelationItems(
  monaco: typeof Monaco,
  out: Monaco.languages.CompletionItem[],
  range: Monaco.IRange,
  prefixParts: string[],
  defaults: CompletionDefaults
): Promise<void> {
  if (prefixParts.length === 0) {
    // Bare relation slot — offer catalogs, plus the schemas and tables in
    // the default catalog if one is set.
    const catalogs = await fetchNames({ level: 'catalogs' });
    for (const catalogName of catalogs) {
      out.push(
        makeItem(
          catalogName,
          monaco.languages.CompletionItemKind.Folder,
          range,
          m.completion_detail_catalog()
        )
      );
    }
    if (defaults.catalog) {
      const schemas = await fetchNames({ level: 'schemas', catalog: defaults.catalog });
      for (const schema of schemas) {
        out.push(
          makeItem(
            schema,
            monaco.languages.CompletionItemKind.Module,
            range,
            m.completion_detail_schema_in({ catalog: defaults.catalog })
          )
        );
      }
      const tables = await fetchTables(defaults.catalog, defaults.schema);
      pushRelationItems(
        monaco,
        out,
        range,
        tables,
        `${defaults.catalog}.${defaults.schema ?? '*'}`
      );
    }
    return;
  }

  if (prefixParts.length === 1) {
    const part = prefixParts[0];
    // Try as catalog name first (schemas in that catalog).
    const catalogs = await fetchNames({ level: 'catalogs' });
    if (catalogs.includes(part)) {
      const schemas = await fetchNames({ level: 'schemas', catalog: part });
      for (const schema of schemas) {
        out.push(
          makeItem(
            schema,
            monaco.languages.CompletionItemKind.Module,
            range,
            m.completion_detail_schema_in({ catalog: part })
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
    const [catalog, schema] = prefixParts;
    const catalogs = await fetchNames({ level: 'catalogs' });
    if (catalogs.includes(catalog)) {
      const tables = await fetchTables(catalog, schema);
      pushRelationItems(monaco, out, range, tables, `${catalog}.${schema}`);
    }
    return;
  }
  // 3+ parts in relation position doesn't make sense — ignore.
}

interface ResolvedRelation {
  catalog: string;
  schema: string;
  table: string;
}

/** Fill missing parts of a `RelationAlias` from the defaults. Returns null
 *  when the reference can't be resolved (e.g. bare table name with no
 *  default catalog / schema set). */
function resolveAlias(alias: RelationAlias, defaults: CompletionDefaults): ResolvedRelation | null {
  const catalog = alias.catalog ?? defaults.catalog;
  const schema = alias.schema ?? defaults.schema;
  if (!catalog || !schema) return null;
  return { catalog, schema, table: alias.table };
}

/** Resolve the dotted prefix at a column cursor position to a concrete
 *  (cat, sch, tab) triple. Order of attempts:
 *   - 1 part: alias / bare-table lookup against the alias map, then defaults.
 *   - 2 parts: (schema, table) under the default catalog.
 *   - 3 parts: (catalog, schema, table) — fully qualified. */
function resolvePrefix(
  parts: string[],
  aliasMap: Map<string, RelationAlias>,
  defaults: CompletionDefaults
): ResolvedRelation | null {
  if (parts.length === 1) {
    const alias = aliasMap.get(parts[0].toLowerCase());
    return alias ? resolveAlias(alias, defaults) : null;
  }
  if (parts.length === 2 && defaults.catalog) {
    return { catalog: defaults.catalog, schema: parts[0], table: parts[1] };
  }
  if (parts.length === 3) {
    return { catalog: parts[0], schema: parts[1], table: parts[2] };
  }
  return null;
}

/** Offer column names at a column cursor position. Three cases:
 *   - Alias-qualified (`t.col`) → resolve `t` through the alias map.
 *   - Fully-qualified (`cat.sch.tab.col`, or `sch.tab.col` under a default
 *     catalog).
 *   - Bare (`SELECT | FROM foo`) → pool column names from every in-scope
 *     FROM / JOIN relation. */
async function appendColumnItems(
  monaco: typeof Monaco,
  out: Monaco.languages.CompletionItem[],
  range: Monaco.IRange,
  prefixParts: string[],
  aliasMap: Map<string, RelationAlias>,
  defaults: CompletionDefaults
): Promise<void> {
  if (prefixParts.length >= 1) {
    const resolved = resolvePrefix(prefixParts, aliasMap, defaults);
    if (resolved) {
      const columns = await fetchNames({
        level: 'columns',
        catalog: resolved.catalog,
        schema: resolved.schema,
        table: resolved.table
      });
      for (const column of columns) {
        out.push(
          makeItem(
            column,
            monaco.languages.CompletionItemKind.Field,
            range,
            m.completion_detail_column_in({ table: resolved.table })
          )
        );
      }
    }
    return;
  }

  // Bare cursor position — pool column names from every in-scope FROM /
  // JOIN relation. Aliases are registered twice in the map (under the
  // bare name and the alias), so de-duplicate by fully-qualified triple
  // before fetching.
  const relations = [...aliasMap.values()];
  const seen = new Set<string>();
  const unique = relations.filter((r) => {
    const key = `${r.catalog ?? ''}.${r.schema ?? ''}.${r.table}`;
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });

  await Promise.all(
    unique.map(async (r) => {
      try {
        const resolved = resolveAlias(r, defaults);
        if (!resolved) return;
        const columns = await fetchNames({
          level: 'columns',
          catalog: resolved.catalog,
          schema: resolved.schema,
          table: resolved.table
        });
        for (const column of columns) {
          out.push(
            makeItem(
              column,
              monaco.languages.CompletionItemKind.Field,
              range,
              unique.length > 1
                ? m.completion_detail_column_in({ table: resolved.table })
                : m.completion_detail_column()
            )
          );
        }
      } catch {
        // Ignore individual failures (e.g. mistyped table names) so we can still
        // offer columns from the other valid relations in scope.
      }
    })
  );
}

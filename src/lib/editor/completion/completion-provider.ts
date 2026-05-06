// Monaco CompletionItemProvider for the 'trinosql' language.
//
// Uses the grammar-analysis classification (identifierKind) to route between
// relation-kind suggestions, column-kind suggestions, and keyword-only slots.
// Metadata comes from /trino/completion/metadata with a 5-minute client cache.
//
// Later PRs layer on alias resolution, CTE awareness, a repair loop, and
// LRU history.

import type * as Monaco from 'monaco-editor';
import { analyseCompletion } from './completion.js';
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
        await appendColumnItems(monaco, suggestions, range, analysis.prefixParts, defaults);
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

/** Column-slot suggestions. This PR handles only fully-qualified column
 *  paths. Alias-qualified and bare-column completion arrive with alias map
 *  support in a follow-up PR. */
async function appendColumnItems(
  monaco: typeof Monaco,
  out: Monaco.languages.CompletionItem[],
  range: Monaco.IRange,
  prefixParts: string[],
  defaults: CompletionDefaults
): Promise<void> {
  if (prefixParts.length === 3) {
    const [catalog, schema, table] = prefixParts;
    const columns = await fetchNames({ level: 'columns', catalog, schema, table });
    for (const column of columns) {
      out.push(
        makeItem(
          column,
          monaco.languages.CompletionItemKind.Field,
          range,
          m.completion_detail_column_in({ table })
        )
      );
    }
    return;
  }

  if (prefixParts.length === 2 && defaults.catalog) {
    // schema.table → columns in the default catalog.
    const [schema, table] = prefixParts;
    const columns = await fetchNames({
      level: 'columns',
      catalog: defaults.catalog,
      schema,
      table
    });
    for (const column of columns) {
      out.push(
        makeItem(
          column,
          monaco.languages.CompletionItemKind.Field,
          range,
          m.completion_detail_column_in({ table })
        )
      );
    }
  }
  // Other prefix shapes need alias resolution — arrives in a later PR.
}

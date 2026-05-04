// Monaco CompletionItemProvider for the 'trinosql' language.
//
// Base layer: static top-level keywords and dotted-path completion for
// catalog / schema / table / column names via /trino/completion/metadata.
// Later PRs layer on c3-driven grammar analysis, alias resolution, repair,
// and LRU history.

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

      // Dotted-path identifier completion. Without grammar classification yet,
      // we can't tell a relation slot from a column slot — so we pick the
      // metadata level from prefix depth + whether the first segment is a
      // known catalog (vs a schema in the default catalog).
      if (ctx.prefixParts.length > 0) {
        await appendIdentifierItems(monaco, suggestions, range, ctx.prefixParts, defaults);
      }

      // Keywords only at the start of a fresh identifier slot (not after a
      // dot — keywords don't follow dotted paths).
      if (ctx.prefixParts.length === 0) {
        for (const kw of ctx.keywords) {
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

async function appendIdentifierItems(
  monaco: typeof Monaco,
  out: Monaco.languages.CompletionItem[],
  range: Monaco.IRange,
  prefixParts: string[],
  defaults: CompletionDefaults
): Promise<void> {
  if (prefixParts.length === 1) {
    const part = prefixParts[0];
    // Try as catalog name first (schemas in that catalog).
    const catalogs = await fetchNames({ level: 'catalogs' });
    if (catalogs.includes(part)) {
      const schemas = await fetchNames({ level: 'schemas', catalog: part });
      for (const s of schemas) {
        out.push(
          makeItem(
            s,
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
    const [a, b] = prefixParts;
    // catalog.schema → tables
    const catalogs = await fetchNames({ level: 'catalogs' });
    if (catalogs.includes(a)) {
      const tables = await fetchTables(a, b);
      pushRelationItems(monaco, out, range, tables, `${a}.${b}`);
      return;
    }
    // schema.table → columns (under default catalog)
    if (defaults.catalog) {
      const cols = await fetchNames({
        level: 'columns',
        catalog: defaults.catalog,
        schema: a,
        table: b
      });
      for (const c of cols) {
        out.push(
          makeItem(
            c,
            monaco.languages.CompletionItemKind.Field,
            range,
            m.completion_detail_column_in({ table: b })
          )
        );
      }
    }
    return;
  }

  if (prefixParts.length === 3) {
    const [catalog, schema, table] = prefixParts;
    const cols = await fetchNames({ level: 'columns', catalog, schema, table });
    for (const c of cols) {
      out.push(
        makeItem(
          c,
          monaco.languages.CompletionItemKind.Field,
          range,
          m.completion_detail_column_in({ table })
        )
      );
    }
  }
  // 4+ parts don't resolve; ignore.
}

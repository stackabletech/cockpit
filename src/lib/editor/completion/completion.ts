// Trino SQL completion orchestrator.
//
// Locates the statement at the cursor, reads the dotted prefix, builds an
// alias map from FROM / JOIN targets and WITH-declared CTEs in the
// surrounding statement, and runs a grammar analysis via antlr4-c3 to
// derive both the grammar-valid keyword candidates and the identifier-kind
// classification (relation / column / keyword-only).

import { getStatementAtOffset, type SqlStatement } from '../split-statements.js';
import { lexSql } from '../lexer-utils.js';
import { extractAliasMap, extractPrefixAtCursor, type RelationAlias } from './cursor-context.js';
import {
  analyseAtCursor,
  computeTopLevelKeywords,
  type IdentifierKind
} from './grammar-analysis.js';

export type { IdentifierKind } from './grammar-analysis.js';
export type { RelationAlias } from './cursor-context.js';

export interface CompletionAnalysis {
  /** Grammar-valid keyword candidates at the cursor (uppercased). */
  keywords: string[];
  /** Whether identifiers at the cursor should be relation-like or column-like. */
  identifierKind: IdentifierKind;
  /** Dotted segments already typed before the word at cursor. */
  prefixParts: string[];
  /** Partial identifier currently being typed (never includes the trailing dot). */
  wordAtCursor: string;
  /** Name → relation map for every FROM / JOIN target in the surrounding
   *  statement (keyed by both the bare table name and any alias, all
   *  lowercased for case-insensitive lookup). Used by the provider to
   *  resolve `t.col` and the bare cursor position (e.g. `SELECT | FROM foo`). */
  aliasMap: Map<string, RelationAlias>;
}

export interface AnalyseArgs {
  /** Full editor text. */
  sql: string;
  /** 0-based character offset within `sql` where the cursor sits. */
  cursorOffset: number;
}

export interface AnalyseResult extends CompletionAnalysis {
  /** The statement that was analysed (null if the cursor is in empty input). */
  statement: SqlStatement | null;
}

export function analyseCompletion({ sql, cursorOffset }: AnalyseArgs): AnalyseResult {
  const statement = getStatementAtOffset(sql, cursorOffset);

  // Empty editor or whitespace-only — offer the memoised top-level keyword set
  // so the user sees SELECT / WITH / CREATE / …
  if (!statement) {
    return {
      statement: null,
      keywords: computeTopLevelKeywords(),
      identifierKind: null,
      prefixParts: [],
      wordAtCursor: '',
      aliasMap: new Map()
    };
  }

  const cursorInStatement = Math.max(0, cursorOffset - statement.offset);
  const sqlUpToCursor = statement.sql.slice(0, cursorInStatement);
  const tokensUpToCursor = lexSql(sqlUpToCursor);
  const prefix = extractPrefixAtCursor(tokensUpToCursor, cursorInStatement);

  // Alias map is built from the FULL statement so aliases declared after the
  // cursor (rare but possible while editing) are still seen. The cursor
  // position also lets extractAliasMap narrow to the innermost scope when
  // the cursor sits inside a CTE body or subquery.
  const aliasMap = extractAliasMap(lexSql(statement.sql), cursorInStatement);

  const grammar = analyseAtCursor(sqlUpToCursor, prefix, tokensUpToCursor);

  return {
    statement,
    keywords: grammar.keywords,
    identifierKind: grammar.identifierKind,
    prefixParts: prefix.prefixParts,
    wordAtCursor: prefix.wordAtCursor,
    aliasMap
  };
}

// Trino SQL completion: orchestrator that combines cursor-context (phase 1,
// lexer-only) with grammar-analysis (phase 2, antlr4-c3 + repair loop). Runs
// on the single statement containing the cursor, not the whole document.

import { getStatementAtOffset, type SqlStatement } from './split-statements.js';
import { lexNonHidden } from './lexer-utils.js';
import {
  extractPrefixAtCursor,
  extractAliasMap,
  type RelationAlias
} from './cursor-context.js';
import {
  analyseWithRepair,
  computeTopLevelKeywords,
  type IdentifierKind
} from './grammar-analysis.js';

export type { RelationAlias } from './cursor-context.js';
export type { IdentifierKind } from './grammar-analysis.js';

export interface CompletionContext {
  /** Valid keyword candidates at the cursor (uppercased). */
  keywords: string[];
  /** Whether identifiers at the cursor should be relation-like or column-like. */
  identifierKind: IdentifierKind;
  /** Dotted segments already typed before the word at cursor. */
  prefixParts: string[];
  /** Partial identifier currently being typed (never includes the trailing dot). */
  wordAtCursor: string;
  /** Map alias-or-bare-table → relation reference for all FROM/JOIN relations + CTEs. */
  aliasMap: Map<string, RelationAlias>;
}

export interface AnalyseArgs {
  /** Full editor text. */
  sql: string;
  /** 0-based character offset within `sql` where the cursor sits. */
  cursorOffset: number;
}

export interface AnalyseResult extends CompletionContext {
  /** The statement that was analysed (null if the cursor is in empty input). */
  statement: SqlStatement | null;
}

/** Main entry point used by the Monaco completion provider.
 *
 *  Three phases:
 *   1. Locate the cursor in the statement and read any dotted prefix at it.
 *   2. Build an alias map from the full statement (FROM / JOIN / CTE names).
 *   3. Run a c3 grammar analysis, iterating a small repair loop when the
 *      parser cannot reach the cursor on its own. */
export function analyseCompletion({ sql, cursorOffset }: AnalyseArgs): AnalyseResult {
  const statement = getStatementAtOffset(sql, cursorOffset);

  // If there is no statement (empty editor, whitespace only), still offer
  // top-level keyword candidates so the user sees SELECT / WITH / CREATE / ….
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

  // We deliberately do NOT clamp to statement.sql.length: the statement range
  // is trimmed of surrounding whitespace, but we still want to treat trailing
  // whitespace after the last token as "cursor past the final token" so the
  // phantom insertion in the grammar analysis triggers correctly.
  const cursorInStatement = Math.max(0, cursorOffset - statement.offset);
  const sqlUpToCursor = statement.sql.slice(0, cursorInStatement);
  const tokensUpToCursor = lexNonHidden(sqlUpToCursor);
  const prefix = extractPrefixAtCursor(tokensUpToCursor, cursorInStatement);

  // Alias map is built from the FULL statement so aliases declared after the
  // cursor (rare but possible while editing) are still seen.
  const aliasMap = extractAliasMap(lexNonHidden(statement.sql));

  const grammar = analyseWithRepair(sqlUpToCursor, prefix, tokensUpToCursor);

  return {
    statement,
    keywords: grammar.keywords,
    identifierKind: grammar.identifierKind,
    prefixParts: prefix.prefixParts,
    wordAtCursor: prefix.wordAtCursor,
    aliasMap
  };
}

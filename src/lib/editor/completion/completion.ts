// Trino SQL completion orchestrator — base layer.
//
// This PR ships the infrastructure: locating the statement at the cursor,
// reading the dotted prefix, and returning a static list of top-level
// keywords. Later PRs will add grammar-driven keyword filtering, identifier
// classification, alias resolution, and a repair loop.

import { getStatementAtOffset, type SqlStatement } from '../split-statements.js';
import { lexSql } from '../lexer-utils.js';
import { extractPrefixAtCursor } from './cursor-context.js';

export interface CompletionContext {
  /** Static list of top-level SQL keywords. Not filtered by cursor position;
   *  grammar-valid filtering arrives in a later PR. */
  keywords: string[];
  /** Dotted segments already typed before the word at cursor. */
  prefixParts: string[];
  /** Partial identifier currently being typed (never includes the trailing dot). */
  wordAtCursor: string;
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

/** Top-level SQL keywords offered when the cursor is not mid-dotted-path.
 *  Sourced from the Trino grammar's statement-start alternatives; kept
 *  hand-written so this PR does not depend on the parser. A later PR
 *  replaces this with grammar-valid keywords derived from antlr4-c3. */
const TOP_LEVEL_KEYWORDS: string[] = [
  'ALTER',
  'ANALYZE',
  'CALL',
  'COMMENT',
  'COMMIT',
  'CREATE',
  'DEALLOCATE',
  'DELETE',
  'DENY',
  'DESC',
  'DESCRIBE',
  'DROP',
  'EXECUTE',
  'EXPLAIN',
  'GRANT',
  'INSERT',
  'MERGE',
  'PREPARE',
  'REFRESH',
  'RESET',
  'REVOKE',
  'ROLLBACK',
  'SELECT',
  'SET',
  'SHOW',
  'START',
  'TABLE',
  'TRUNCATE',
  'UPDATE',
  'USE',
  'VALUES',
  'WITH'
];

export function analyseCompletion({ sql, cursorOffset }: AnalyseArgs): AnalyseResult {
  const statement = getStatementAtOffset(sql, cursorOffset);

  if (!statement) {
    return {
      statement: null,
      keywords: TOP_LEVEL_KEYWORDS,
      prefixParts: [],
      wordAtCursor: ''
    };
  }

  const cursorInStatement = Math.max(0, cursorOffset - statement.offset);
  const sqlUpToCursor = statement.sql.slice(0, cursorInStatement);
  const tokensUpToCursor = lexSql(sqlUpToCursor);
  const prefix = extractPrefixAtCursor(tokensUpToCursor, cursorInStatement);

  return {
    statement,
    keywords: TOP_LEVEL_KEYWORDS,
    prefixParts: prefix.prefixParts,
    wordAtCursor: prefix.wordAtCursor
  };
}

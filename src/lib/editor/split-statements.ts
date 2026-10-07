import { CharStream, Token } from 'antlr4ng';
import { SqlBaseLexer } from './generated/SqlBaseLexer.js';

/** A single parsed statement with its position in the source text. */
export interface SqlStatement {
  sql: string;
  /** 0-based character offset in the original text. */
  offset: number;
  /** 0-based end offset (exclusive) in the original text. */
  endOffset: number;
}

/**
 * Splits SQL text into individual statements delimited by `;`.
 *
 * Uses the ANTLR lexer so that semicolons inside string literals, comments,
 * and compound blocks are handled correctly.
 */
export function splitStatements(sql: string): SqlStatement[] {
  if (!sql.trim()) return [];

  const inputStream = CharStream.fromString(sql);
  const lexer = new SqlBaseLexer(inputStream);
  lexer.removeErrorListeners();

  const allTokens: Token[] = [];
  let t = lexer.nextToken();
  while (t.type !== SqlBaseLexer.EOF) {
    allTokens.push(t);
    t = lexer.nextToken();
  }

  // Filter out hidden tokens (whitespace, comments) for the depth-tracking logic.
  // We still need the original tokens' offsets for splitting.
  const tokens = allTokens.filter(
    (token) =>
      token.type !== SqlBaseLexer.WS &&
      token.type !== SqlBaseLexer.SIMPLE_COMMENT &&
      token.type !== SqlBaseLexer.BRACKETED_COMMENT
  );

  const statements: SqlStatement[] = [];
  let segmentStart = 0;
  // Track nesting depth so semicolons inside compound statements
  // (e.g. BEGIN ...; ...; END) are not treated as separators.
  let depth = 0;

  for (let i = 0; i < tokens.length; i++) {
    const token = tokens[i];
    const type = token.type;

    if (
      type === SqlBaseLexer.BEGIN ||
      type === SqlBaseLexer.CASE ||
      type === SqlBaseLexer.LOOP ||
      type === SqlBaseLexer.WHILE ||
      type === SqlBaseLexer.REPEAT
    ) {
      depth++;
    } else if (type === SqlBaseLexer.IF) {
      // IF only starts a block in control statements (usually IF <expr> THEN).
      // Statements like CREATE TABLE IF NOT EXISTS do not start a block.
      // In control statements, IF is preceded by BEGIN, ELSE, THEN or is the first token.
      const prev = tokens[i - 1];
      if (
        !prev ||
        prev.type === SqlBaseLexer.BEGIN ||
        prev.type === SqlBaseLexer.THEN ||
        prev.type === SqlBaseLexer.ELSE ||
        prev.type === SqlBaseLexer.SEMICOLON
      ) {
        depth++;
      }
    } else if (type === SqlBaseLexer.END && depth > 0) {
      depth--;
    } else if (type === SqlBaseLexer.SEMICOLON && depth === 0) {
      const raw = sql.substring(segmentStart, token.start).trim();
      if (raw.length > 0) {
        // Use indexOf from segmentStart to find the actual start past leading whitespace/comments.
        const offset = sql.indexOf(raw, segmentStart);
        statements.push({ sql: raw, offset, endOffset: offset + raw.length });
      }
      segmentStart = token.start + 1;
    }
  }

  const trailing = sql.substring(segmentStart).trim();
  if (trailing.length > 0) {
    const offset = sql.indexOf(trailing, segmentStart);
    statements.push({ sql: trailing, offset, endOffset: offset + trailing.length });
  }

  return statements;
}

/**
 * Returns the statement that contains the given cursor offset, or `null` if
 * the cursor is not inside any statement (e.g. on whitespace between statements).
 */
export function getStatementAtOffset(sql: string, offset: number): SqlStatement | null {
  const statements = splitStatements(sql);

  // First check if cursor is strictly inside a statement's range.
  for (const stmt of statements) {
    if (offset >= stmt.offset && offset <= stmt.endOffset) {
      return stmt;
    }
  }

  // If cursor is between statements (on whitespace/semicolons), return the
  // previous statement so the user targets what they just finished typing.
  for (let i = statements.length - 1; i >= 0; i--) {
    if (statements[i].endOffset <= offset) {
      return statements[i];
    }
  }

  // Before all statements — fall back to the first one.
  return statements[0] ?? null;
}

/**
 * Returns all statements that overlap the given selection range.
 */
export function getStatementsInRange(
  sql: string,
  startOffset: number,
  endOffset: number
): SqlStatement[] {
  return splitStatements(sql).filter(
    (stmt) => stmt.offset < endOffset && stmt.endOffset > startOffset
  );
}

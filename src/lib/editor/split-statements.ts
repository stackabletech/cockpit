import { CharStream } from 'antlr4ng';
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
 * and `BEGIN … END` compound blocks are handled correctly.
 */
export function splitStatements(sql: string): SqlStatement[] {
  if (!sql.trim()) return [];

  const inputStream = CharStream.fromString(sql);
  const lexer = new SqlBaseLexer(inputStream);
  lexer.removeErrorListeners();

  const statements: SqlStatement[] = [];
  let segmentStart = 0;
  let depth = 0;

  let token = lexer.nextToken();
  while (token.type !== SqlBaseLexer.EOF) {
    if (token.type === SqlBaseLexer.BEGIN) {
      depth++;
    } else if (token.type === SqlBaseLexer.END && depth > 0) {
      depth--;
    } else if (token.type === SqlBaseLexer.SEMICOLON && depth === 0) {
      const raw = sql.substring(segmentStart, token.start).trim();
      if (raw.length > 0) {
        const offset = sql.indexOf(raw, segmentStart);
        statements.push({ sql: raw, offset, endOffset: offset + raw.length });
      }
      segmentStart = token.start + 1;
    }
    token = lexer.nextToken();
  }

  // Trailing statement without a final semicolon.
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
  // closest preceding statement, or the next one if at the very start.
  let closest: SqlStatement | null = null;
  for (const stmt of statements) {
    if (stmt.endOffset <= offset) {
      closest = stmt;
    }
  }

  return closest ?? statements[0] ?? null;
}

/**
 * Returns all statements that overlap the given selection range.
 * Statements are returned in full (not clamped to the selection).
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

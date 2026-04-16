// Shared helpers for working with SqlBaseLexer token streams. Used by both
// the completion engine and DDL invalidation.

import { CharStream, type Token } from 'antlr4ng';
import { SqlBaseLexer } from './generated/SqlBaseLexer.js';

export const DOT = SqlBaseLexer.T__0;
export const LPAREN = SqlBaseLexer.T__1;
export const RPAREN = SqlBaseLexer.T__2;
export const COMMA = SqlBaseLexer.T__3;

export const IDENTIFIER_TOKENS = new Set<number>([
  SqlBaseLexer.IDENTIFIER,
  SqlBaseLexer.QUOTED_IDENTIFIER,
  SqlBaseLexer.BACKQUOTED_IDENTIFIER,
  SqlBaseLexer.DIGIT_IDENTIFIER
]);

/** Strip matching double-quotes or backticks around a quoted identifier. */
export function unquoteIdentifier(text: string): string {
  if (text.length >= 2) {
    const first = text[0];
    const last = text[text.length - 1];
    if ((first === '"' && last === '"') || (first === '`' && last === '`')) {
      return text.slice(1, -1).replaceAll(first + first, first);
    }
  }
  return text;
}

/** Lex a string; returns all tokens on the default channel (no WS/comments). */
export function lexNonHidden(sql: string): Token[] {
  const lexer = new SqlBaseLexer(CharStream.fromString(sql));
  lexer.removeErrorListeners();
  const tokens: Token[] = [];
  while (true) {
    const t = lexer.nextToken();
    if (t.type === SqlBaseLexer.EOF) break;
    if (
      t.type === SqlBaseLexer.WS ||
      t.type === SqlBaseLexer.SIMPLE_COMMENT ||
      t.type === SqlBaseLexer.BRACKETED_COMMENT
    ) {
      continue;
    }
    tokens.push(t);
  }
  return tokens;
}

/** Read a dotted qualified name (a.b.c) starting at `start`, returning the
 *  unquoted parts and the index of the token after the name. */
export function readQualifiedName(
  tokens: Token[],
  start: number
): { parts: string[]; next: number } {
  const parts: string[] = [];
  let i = start;
  while (i < tokens.length && IDENTIFIER_TOKENS.has(tokens[i].type)) {
    parts.push(unquoteIdentifier(tokens[i].text ?? ''));
    if (tokens[i + 1]?.type === DOT && tokens[i + 2] && IDENTIFIER_TOKENS.has(tokens[i + 2].type)) {
      i += 2;
    } else {
      i++;
      break;
    }
  }
  return { parts, next: i };
}

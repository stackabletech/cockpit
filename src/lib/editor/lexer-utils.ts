// Shared helpers for working with SqlBaseLexer token streams. Consumed by the
// completion engine.

import { CharStream, Token } from 'antlr4ng';
import { SqlBaseLexer } from './generated/SqlBaseLexer.js';
import { unquoteIdentifier } from './identifiers.js';

// ANTLR assigns `T__0`, `T__1`, … to grammar literals that have no explicit
// token name. In Trino's SqlBase.g4 those are (in order of first appearance)
// `.`, `(`, `)`, `,`. Verified against SqlBaseLexer.literalNames on
// generation; update if the grammar's literal order changes.
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

/** Tokenise Trino SQL. Returns only default-channel tokens — whitespace
 *  and comments, which the SqlBase grammar routes to the HIDDEN channel,
 *  are dropped so callers walk just the semantically-significant tokens. */
export function lexSql(sql: string): Token[] {
  const lexer = new SqlBaseLexer(CharStream.fromString(sql));
  lexer.removeErrorListeners();
  const tokens: Token[] = [];
  for (;;) {
    const token = lexer.nextToken();
    if (token.type === SqlBaseLexer.EOF) break;
    if (token.channel !== Token.DEFAULT_CHANNEL) continue;
    tokens.push(token);
  }
  return tokens;
}

/** Returns the position after the matching `)` of a balanced `(…)` group.
 *  Returns whether the group was successfully closed. */
export function parenGroupEndPosition(
  tokens: Token[],
  start: number
): { pos: number; closed: boolean } {
  let depth = 1;
  let pos = start + 1;
  while (pos < tokens.length && depth > 0) {
    if (tokens[pos].type === LPAREN) depth++;
    else if (tokens[pos].type === RPAREN) depth--;
    pos++;
  }
  return { pos, closed: depth === 0 };
}

/** Char position of the innermost unmatched `(`, or null if every `(` closes. */
export function unclosedParenOffset(tokens: Token[]): number | null {
  const stack: number[] = [];
  for (const t of tokens) {
    if (t.type === LPAREN) stack.push(t.start);
    else if (t.type === RPAREN && stack.length > 0) stack.pop();
  }
  return stack.length > 0 ? stack[stack.length - 1] : null;
}

/** Read a dotted qualified name (a.b.c) starting at `start`, returning the
 *  unquoted parts and the index of the token after the name. Stops at the
 *  first non-identifier token, or at a trailing dot not followed by an
 *  identifier (treated as "name ends here"). */
export function readQualifiedName(
  tokens: Token[],
  start: number
): { parts: string[]; next: number } {
  const parts: string[] = [];
  let pos = start;

  while (pos < tokens.length && IDENTIFIER_TOKENS.has(tokens[pos].type)) {
    parts.push(unquoteIdentifier(tokens[pos].text ?? ''));
    pos++;

    // Continue only when a `DOT IDENTIFIER` pair follows. Anything else
    // (end of input, trailing dot, different token) ends the name.
    const dotFollows = tokens[pos]?.type === DOT;
    const identAfterDot =
      tokens[pos + 1] !== undefined && IDENTIFIER_TOKENS.has(tokens[pos + 1].type);
    if (!dotFollows || !identAfterDot) break;

    pos++; // skip the dot; the loop body consumes the identifier after it
  }

  return { parts, next: pos };
}

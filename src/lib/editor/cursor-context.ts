// Phase 1 of completion analysis: locate the cursor inside the current
// statement and read the surrounding context — the dotted prefix before the
// cursor, and the alias map derived from FROM / JOIN clauses and CTEs.
//
// This layer only lexes; it never parses. The grammar-analysis phase sits on
// top and consumes the outputs produced here.

import type { Token } from 'antlr4ng';
import { SqlBaseLexer } from './generated/SqlBaseLexer.js';
import {
  DOT,
  LPAREN,
  RPAREN,
  COMMA,
  IDENTIFIER_TOKENS,
  unquoteIdentifier,
  readQualifiedName
} from './lexer-utils.js';

export interface RelationAlias {
  /** Optional catalog / schema if the reference was qualified in the statement. */
  catalog?: string;
  schema?: string;
  /** Bare table name (unqualified) or the alias target. */
  table: string;
}

/** Skip a balanced `(…)` group. `start` must point at the opening `(`.
 *  Returns the index after the matching `)`, or `tokens.length` if unclosed. */
function skipParenGroup(tokens: Token[], start: number): number {
  let depth = 1;
  let pos = start + 1;
  while (pos < tokens.length && depth > 0) {
    if (tokens[pos].type === LPAREN) depth++;
    else if (tokens[pos].type === RPAREN) depth--;
    pos++;
  }
  return pos;
}

/** Split the string immediately before the cursor into dotted prefix parts
 *  plus the partial word at the cursor.
 *
 *  Given `SELECT t.col FROM cat.sch|` with cursor at the `|`, returns:
 *   - prefixParts: ['cat']
 *   - wordAtCursor: 'sch'
 *
 *  Given `... FROM cat.sch.|`, returns prefixParts: ['cat','sch'], wordAtCursor: ''.
 */
export function extractPrefixAtCursor(
  tokens: Token[],
  cursorInStatement: number
): { prefixParts: string[]; wordAtCursor: string } {
  // Step 1: find the last token that starts before the cursor.
  let pos = tokens.length - 1;
  while (pos >= 0 && tokens[pos].start >= cursorInStatement) pos--;
  if (pos < 0) return { prefixParts: [], wordAtCursor: '' };

  // Step 2: classify that token relative to the cursor. Three cases:
  //   A) cursor is inside/at the end of an identifier → that's the partial word
  //   B) cursor is immediately after a dot → no word yet, prefix continues
  //   C) cursor is attached to something else (keyword, operator) → no prefix
  const last = tokens[pos];
  const lastEndExclusive = last.stop + 1;
  const cursorTouchesLast = lastEndExclusive >= cursorInStatement;

  let wordAtCursor: string;
  if (IDENTIFIER_TOKENS.has(last.type) && cursorTouchesLast) {
    // Case A: truncate the identifier text at the cursor column.
    const chopAt = cursorInStatement - last.start;
    wordAtCursor = unquoteIdentifier((last.text ?? '').slice(0, Math.max(0, chopAt)));
    pos--; // look behind for a dotted prefix
  } else if (last.type === DOT && lastEndExclusive === cursorInStatement) {
    // Case B: leave pos on the dot so the walk below consumes it.
    wordAtCursor = '';
  } else {
    // Case C: not on an identifier path.
    return { prefixParts: [], wordAtCursor: '' };
  }

  // Step 3: walk backwards through (DOT IDENTIFIER)* pairs.
  const prefixParts: string[] = [];
  while (pos >= 1 && tokens[pos].type === DOT && IDENTIFIER_TOKENS.has(tokens[pos - 1].type)) {
    prefixParts.unshift(unquoteIdentifier(tokens[pos - 1].text ?? ''));
    pos -= 2;
  }

  return { prefixParts, wordAtCursor };
}

/** Extract an alias map from the statement's FROM/JOIN clauses and CTEs.
 *  Walks tokens linearly — cheap and robust enough for typical queries. */
export function extractAliasMap(tokens: Token[]): Map<string, RelationAlias> {
  const aliasMap = new Map<string, RelationAlias>();

  const toAlias = (parts: string[]): RelationAlias | null => {
    if (parts.length === 0) return null;
    if (parts.length === 1) return { table: parts[0] };
    if (parts.length === 2) return { schema: parts[0], table: parts[1] };
    return { catalog: parts[0], schema: parts[1], table: parts[2] };
  };

  for (let i = 0; i < tokens.length; i++) {
    const token = tokens[i];

    // FROM / JOIN <qualifiedName> [[AS] alias]
    if (token.type === SqlBaseLexer.FROM || token.type === SqlBaseLexer.JOIN) {
      const { parts, next: afterName } = readQualifiedName(tokens, i + 1);
      const alias = toAlias(parts);
      if (alias) {
        // Register the bare table name first so `<table>.col` works.
        aliasMap.set(alias.table, alias);
        // Optional [AS] <identifier> follows the name.
        let walk = afterName;
        if (tokens[walk]?.type === SqlBaseLexer.AS) walk++;
        if (tokens[walk] && IDENTIFIER_TOKENS.has(tokens[walk].type)) {
          aliasMap.set(unquoteIdentifier(tokens[walk].text ?? ''), alias);
        }
        i = afterName - 1;
        continue;
      }
    }

    // WITH <identifier> [(cols)] AS (body) [, <identifier> …]
    // Register each CTE name as a relation placeholder; body is skipped.
    if (token.type === SqlBaseLexer.WITH) {
      let walk = i + 1;
      while (walk < tokens.length && IDENTIFIER_TOKENS.has(tokens[walk].type)) {
        const cteName = unquoteIdentifier(tokens[walk].text ?? '');
        aliasMap.set(cteName, { table: cteName });
        walk++;
        if (tokens[walk]?.type === LPAREN) walk = skipParenGroup(tokens, walk); // optional column list
        if (tokens[walk]?.type === SqlBaseLexer.AS) walk++;
        if (tokens[walk]?.type === LPAREN) walk = skipParenGroup(tokens, walk); // CTE body
        if (tokens[walk]?.type !== COMMA) break;
        walk++; // skip the comma and continue with the next CTE name
      }
      i = walk - 1;
    }
  }

  return aliasMap;
}

// Lexer-only cursor context for Trino SQL completion: reads the dotted
// identifier prefix immediately before the cursor. Future PRs will add an
// alias map for FROM/JOIN resolution on top of this.

import type { Token } from 'antlr4ng';
import { DOT, IDENTIFIER_TOKENS } from '../lexer-utils.js';
import { unquoteIdentifier } from '../identifiers.js';

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
    // Case A: keep just the portion of the identifier before the cursor.
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

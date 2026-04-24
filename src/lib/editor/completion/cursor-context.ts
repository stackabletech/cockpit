// Lexer-only cursor context for Trino SQL completion: reads the dotted
// identifier prefix immediately before the cursor, and extracts an alias
// map from the statement's FROM / JOIN clauses. CTE support (WITH) arrives
// in a later PR.

import type { Token } from 'antlr4ng';
import { SqlBaseLexer } from '../generated/SqlBaseLexer.js';
import { DOT, IDENTIFIER_TOKENS, readQualifiedName } from '../lexer-utils.js';
import { unquoteIdentifier } from '../identifiers.js';

/** Resolved reference to a FROM / JOIN relation, used when completing columns
 *  of an alias-qualified expression (e.g. resolving `t` in `t.col` to the
 *  real `catalog.schema.table` triple). Catalog and schema are optional when
 *  the reference was partially qualified — the column-completion code fills
 *  them in from the default catalog / schema where necessary. */
export interface RelationAlias {
  catalog?: string;
  schema?: string;
  /** Bare table name (unqualified) or the alias target. */
  table: string;
}

/** Build a `RelationAlias` from 1-3 dotted name parts. The trailing part is
 *  always the table; anything before is catalog / schema. */
function partsToAlias(parts: string[]): RelationAlias | null {
  if (parts.length === 0) return null;
  if (parts.length === 1) return { table: parts[0] };
  if (parts.length === 2) return { schema: parts[0], table: parts[1] };
  return { catalog: parts[0], schema: parts[1], table: parts[2] };
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

/** Scan the statement's token stream for every FROM / JOIN target and return
 *  a name → relation map. Each target is registered under both its bare
 *  table name and, if one follows, its alias — so `SELECT * FROM foo x`
 *  can later resolve either `foo.col` or `x.col` to the same relation.
 *
 *  Linear token walk; no parse tree. Cheap and robust enough for typical
 *  queries, and stays usable when the SQL is mid-edit / partial.
 *
 *  CTE names (WITH clause) are not yet walked; they arrive in a follow-up PR. */
export function extractAliasMap(tokens: Token[]): Map<string, RelationAlias> {
  const aliasMap = new Map<string, RelationAlias>();

  for (let i = 0; i < tokens.length; i++) {
    const token = tokens[i];

    // FROM / JOIN <qualifiedName> [[AS] alias]
    if (token.type === SqlBaseLexer.FROM || token.type === SqlBaseLexer.JOIN) {
      const { parts, next: initialNext } = readQualifiedName(tokens, i + 1);
      let next = initialNext;
      const alias = partsToAlias(parts);
      if (alias) {
        // Register the bare table name first so `<table>.col` works.
        // Lowercase for case-insensitive lookup.
        aliasMap.set(alias.table.toLowerCase(), alias);
        // Optional [AS] <identifier> follows the name.
        if (tokens[next]?.type === SqlBaseLexer.AS) next++;
        if (tokens[next] && IDENTIFIER_TOKENS.has(tokens[next].type)) {
          const aliasName = unquoteIdentifier(tokens[next].text ?? '');
          aliasMap.set(aliasName.toLowerCase(), alias);
          next++;
        }
        i = next - 1;
      }
    }
  }

  return aliasMap;
}

// Lexer-only cursor context for Trino SQL completion: reads the dotted
// identifier prefix immediately before the cursor, and extracts an alias
// map from the statement's FROM / JOIN clauses and any WITH-declared CTEs.

import type { Token } from 'antlr4ng';
import { SqlBaseLexer } from '../generated/SqlBaseLexer.js';
import {
  COMMA,
  DOT,
  IDENTIFIER_TOKENS,
  LPAREN,
  parenGroupEndPosition,
  readQualifiedName
} from '../lexer-utils.js';
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

/** If `pos` points at an `(`, skip past the matching `)` and return the
 *  position after it. Otherwise return `pos` unchanged. */
function skipOptionalParenGroup(tokens: Token[], pos: number): number {
  // eslint-disable-next-line security/detect-object-injection
  if (tokens[pos]?.type !== LPAREN) return pos;
  return parenGroupEndPosition(tokens, pos).pos;
}

/** Find the innermost `(SELECT …)` or `(WITH …)` body that contains the
 *  cursor, and return its inner tokens. Returns null when the cursor isn't
 *  inside any such body.
 *
 *  Only parens immediately followed by `SELECT` or `WITH` count as
 *  scope-opening; plain expression groups like `(a + b)` are ignored. */
function cursorScopeTokens(tokens: Token[], cursor: number): Token[] | null {
  let pos = 0;
  while (pos < tokens.length) {
    // eslint-disable-next-line security/detect-object-injection
    if (tokens[pos].type !== LPAREN) {
      pos++;
      continue;
    }
    const firstTokenInside = tokens[pos + 1];
    if (
      firstTokenInside?.type !== SqlBaseLexer.SELECT &&
      firstTokenInside?.type !== SqlBaseLexer.WITH
    ) {
      pos++;
      continue;
    }

    const { pos: end, closed } = parenGroupEndPosition(tokens, pos);
    // eslint-disable-next-line security/detect-object-injection
    const openChar = tokens[pos].start;

    // Cursor is inside this body if it's past the opening `(` and either
    // the body is unclosed (everything past the `(` is "inside") or it
    // hasn't passed the matching `)` yet.
    const cursorIsInside = cursor > openChar && (!closed || cursor <= tokens[end - 1].start);

    if (cursorIsInside) {
      // Slice the body's contents. When closed, exclude the `)`; when
      // unclosed, take everything to the end of the available tokens.
      return tokens.slice(pos + 1, closed ? end - 1 : end);
    }
    pos = end; // skip past this group; try the next sibling
  }
  return null;
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
  // eslint-disable-next-line security/detect-object-injection
  while (pos >= 0 && tokens[pos].start >= cursorInStatement) pos--;
  if (pos < 0) return { prefixParts: [], wordAtCursor: '' };

  // Step 2: classify that token relative to the cursor. Three cases:
  //   A) cursor is inside/at the end of an identifier → that's the partial word
  //   B) cursor is immediately after a dot → no word yet, prefix continues
  //   C) cursor is attached to something else (keyword, operator) → no prefix
  // eslint-disable-next-line security/detect-object-injection
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
  // eslint-disable-next-line security/detect-object-injection
  while (pos >= 1 && tokens[pos].type === DOT && IDENTIFIER_TOKENS.has(tokens[pos - 1].type)) {
    prefixParts.unshift(unquoteIdentifier(tokens[pos - 1].text ?? ''));
    pos -= 2;
  }

  return { prefixParts, wordAtCursor };
}

/** Scan the statement's token stream for every relation in scope at the
 *  cursor, and return a name → relation map.
 *
 *  Two sources of relations:
 *   - **FROM / JOIN targets** — registered under both their bare table
 *     name and any alias, so `SELECT * FROM foo x` can later resolve
 *     either `foo.col` or `x.col` to the same relation.
 *   - **CTEs (Common Table Expressions)** declared by a WITH clause —
 *     named temporary result sets only visible inside the same statement,
 *     e.g. `WITH my_cte AS (SELECT …) SELECT … FROM my_cte`. We register
 *     the CTE name as a self-referential relation (`{ table: cteName }`)
 *     and skip its body so tokens inside it don't leak into the outer
 *     scope (an inner `FROM inner_tab` must not register `inner_tab` up
 *     here — it's only in scope within the CTE body).
 *
 *  Scope-aware: if the cursor is inside a nested `(SELECT …)` or
 *  `(WITH …)` body (CTE body, subquery in WHERE/IN, derived table in
 *  FROM), only that body's relations are extracted. Outer-scope relations
 *  are NOT merged in — accessing an outer FROM from inside a subquery
 *  (correlated subquery) is not supported yet.
 *
 *  Linear token walk; no parse tree. Cheap and robust enough for typical
 *  queries, and stays usable when the SQL is mid-edit / partial. */
export function extractAliasMap(
  tokens: Token[],
  cursorInStatement: number
): Map<string, RelationAlias> {
  // Scope narrowing: if the cursor is inside a nested body, recurse on
  // just its tokens. Nested further? The recursion narrows again.
  const inner = cursorScopeTokens(tokens, cursorInStatement);
  if (inner) return extractAliasMap(inner, cursorInStatement);

  const aliasMap = new Map<string, RelationAlias>();

  for (let pos = 0; pos < tokens.length; pos++) {
    // eslint-disable-next-line security/detect-object-injection
    const token = tokens[pos];

    // FROM / JOIN <qualifiedName> [[AS] alias]
    if (token.type === SqlBaseLexer.FROM || token.type === SqlBaseLexer.JOIN) {
      const { parts, next: initialNext } = readQualifiedName(tokens, pos + 1);
      let next = initialNext;
      const alias = partsToAlias(parts);
      if (alias) {
        // Register the bare table name first so `<table>.col` works.
        // Lowercase for case-insensitive lookup.
        aliasMap.set(alias.table.toLowerCase(), alias);
        // Optional [AS] <identifier> follows the name.
        // eslint-disable-next-line security/detect-object-injection
        if (tokens[next]?.type === SqlBaseLexer.AS) next++;
        // eslint-disable-next-line security/detect-object-injection
        if (tokens[next] && IDENTIFIER_TOKENS.has(tokens[next].type)) {
          // eslint-disable-next-line security/detect-object-injection
          const aliasName = unquoteIdentifier(tokens[next].text ?? '');
          aliasMap.set(aliasName.toLowerCase(), alias);
          next++;
        }
        pos = next - 1;
      }
    }

    // WITH <cte> [(cols)] AS (body) [, <cte> …]
    // Walk the CTE list, registering each name and skipping its body (see
    // the JSDoc for why the body is skipped).
    if (token.type === SqlBaseLexer.WITH) {
      let next = pos + 1;
      // eslint-disable-next-line security/detect-object-injection
      while (next < tokens.length && IDENTIFIER_TOKENS.has(tokens[next].type)) {
        // eslint-disable-next-line security/detect-object-injection
        const cteName = unquoteIdentifier(tokens[next].text ?? '');
        aliasMap.set(cteName.toLowerCase(), { table: cteName });
        next++;

        next = skipOptionalParenGroup(tokens, next); // optional column list
        // eslint-disable-next-line security/detect-object-injection
        if (tokens[next]?.type === SqlBaseLexer.AS) next++;
        next = skipOptionalParenGroup(tokens, next); // CTE body

        // Comma means another CTE follows; anything else ends the WITH list.
        // eslint-disable-next-line security/detect-object-injection
        if (tokens[next]?.type !== COMMA) break;
        next++;
      }
      pos = next - 1;
    }
  }

  return aliasMap;
}

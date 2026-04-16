// Completion context analysis for Trino SQL.
//
// Combines an ANTLR4 lexer pass (for the dotted prefix at the cursor and the
// alias map from FROM/JOIN clauses) with antlr4-c3's CodeCompletionCore (for
// grammar-valid keyword candidates). Runs on the single statement containing
// the cursor rather than the whole document.

import { CharStream, CommonTokenStream, Token } from 'antlr4ng';
import { CodeCompletionCore } from 'antlr4-c3';
import { SqlBaseLexer } from './generated/SqlBaseLexer.js';
import { SqlBaseParser } from './generated/SqlBaseParser.js';
import { tokenMap } from './tokenMap.js';
import { getStatementAtOffset, type SqlStatement } from './split-statements.js';
import {
  DOT,
  LPAREN,
  RPAREN,
  COMMA,
  IDENTIFIER_TOKENS,
  unquoteIdentifier,
  lexNonHidden,
  readQualifiedName
} from './lexer-utils.js';

/** Placeholder identifier inserted at gaps so c3 has a token to target. */
const PHANTOM = '__stackable_ui_completion_phantom_8f4e2b9d__';

export type IdentifierKind = 'relation' | 'column' | null;

export interface RelationAlias {
  /** Optional catalog / schema if the reference was qualified in the statement. */
  catalog?: string;
  schema?: string;
  /** Bare table name (unqualified) or the alias target. */
  table: string;
}

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

// --- helpers -----------------------------------------------------------------

/** Split the string immediately before the cursor into dotted prefix parts
 *  plus the partial word at the cursor.
 *
 *  Given `SELECT t.col FROM cat.sch|` with cursor at the `|`, returns:
 *   - prefixParts: ['cat']
 *   - wordAtCursor: 'sch'
 *
 *  Given `... FROM cat.sch.|`, returns prefixParts: ['cat','sch'], wordAtCursor: ''.
 */
function extractPrefixAtCursor(
  tokens: Token[],
  cursorInStatement: number
): { prefixParts: string[]; wordAtCursor: string } {
  // Walk backwards from the cursor through an IDENTIFIER (DOT IDENTIFIER)* chain
  // that ends at the cursor (or is the token the cursor is inside).
  const parts: string[] = [];
  let wordAtCursor = '';
  let i = tokens.length - 1;

  // Find the last token that starts before the cursor.
  while (i >= 0 && tokens[i].start >= cursorInStatement) i--;

  if (i >= 0) {
    const t = tokens[i];
    const endExclusive = t.stop + 1;
    if (IDENTIFIER_TOKENS.has(t.type) && endExclusive >= cursorInStatement) {
      // Cursor is inside (or immediately after) an identifier token: that's the word.
      const text = t.text ?? '';
      const cut = cursorInStatement - t.start;
      wordAtCursor = unquoteIdentifier(text.slice(0, Math.max(0, cut)));
      i--;
    } else if (t.type === DOT && endExclusive === cursorInStatement) {
      // Cursor immediately after a dot: no partial word yet, but the prefix
      // continues with whatever identifier precedes the dot.
      wordAtCursor = '';
      // keep i on the dot so the loop below consumes it
    } else {
      // Cursor is not attached to an identifier path: no prefix.
      return { prefixParts: [], wordAtCursor: '' };
    }
  }

  // Now consume (DOT IDENTIFIER)* pairs walking backwards.
  while (i >= 0) {
    const t = tokens[i];
    if (t.type === DOT) {
      const prev = tokens[i - 1];
      if (prev && IDENTIFIER_TOKENS.has(prev.type)) {
        parts.unshift(unquoteIdentifier(prev.text ?? ''));
        i -= 2;
        continue;
      }
    }
    break;
  }

  return { prefixParts: parts, wordAtCursor };
}

/** Extract an alias map from the statement's FROM/JOIN clauses and CTEs.
 *  Walks tokens linearly — cheap and robust enough for typical queries. */
function extractAliasMap(tokens: Token[]): Map<string, RelationAlias> {
  const aliasMap = new Map<string, RelationAlias>();

  const toAlias = (parts: string[]): RelationAlias | null => {
    if (parts.length === 0) return null;
    if (parts.length === 1) return { table: parts[0] };
    if (parts.length === 2) return { schema: parts[0], table: parts[1] };
    return { catalog: parts[0], schema: parts[1], table: parts[2] };
  };

  for (let i = 0; i < tokens.length; i++) {
    const t = tokens[i];

    // FROM / JOIN <qualifiedName> [[AS] alias]
    if (t.type === SqlBaseLexer.FROM || t.type === SqlBaseLexer.JOIN) {
      const { parts, next } = readQualifiedName(tokens, i + 1);
      const alias = toAlias(parts);
      if (alias) {
        // Register by bare table name first so `<table>.col` works.
        aliasMap.set(alias.table, alias);
        // Look for an optional alias: [AS] <identifier>
        let j = next;
        if (tokens[j]?.type === SqlBaseLexer.AS) j++;
        if (tokens[j] && IDENTIFIER_TOKENS.has(tokens[j].type)) {
          aliasMap.set(unquoteIdentifier(tokens[j].text ?? ''), alias);
        }
        i = next - 1;
        continue;
      }
    }

    // WITH <identifier> AS ( ... ) — register CTE name as a relation placeholder.
    if (t.type === SqlBaseLexer.WITH) {
      let j = i + 1;
      while (j < tokens.length && IDENTIFIER_TOKENS.has(tokens[j].type)) {
        const cteName = unquoteIdentifier(tokens[j].text ?? '');
        aliasMap.set(cteName, { table: cteName });
        // Skip: [( col, ... )] AS ( ... )
        j++;
        if (tokens[j]?.type === LPAREN) {
          let d = 1;
          j++;
          while (j < tokens.length && d > 0) {
            if (tokens[j].type === LPAREN) d++;
            else if (tokens[j].type === RPAREN) d--;
            j++;
          }
        }
        if (tokens[j]?.type === SqlBaseLexer.AS) j++;
        if (tokens[j]?.type === LPAREN) {
          let d = 1;
          j++;
          while (j < tokens.length && d > 0) {
            if (tokens[j].type === LPAREN) d++;
            else if (tokens[j].type === RPAREN) d--;
            j++;
          }
        }
        if (tokens[j]?.type === COMMA) {
          j++;
          continue;
        }
        break;
      }
      i = j - 1;
    }
  }

  return aliasMap;
}

// --- c3 keyword extraction ---------------------------------------------------

const KEYWORD_TOKEN_TYPES: number[] = Object.entries(tokenMap)
  .filter(([, scope]) => scope === 'keyword')
  .map(([type]) => Number(type));

const KEYWORD_TOKEN_SET = new Set(KEYWORD_TOKEN_TYPES);

/** Map a keyword token type back to its canonical uppercase spelling.
 *  SqlBaseLexer.literalNames contains entries like `"'SELECT'"`. */
function keywordForToken(type: number): string | null {
  const literal = (SqlBaseLexer as unknown as { literalNames: (string | null)[] }).literalNames[
    type
  ];
  if (!literal) return null;
  const m = /^'(.+)'$/.exec(literal);
  return m ? m[1].toUpperCase() : null;
}

interface GrammarAnalysis {
  keywords: string[];
  identifierKind: IdentifierKind;
  /** True when c3 found nothing reachable at the cursor — usually because the
   *  partial input couldn't be parsed at all. Caller may retry with repairs. */
  empty: boolean;
}

/** Run CodeCompletionCore once to derive both the grammar-valid keywords and
 *  the identifier kind (relation vs. column) at the cursor.
 *
 *  Classification is driven entirely by which preferred rules c3 reports as
 *  reachable at the cursor — no hand-maintained keyword lists. The crisp rule:
 *
 *  - If `identifier` is a candidate → there's already a completed name before
 *    the cursor (we're at an alias slot or post-name continuation). Suppress
 *    identifier suggestions; the user wants keywords (JOIN, ON, AS, …).
 *  - Else if `primaryExpression` is a candidate → column expression slot.
 *  - Else if `qualifiedName` is a candidate → relation slot (FROM/JOIN target,
 *    INSERT INTO, UPDATE, DELETE FROM, CREATE/DROP/ALTER TABLE, etc.).
 *  - Else → null (keyword-only position). */
function analyseGrammarAt(
  parser: SqlBaseParser,
  tokenIndexAtCursor: number,
  /** True when the cursor is actively extending the previous rule — either
   *  mid-identifier (`mysch|`) or right after a dot (`mycat.|`). In both
   *  cases a `qualifiedName`/`primaryExpression` rule whose `startTokenIndex`
   *  is earlier than the cursor is still validly "here". */
  extendingPrevious: boolean
): GrammarAnalysis {
  const core = new CodeCompletionCore(parser);
  core.ignoredTokens = new Set<number>();
  core.preferredRules = new Set<number>([
    SqlBaseParser.RULE_qualifiedName,
    SqlBaseParser.RULE_identifier,
    SqlBaseParser.RULE_primaryExpression
  ]);

  let candidates;
  try {
    candidates = core.collectCandidates(tokenIndexAtCursor);
  } catch {
    return { keywords: [], identifierKind: null, empty: true };
  }

  // c3 returns rules that started earlier in the input and are still being
  // matched (e.g. for `WHERE address |`, `primaryExpression` is reported with
  // `startTokenIndex = position of address`, not the cursor — that expression
  // is *completed*, not a fresh slot, so we mustn't propose more columns).
  // A rule "applies at the cursor" when its startTokenIndex equals the cursor
  // token, OR when the cursor is extending the previous rule (mid-identifier
  // or right after a dot).
  const ruleApplies = (rule: number): boolean => {
    const info = candidates.rules.get(rule);
    if (!info) return false;
    return info.startTokenIndex === tokenIndexAtCursor || extendingPrevious;
  };
  const hasIdentifier = ruleApplies(SqlBaseParser.RULE_identifier);
  const hasPrimaryExpr = ruleApplies(SqlBaseParser.RULE_primaryExpression);
  const hasQualifiedName = ruleApplies(SqlBaseParser.RULE_qualifiedName);
  let identifierKind: IdentifierKind = null;
  if (!hasIdentifier) {
    if (hasPrimaryExpr) identifierKind = 'column';
    else if (hasQualifiedName) identifierKind = 'relation';
  }

  const keywords = new Set<string>();
  for (const type of candidates.tokens.keys()) {
    // Surface keyword tokens (SELECT, FROM, …) and the symbolic shortcuts the
    // grammar accepts in their stead — `*` is the headline case (the SELECT-all
    // alternative, also `SELECT t.*`, COUNT(*), etc.). Other operator/
    // punctuation tokens (`+`, `-`, `(`, `,`) are typed directly by the user
    // and aren't worth surfacing in the suggestion list.
    if (!KEYWORD_TOKEN_SET.has(type) && type !== SqlBaseLexer.ASTERISK) continue;
    const kw = keywordForToken(type);
    if (kw) keywords.add(kw);
  }
  const empty = candidates.rules.size === 0 && candidates.tokens.size === 0;
  return { keywords: [...keywords].sort(), identifierKind, empty };
}

/** Lex+parse `sql` and run the c3 grammar analysis at its final token. */
function parseAndAnalyse(sql: string, extendingPrevious: boolean): GrammarAnalysis {
  try {
    const lexer = new SqlBaseLexer(CharStream.fromString(sql));
    lexer.removeErrorListeners();
    const tokenStream = new CommonTokenStream(lexer);
    tokenStream.fill();
    const parser = new SqlBaseParser(tokenStream);
    parser.removeErrorListeners();
    parser.buildParseTrees = false;
    parser.singleStatement();
    return analyseGrammarAt(parser, lastDefaultChannelTokenIndex(parser), extendingPrevious);
  } catch {
    return { keywords: [], identifierKind: null, empty: true };
  }
}

/** Repair malformed input by injecting `PHANTOM` before every keyword the
 *  parser flagged as extraneous (e.g. the FROMs in "SELECT FROM (SELECT FROM
 *  t)"). Uses ANTLR's own error reporting — no c3, no enumeration. Returns
 *  the repaired string, or null if there were no actionable errors. */
function repairWithParserErrors(sql: string): string | null {
  const insertBefore: number[] = [];
  try {
    const lexer = new SqlBaseLexer(CharStream.fromString(sql));
    lexer.removeErrorListeners();
    const tokenStream = new CommonTokenStream(lexer);
    tokenStream.fill();
    const parser = new SqlBaseParser(tokenStream);
    parser.removeErrorListeners();
    parser.buildParseTrees = false;
    parser.addErrorListener({
      syntaxError(_recognizer, offendingSymbol) {
        // Only act on keyword tokens — the parser flags `)`, `]`, etc. when
        // it gets confused, but inserting before them never helps.
        // Also skip the appended phantom itself.
        if (
          offendingSymbol &&
          KEYWORD_TOKEN_SET.has(offendingSymbol.type) &&
          offendingSymbol.text !== PHANTOM
        ) {
          insertBefore.push(offendingSymbol.start);
        }
      },
      // ANTLR's ATN simulator may invoke these during prediction; if any are
      // missing the parser throws mid-parse and we lose subsequent errors.
      reportAmbiguity() {},
      reportAttemptingFullContext() {},
      reportContextSensitivity() {}
    });
    parser.singleStatement();
  } catch {
    /* error listener already collected what it could */
  }
  if (insertBefore.length === 0) return null;

  // Apply insertions right-to-left so positions don't shift.
  const sorted = [...new Set(insertBefore)].sort((a, b) => b - a);
  let out = sql;
  for (const start of sorted) {
    out = out.slice(0, start) + PHANTOM + ' ' + out.slice(start);
  }
  return out;
}

function lastDefaultChannelTokenIndex(parser: SqlBaseParser): number {
  const all = (parser.inputStream as CommonTokenStream).getTokens();
  for (let k = all.length - 1; k >= 0; k--) {
    const tk = all[k];
    if (tk.channel === Token.DEFAULT_CHANNEL && tk.type !== SqlBaseLexer.EOF) {
      return tk.tokenIndex;
    }
  }
  return 0;
}

let cachedTopLevel: string[] | null = null;
function computeTopLevelKeywords(): string[] {
  if (cachedTopLevel) return cachedTopLevel;
  try {
    const lexer = new SqlBaseLexer(CharStream.fromString(' '));
    lexer.removeErrorListeners();
    const tokenStream = new CommonTokenStream(lexer);
    tokenStream.fill();
    const parser = new SqlBaseParser(tokenStream);
    parser.removeErrorListeners();
    parser.buildParseTrees = false;
    parser.singleStatement();
    // Empty input: no rule extension to consider.
    cachedTopLevel = analyseGrammarAt(parser, 0, false).keywords;
  } catch {
    cachedTopLevel = [];
  }
  return cachedTopLevel ?? [];
}

// --- public API --------------------------------------------------------------

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

/** Main entry point used by the Monaco completion provider. */
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

  // Work on the statement substring. We deliberately do NOT clamp to
  // statement.sql.length: the statement range is trimmed of surrounding
  // whitespace, but we still want to treat trailing whitespace after the last
  // token as "cursor past the final token" so the phantom-char insertion
  // below triggers and c3 sees the correct grammar position.
  const cursorInStatement = Math.max(0, cursorOffset - statement.offset);

  // Phantom-char insertion: if the cursor is mid-word or immediately after a
  // dot, inject a placeholder so the parser produces a real token there.
  // We only do this when the cursor is at the END of the analysed substring,
  // to keep the token indexes stable.
  const analysed = statement.sql.slice(0, cursorInStatement);
  const tokens = lexNonHidden(analysed);
  const prefixInfo = extractPrefixAtCursor(tokens, cursorInStatement);

  // Build alias map from the FULL statement so aliases declared after the
  // cursor (rare but possible when editing existing code) are still seen.
  const fullTokens = lexNonHidden(statement.sql);
  const aliasMap = extractAliasMap(fullTokens);

  // Append a phantom whenever the cursor is NOT inside a partial word so c3
  // has a token at the cursor to target — covers empty input, after whitespace,
  // after a dot, and immediately after operators/punctuation (`(`, `,`, `=`).
  const phantom = prefixInfo.wordAtCursor === '' ? ' ' + PHANTOM : '';
  // The cursor extends an in-progress identifier when we're mid-typing
  // (wordAtCursor non-empty) or right after a dot. In both cases an "earlier
  // start" qualifiedName/identifier rule still applies at the cursor.
  const lastToken = tokens[tokens.length - 1];
  const extendingPrevious =
    prefixInfo.wordAtCursor !== '' || (lastToken !== undefined && lastToken.type === DOT);

  // Try the input as-is. If c3 returns nothing, the parser couldn't reach the
  // cursor — usually a missing expression somewhere in the middle (e.g.
  // "SELECT FROM …", or nested "SELECT FROM (SELECT FROM t)" with multiple
  // missing slots). Let ANTLR's own error listener pinpoint extraneous keyword
  // tokens, inject a phantom before each, and re-run. Iterate because the
  // default error strategy reports only the first error before resyncing.
  // Grammar-agnostic: no clause-keyword enumeration.
  const MAX_REPAIR_PASSES = 4;
  let working = analysed + phantom;
  let grammar = parseAndAnalyse(working, extendingPrevious);
  for (let pass = 0; pass < MAX_REPAIR_PASSES && grammar.empty; pass++) {
    const repaired = repairWithParserErrors(working);
    if (!repaired || repaired === working) break;
    working = repaired;
    grammar = parseAndAnalyse(working, extendingPrevious);
  }

  return {
    statement,
    keywords: grammar.keywords,
    identifierKind: grammar.identifierKind,
    prefixParts: prefixInfo.prefixParts,
    wordAtCursor: prefixInfo.wordAtCursor,
    aliasMap
  };
}

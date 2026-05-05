// Grammar-driven answers for "what is legal at the cursor?". Runs
// antlr4-c3's CodeCompletionCore against the partial SQL up to the cursor
// and classifies the slot as relation / column / keyword-only via
// preferred rules. Repair for malformed mid-edit SQL arrives in a
// follow-up PR.

import { CharStream, CommonTokenStream, Token } from 'antlr4ng';
import { CodeCompletionCore } from 'antlr4-c3';
import { SqlBaseLexer } from '../generated/SqlBaseLexer.js';
import { SqlBaseParser } from '../generated/SqlBaseParser.js';
import { tokenMap } from '../tokenMap.js';
import { DOT } from '../lexer-utils.js';

export type IdentifierKind = 'relation' | 'column' | null;

/** Placeholder identifier injected at the cursor so c3 has a token to target.
 *  Only ever appended to SQL we just lexed; no collision risk. */
const PHANTOM = '__phantom__';

export interface GrammarAnalysis {
  keywords: string[];
  identifierKind: IdentifierKind;
  /** True when c3 found nothing reachable at the cursor — usually because the
   *  partial input couldn't be parsed at all. A later PR adds a repair loop
   *  that retries the analysis after patching extraneous keywords. */
  isUnparseable: boolean;
}

// --- shared parser setup -----------------------------------------------------

/** Build a SqlBaseParser for `sql` with default error listeners removed and
 *  parse-tree building disabled (we only need c3, not a tree). */
function buildParser(sql: string): { parser: SqlBaseParser; tokenStream: CommonTokenStream } {
  const lexer = new SqlBaseLexer(CharStream.fromString(sql));
  lexer.removeErrorListeners();
  const tokenStream = new CommonTokenStream(lexer);
  tokenStream.fill();
  const parser = new SqlBaseParser(tokenStream);
  parser.removeErrorListeners();
  parser.buildParseTrees = false;
  return { parser, tokenStream };
}

// --- c3 keyword extraction ---------------------------------------------------

const KEYWORD_TOKEN_SET = new Set<number>(
  Object.entries(tokenMap)
    .filter(([, scope]) => scope === 'keyword')
    .map(([type]) => Number(type))
);

// Generated lexers expose `literalNames` as a static array whose shape isn't
// surfaced in the `.d.ts`. Cast once here; consume as a typed local.
const LITERAL_NAMES = (SqlBaseLexer as unknown as { literalNames: (string | null)[] }).literalNames;

/** Map a keyword token type back to its canonical uppercase spelling.
 *  `literalNames` entries look like `"'SELECT'"` (SQL single-quoted). */
function keywordForToken(tokenType: number): string | null {
  const literal = LITERAL_NAMES[tokenType];
  if (!literal) return null;
  const match = /^'(.+)'$/.exec(literal);
  return match ? match[1].toUpperCase() : null;
}

/** Run CodeCompletionCore once to derive both the grammar-valid keywords and
 *  the identifier kind (relation vs. column) at the cursor.
 *
 *  Classification is driven entirely by which preferred rules c3 reports as
 *  reachable at the cursor — no hand-maintained keyword lists:
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
   *  mid-identifier (`mysch|`) or right after a dot (`mycat.|`). */
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
    return { keywords: [], identifierKind: null, isUnparseable: true };
  }

  // A rule is "valid at the cursor" in two situations:
  //   (1) it starts exactly at the cursor token — a fresh slot is opening here;
  //   (2) `extendingPrevious` is set — the cursor is in the middle of an
  //       identifier or right after a dot, so a qualifiedName / identifier /
  //       primaryExpression that started earlier is still being built up at
  //       the cursor (e.g. for `SELECT t.|` c3 reports primaryExpression
  //       starting at `t`, but we ARE at that primary expression).
  //
  // Without (1), we would wrongly propose completions inside *finished*
  // expressions — e.g. for `WHERE address |`, c3 reports primaryExpression
  // starting at `address`, but that expression is complete; the user wants
  // the next keyword (AND, =, IS, …), not another column.
  const ruleValidAtCursor = (rule: number): boolean => {
    const info = candidates.rules.get(rule);
    if (!info) return false;
    if (info.startTokenIndex === tokenIndexAtCursor) return true;
    return extendingPrevious;
  };

  const hasIdentifier = ruleValidAtCursor(SqlBaseParser.RULE_identifier);
  const hasPrimaryExpr = ruleValidAtCursor(SqlBaseParser.RULE_primaryExpression);
  const hasQualifiedName = ruleValidAtCursor(SqlBaseParser.RULE_qualifiedName);
  let identifierKind: IdentifierKind = null;
  if (!hasIdentifier) {
    if (hasPrimaryExpr) identifierKind = 'column';
    else if (hasQualifiedName) identifierKind = 'relation';
  }

  const keywords = new Set<string>();
  for (const tokenType of candidates.tokens.keys()) {
    // Surface keyword tokens (SELECT, FROM, …) and `*` — the grammar accepts
    // `*` in place of a keyword for SELECT-all / `t.*` / COUNT(*). Skip other
    // operators and punctuation: the user types those directly.
    if (!KEYWORD_TOKEN_SET.has(tokenType) && tokenType !== SqlBaseLexer.ASTERISK) continue;
    const keyword = keywordForToken(tokenType);
    if (keyword) keywords.add(keyword);
  }
  const isUnparseable = candidates.rules.size === 0 && candidates.tokens.size === 0;
  return { keywords: [...keywords].sort(), identifierKind, isUnparseable };
}

/** Lex+parse `sql` and run the c3 grammar analysis at its final token. */
function parseAndAnalyse(sql: string, extendingPrevious: boolean): GrammarAnalysis {
  try {
    const { parser } = buildParser(sql);
    parser.singleStatement();
    return analyseGrammarAt(parser, lastDefaultChannelTokenIndex(parser), extendingPrevious);
  } catch {
    return { keywords: [], identifierKind: null, isUnparseable: true };
  }
}

/** Index of the last non-EOF token on the default channel. Falls back to 0
 *  for empty / whitespace-only input so c3 has a valid anchor. */
function lastDefaultChannelTokenIndex(parser: SqlBaseParser): number {
  const tokens = (parser.inputStream as CommonTokenStream).getTokens();
  for (let i = tokens.length - 1; i >= 0; i--) {
    const token = tokens[i];
    if (token.channel === Token.DEFAULT_CHANNEL && token.type !== SqlBaseLexer.EOF) {
      return token.tokenIndex;
    }
  }
  return 0;
}

let cachedTopLevel: string[] | null = null;

/** The grammar-valid keywords at the start of an empty statement, memoised.
 *  One c3 invocation against a single-whitespace string; amortised across
 *  every empty-editor completion thereafter. */
export function computeTopLevelKeywords(): string[] {
  if (cachedTopLevel) return cachedTopLevel;
  try {
    const { parser } = buildParser(' ');
    parser.singleStatement();
    cachedTopLevel = analyseGrammarAt(parser, 0, false).keywords;
  } catch {
    cachedTopLevel = [];
  }
  return cachedTopLevel ?? [];
}

/** Append a phantom token if the cursor isn't already inside a partial word,
 *  then run the grammar analysis once. A follow-up PR wraps this in a repair
 *  loop that iterates when c3 reports nothing reachable. */
export function analyseAtCursor(
  sqlUpToCursor: string,
  prefix: { prefixParts: string[]; wordAtCursor: string },
  tokensUpToCursor: Token[]
): GrammarAnalysis {
  const midWord = prefix.wordAtCursor !== '';
  const afterDot = tokensUpToCursor[tokensUpToCursor.length - 1]?.type === DOT;

  // Append a phantom whenever the cursor is NOT inside a partial word — c3
  // needs a real token at the cursor. Covers empty input, after whitespace,
  // after a dot, and immediately after operators/punctuation (`(`, `,`, `=`).
  const phantom = midWord ? '' : ' ' + PHANTOM;

  // The cursor extends an in-progress identifier rule when we're mid-word or
  // right after a dot; see `analyseGrammarAt` for what that unlocks.
  const extendingPrevious = midWord || afterDot;

  return parseAndAnalyse(sqlUpToCursor + phantom, extendingPrevious);
}

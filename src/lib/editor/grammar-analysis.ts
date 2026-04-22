// Phase 2 of completion analysis: grammar-driven answers for "what is legal
// at the cursor?". Runs antlr4-c3's CodeCompletionCore against the partial SQL
// up to the cursor, classifies the slot as relation / column / keyword-only
// via preferred rules, and wraps the whole thing in a repair loop so that
// mid-edit malformed input still produces useful suggestions.

import {
  ATNSimulator,
  BaseErrorListener,
  CharStream,
  CommonTokenStream,
  Recognizer,
  Token
} from 'antlr4ng';
import { CodeCompletionCore } from 'antlr4-c3';
import { SqlBaseLexer } from './generated/SqlBaseLexer.js';
import { SqlBaseParser } from './generated/SqlBaseParser.js';
import { tokenMap } from './tokenMap.js';
import { DOT } from './lexer-utils.js';

export type IdentifierKind = 'relation' | 'column' | null;

/** Placeholder identifier injected at gaps so c3 has a token to target.
 *  Only ever inserted into SQL we just lexed; no collision risk. */
const PHANTOM = '__phantom__';

/** Upper bound on the repair loop. ANTLR's default error strategy reports only
 *  one error per parse before resyncing, so each pass fixes at most one gap. */
const MAX_REPAIR_PASSES = 4;

export interface GrammarAnalysis {
  keywords: string[];
  identifierKind: IdentifierKind;
  /** True when c3 found nothing reachable at the cursor — usually because the
   *  partial input couldn't be parsed at all. Caller may retry with repairs. */
  empty: boolean;
}

// --- shared parser setup -----------------------------------------------------

/** Build a SqlBaseParser for `sql` with default error listeners removed and
 *  parse-tree building disabled (we only need c3 / error events, not a tree). */
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
const LITERAL_NAMES = (SqlBaseLexer as unknown as { literalNames: (string | null)[] })
  .literalNames;

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
   *  mid-identifier (`mysch|`) or right after a dot (`mycat.|`). See
   *  `ruleAppliesAtCursor` for how this affects rule matching. */
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

  // A rule "applies at the cursor" in two situations:
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
  const ruleAppliesAtCursor = (rule: number): boolean => {
    const info = candidates.rules.get(rule);
    if (!info) return false;
    if (info.startTokenIndex === tokenIndexAtCursor) return true;
    return extendingPrevious;
  };

  const hasIdentifier = ruleAppliesAtCursor(SqlBaseParser.RULE_identifier);
  const hasPrimaryExpr = ruleAppliesAtCursor(SqlBaseParser.RULE_primaryExpression);
  const hasQualifiedName = ruleAppliesAtCursor(SqlBaseParser.RULE_qualifiedName);
  let identifierKind: IdentifierKind = null;
  if (!hasIdentifier) {
    if (hasPrimaryExpr) identifierKind = 'column';
    else if (hasQualifiedName) identifierKind = 'relation';
  }

  const keywords = new Set<string>();
  for (const tokenType of candidates.tokens.keys()) {
    // Surface keyword tokens (SELECT, FROM, …) and `*` — the grammar accepts
    // `*` in place of a keyword for SELECT-all / `t.*` / COUNT(*). Skip other
    // operators and punctuation: the user types those directly and doesn't
    // need them in the suggestion list.
    if (!KEYWORD_TOKEN_SET.has(tokenType) && tokenType !== SqlBaseLexer.ASTERISK) continue;
    const keyword = keywordForToken(tokenType);
    if (keyword) keywords.add(keyword);
  }
  const empty = candidates.rules.size === 0 && candidates.tokens.size === 0;
  return { keywords: [...keywords].sort(), identifierKind, empty };
}

/** Lex+parse `sql` and run the c3 grammar analysis at its final token. */
function parseAndAnalyse(sql: string, extendingPrevious: boolean): GrammarAnalysis {
  try {
    const { parser } = buildParser(sql);
    parser.singleStatement();
    return analyseGrammarAt(parser, lastDefaultChannelTokenIndex(parser), extendingPrevious);
  } catch {
    return { keywords: [], identifierKind: null, empty: true };
  }
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
export function computeTopLevelKeywords(): string[] {
  if (cachedTopLevel) return cachedTopLevel;
  try {
    const { parser } = buildParser(' ');
    parser.singleStatement();
    // Empty input: no rule extension to consider.
    cachedTopLevel = analyseGrammarAt(parser, 0, false).keywords;
  } catch {
    cachedTopLevel = [];
  }
  return cachedTopLevel ?? [];
}

// --- repair pass -------------------------------------------------------------

/** Error listener for the repair pass: collects the `start` offset of every
 *  keyword token ANTLR flags as extraneous. Extends `BaseErrorListener` so
 *  the ambiguity / full-context / context-sensitivity reporters fall back to
 *  its no-op defaults. */
class RepairErrorListener extends BaseErrorListener {
  readonly insertBefore: number[] = [];
  override syntaxError(
    _recognizer: Recognizer<ATNSimulator>,
    offendingSymbol: Token | null
  ): void {
    // Only act on keyword tokens — the parser flags `)`, `]`, etc. when
    // confused, but inserting before them never helps. Skip the appended
    // phantom itself too.
    if (
      offendingSymbol &&
      KEYWORD_TOKEN_SET.has(offendingSymbol.type) &&
      offendingSymbol.text !== PHANTOM
    ) {
      this.insertBefore.push(offendingSymbol.start);
    }
  }
}

/** Repair malformed input by injecting `PHANTOM` before every keyword the
 *  parser flagged as extraneous (e.g. the FROMs in "SELECT FROM (SELECT FROM
 *  t)"). Uses ANTLR's own error reporting — no c3, no enumeration. Returns
 *  the repaired string, or null if there were no actionable errors. */
function repairWithParserErrors(sql: string): string | null {
  const listener = new RepairErrorListener();
  try {
    const { parser } = buildParser(sql);
    parser.addErrorListener(listener);
    parser.singleStatement();
  } catch {
    /* listener already collected what it could */
  }
  if (listener.insertBefore.length === 0) return null;

  // Apply insertions right-to-left so positions don't shift.
  const sorted = [...new Set(listener.insertBefore)].sort((a, b) => b - a);
  let out = sql;
  for (const start of sorted) {
    out = out.slice(0, start) + PHANTOM + ' ' + out.slice(start);
  }
  return out;
}

/** Run c3 at the cursor; if c3 reports nothing reachable, iterate: let the
 *  parser's error listener point out extraneous keywords, inject a phantom
 *  before each, and re-run. Bounded by MAX_REPAIR_PASSES because the default
 *  error strategy reports only one error per parse before resyncing. */
export function analyseWithRepair(
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

  let working = sqlUpToCursor + phantom;
  let analysis = parseAndAnalyse(working, extendingPrevious);
  for (let pass = 0; pass < MAX_REPAIR_PASSES && analysis.empty; pass++) {
    const repaired = repairWithParserErrors(working);
    if (!repaired || repaired === working) break;
    working = repaired;
    analysis = parseAndAnalyse(working, extendingPrevious);
  }
  return analysis;
}

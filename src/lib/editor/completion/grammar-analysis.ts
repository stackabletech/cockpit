// Grammar-driven answers for "what is legal at the cursor?". Runs
// antlr4-c3's CodeCompletionCore against the partial SQL up to the cursor
// and classifies the slot as relation / column / keyword-only via
// preferred rules. When c3 reports nothing reachable because the mid-edit
// SQL is malformed (e.g. `SELECT FROM ...`), a repair loop iterates:
// ANTLR's error listener flags extraneous keyword tokens, we inject a
// phantom identifier before each, and retry.

import {
  ATNSimulator,
  BaseErrorListener,
  CharStream,
  CommonTokenStream,
  Recognizer,
  Token
} from 'antlr4ng';
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
  /** True when c3 found nothing reachable at the cursor — usually because
   *  the partial input couldn't be parsed at all. Drives the repair retry
   *  in `analyseAtCursor`. */
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

// --- repair pass -------------------------------------------------------------

/** Collects the `start` offset of every keyword token ANTLR flags as
 *  extraneous during a parse. Example: in `SELECT FROM foo`, `SELECT`
 *  expects a column name before `FROM`, but nothing was typed there —
 *  so ANTLR flags `FROM` as an unexpected keyword. Each such flag marks
 *  an empty identifier slot sitting just before the keyword. Extends
 *  `BaseErrorListener` so the ambiguity / full-context / context-
 *  sensitivity reporters fall back to no-op defaults. */
class RepairErrorListener extends BaseErrorListener {
  readonly insertBefore: number[] = [];
  override syntaxError(_recognizer: Recognizer<ATNSimulator>, offendingSymbol: Token | null): void {
    // We fill empty identifier slots by inserting a phantom before the
    // flagged token. That only works for keywords: keywords in Trino's
    // grammar are what comes *after* identifier slots (SELECT <col> FROM
    // <tab>), so an extraneous keyword reliably signals a missing
    // identifier just before it. Punctuation (`)`, `]`, `,`) and operators
    // flagged as extraneous indicate different grammar problems and aren't
    // fixable by a phantom. Also skip our own phantoms so a second repair
    // pass doesn't chain onto them.
    if (
      offendingSymbol &&
      KEYWORD_TOKEN_SET.has(offendingSymbol.type) &&
      offendingSymbol.text !== PHANTOM
    ) {
      this.insertBefore.push(offendingSymbol.start);
    }
  }
}

/** Fill empty identifier slots in malformed input. When a user types
 *  `SELECT FROM foo`, they've skipped the column name that SELECT expects
 *  — ANTLR flags `FROM` as unexpected because it arrived where an
 *  identifier was due. We insert a phantom identifier before each such
 *  flag, giving the next parse something to consume in the gap. Returns
 *  the patched string, or null if there were no actionable errors. */
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

  // Apply insertions right-to-left so earlier offsets aren't shifted by
  // later inserts.
  const sorted = [...new Set(listener.insertBefore)].sort((a, b) => b - a);
  let patched = sql;
  for (const start of sorted) {
    patched = patched.slice(0, start) + PHANTOM + ' ' + patched.slice(start);
  }
  return patched;
}

/** Append a phantom token if the cursor isn't already inside a partial word,
 *  run the grammar analysis, and iterate the repair pass while c3 reports
 *  nothing reachable. The loop terminates as soon as repair can't change the
 *  string further — each successful pass strictly grows the input by
 *  inserting a phantom, so this is guaranteed to halt. */
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

  let candidateSql = sqlUpToCursor + phantom;
  let analysis = parseAndAnalyse(candidateSql, extendingPrevious);
  while (analysis.isUnparseable) {
    const repaired = repairWithParserErrors(candidateSql);
    if (!repaired || repaired === candidateSql) break;
    candidateSql = repaired;
    analysis = parseAndAnalyse(candidateSql, extendingPrevious);
  }
  return analysis;
}

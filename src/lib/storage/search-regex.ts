import { RegExpParser } from 'regexpp';
import type { AST } from 'regexpp';

const MAX_PATTERN_LENGTH = 512;
const MAX_AST_NODES = 200;
const MAX_REPEAT = 1_000;
// S3 object keys are at most 1024 bytes, so an unbounded repetition can never
// consume more characters than that.
const MAX_KEY_LENGTH = 1_024;
// Upper bound for the number of ways a single alternative may split its input
// across repetitions. One unbounded repetition plus small bounded ones (such as
// `\d{1,5}`) fit; two unbounded ones (polynomial backtracking) do not.
const MAX_MATCH_WIDTH = (MAX_KEY_LENGTH + 1) * 8;

export class UnsafeSearchRegexError extends Error {}

/**
 * Parse and constrain regexes before handing them to the JavaScript regex engine.
 * The policy excludes constructs that can cause catastrophic backtracking.
 */
export function createSafeSearchRegex(pattern: string): RegExp {
  if (pattern.length > MAX_PATTERN_LENGTH) {
    throw new UnsafeSearchRegexError(
      `Regular expression must not exceed ${MAX_PATTERN_LENGTH} characters`
    );
  }

  let ast: AST.Pattern;
  try {
    ast = new RegExpParser({ ecmaVersion: 2022 }).parsePattern(pattern);
  } catch {
    throw new UnsafeSearchRegexError('Regular expression is invalid');
  }

  if (countNodes(ast) > MAX_AST_NODES) {
    throw new UnsafeSearchRegexError('Regular expression is too complex');
  }
  assertSafe(ast);

  try {
    return new RegExp(pattern, 'i');
  } catch {
    throw new UnsafeSearchRegexError('Regular expression is invalid');
  }
}

function assertSafe(node: AST.Node): void {
  if (node.type === 'Backreference') {
    throw new UnsafeSearchRegexError('Regular expression backreferences are not supported');
  }
  if (node.type === 'Assertion' && (node.kind === 'lookahead' || node.kind === 'lookbehind')) {
    throw new UnsafeSearchRegexError('Regular expression lookarounds are not supported');
  }
  if (node.type === 'Quantifier') {
    if (node.max !== Infinity && node.max > MAX_REPEAT) {
      throw new UnsafeSearchRegexError('Regular expression repeat count is too large');
    }
    if (containsQuantifier(node.element)) {
      throw new UnsafeSearchRegexError('Nested regular expression repetitions are not supported');
    }
    if (node.max === Infinity && isAlternatingGroup(node.element)) {
      throw new UnsafeSearchRegexError('Unbounded repetitions of alternatives are not supported');
    }
  }
  if (node.type === 'Alternative' && matchWidth(node) > MAX_MATCH_WIDTH) {
    throw new UnsafeSearchRegexError('Regular expression combines too many repetitions');
  }

  for (const child of childrenOf(node)) assertSafe(child);
}

function containsQuantifier(node: AST.Node): boolean {
  if (node.type === 'Quantifier') return true;
  return childrenOf(node).some(containsQuantifier);
}

function isAlternatingGroup(node: AST.QuantifiableElement): boolean {
  return (node.type === 'Group' || node.type === 'CapturingGroup') && node.alternatives.length > 1;
}

/**
 * Estimate how many ways an alternative can split its input across its
 * repetitions, including those inside (non-repeated) groups. Backtracking cost
 * grows with this number, so it must stay bounded.
 */
function matchWidth(node: AST.Alternative): number {
  return node.elements.reduce((width, element) => width * elementWidth(element), 1);
}

function elementWidth(node: AST.Element): number {
  if (node.type === 'Group' || node.type === 'CapturingGroup') {
    if (isUnambiguousLiteralChoice(node.alternatives)) return 1;
    return node.alternatives.reduce((total, alternative) => total + matchWidth(alternative), 0);
  }
  if (node.type === 'Quantifier') {
    const span = Math.max(1, Math.min(node.max, MAX_KEY_LENGTH) - node.min + 1);
    const inner = elementWidth(node.element);
    return inner > 1 ? inner ** span : span;
  }
  return 1;
}

/**
 * True when every alternative is a plain literal and none is a prefix of
 * another (case-insensitively, matching the `i` flag), e.g. `(csv|json|orc)`.
 * At most one alternative can then match at any position, so the group adds
 * no backtracking. `(a|aa)` does not qualify.
 */
function isUnambiguousLiteralChoice(alternatives: AST.Alternative[]): boolean {
  const literals: string[] = [];
  for (const { elements } of alternatives) {
    const codePoints: number[] = [];
    for (const element of elements) {
      if (element.type !== 'Character') return false;
      codePoints.push(element.value);
    }
    literals.push(String.fromCodePoint(...codePoints).toLowerCase());
  }
  return literals.every((literal, index) =>
    literals.every((other, otherIndex) => otherIndex === index || !other.startsWith(literal))
  );
}

function countNodes(node: AST.Node): number {
  return 1 + childrenOf(node).reduce((total, child) => total + countNodes(child), 0);
}

function childrenOf(node: AST.Node): AST.Node[] {
  switch (node.type) {
    case 'Pattern':
    case 'Group':
    case 'CapturingGroup':
      return node.alternatives;
    case 'Alternative':
      return node.elements;
    case 'Quantifier':
      return [node.element];
    case 'CharacterClass':
      return node.elements;
    case 'CharacterClassRange':
      return [node.min, node.max];
    case 'Assertion':
      return 'alternatives' in node ? node.alternatives : [];
    default:
      return [];
  }
}

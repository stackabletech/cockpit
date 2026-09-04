import { RegExpParser } from 'regexpp';
import type { AST } from 'regexpp';

const MAX_PATTERN_LENGTH = 512;
const MAX_AST_NODES = 200;
const MAX_REPEAT = 1_000;

export class UnsafeSearchRegexError extends Error {}

/**
 * Parse and constrain regexes before handing them to the JavaScript regex engine.
 * The policy excludes constructs that can cause catastrophic backtracking.
 */
export function createSafeSearchRegex(pattern: string): RegExp {
  if (pattern.length > MAX_PATTERN_LENGTH) {
    throw new UnsafeSearchRegexError('Regular expression must not exceed 512 characters');
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
  if (node.type === 'Alternative' && countUnboundedQuantifiers(node) > 1) {
    throw new UnsafeSearchRegexError(
      'Multiple unbounded regular expression repetitions are not supported'
    );
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

function countUnboundedQuantifiers(node: AST.Alternative): number {
  return node.elements.filter(
    (element) => element.type === 'Quantifier' && element.max === Infinity
  ).length;
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

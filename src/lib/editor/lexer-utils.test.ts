import { describe, it, expect } from 'vitest';
import { SqlBaseLexer } from './generated/SqlBaseLexer';
import { DOT, LPAREN, RPAREN, COMMA, lexSql, readQualifiedName } from './lexer-utils';

// Guard against ANTLR grammar regeneration silently shifting implicit token
// numbering. If any of these fail after running `npm run generate:antlr`,
// update the constants in lexer-utils.ts to match the new literalNames order.
describe('implicit token constants match the generated grammar', () => {
  const names = SqlBaseLexer.literalNames;

  // eslint-disable-next-line security/detect-object-injection
  it('DOT is "."', () => expect(names[DOT]).toBe("'.'"));
  // eslint-disable-next-line security/detect-object-injection
  it('LPAREN is "("', () => expect(names[LPAREN]).toBe("'('"));
  // eslint-disable-next-line security/detect-object-injection
  it('RPAREN is ")"', () => expect(names[RPAREN]).toBe("')'"));
  // eslint-disable-next-line security/detect-object-injection
  it('COMMA is ","', () => expect(names[COMMA]).toBe("','"));
});

describe('lexSql', () => {
  it('extracts tokens from a simple query', () => {
    const tokens = lexSql('SELECT 1');
    expect(tokens.map((t) => t.text)).toEqual(['SELECT', '1']);
  });

  it('ignores comments and whitespace', () => {
    const tokens = lexSql('SELECT -- comment\n1 /* block */');
    expect(tokens.map((t) => t.text)).toEqual(['SELECT', '1']);
  });

  it('handles quoted identifiers', () => {
    const tokens = lexSql('SELECT "my column" FROM `my table`');
    expect(tokens.map((t) => t.text)).toEqual(['SELECT', '"my column"', 'FROM', '`my table`']);
  });
});

describe('readQualifiedName', () => {
  it('reads a single identifier', () => {
    const tokens = lexSql('foo');
    const result = readQualifiedName(tokens, 0);
    expect(result.parts).toEqual(['foo']);
    expect(result.next).toBe(1);
  });

  it('reads a dotted path', () => {
    const tokens = lexSql('cat.sch.tab');
    const result = readQualifiedName(tokens, 0);
    expect(result.parts).toEqual(['cat', 'sch', 'tab']);
    expect(result.next).toBe(5); // ident, dot, ident, dot, ident
  });

  it('stops at non-identifier tokens', () => {
    const tokens = lexSql('cat.sch (');
    const result = readQualifiedName(tokens, 0);
    expect(result.parts).toEqual(['cat', 'sch']);
    expect(result.next).toBe(3);
  });

  it('handles quoted segments in path', () => {
    const tokens = lexSql('cat."sch.with.dots".tab');
    const result = readQualifiedName(tokens, 0);
    expect(result.parts).toEqual(['cat', 'sch.with.dots', 'tab']);
  });

  it('stops at a trailing dot', () => {
    const tokens = lexSql('cat.sch.');
    const result = readQualifiedName(tokens, 0);
    expect(result.parts).toEqual(['cat', 'sch']);
    expect(result.next).toBe(3); // stays before the trailing dot
  });
});

import { describe, it, expect } from 'vitest';
import { SqlBaseLexer } from './generated/SqlBaseLexer';
import { DOT, LPAREN, RPAREN, COMMA } from './lexer-utils';

// Guard against ANTLR grammar regeneration silently shifting implicit token
// numbering. If any of these fail after running `npm run generate:antlr`,
// update the constants in lexer-utils.ts to match the new literalNames order.
describe('implicit token constants match the generated grammar', () => {
  const names = SqlBaseLexer.literalNames;

  it('DOT is "."', () => expect(names[DOT]).toBe("'.'"));
  it('LPAREN is "("', () => expect(names[LPAREN]).toBe("'('"));
  it('RPAREN is ")"', () => expect(names[RPAREN]).toBe("')'"));
  it('COMMA is ","', () => expect(names[COMMA]).toBe("','"));
});

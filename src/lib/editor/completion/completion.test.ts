import { describe, it, expect } from 'vitest';
import { analyseCompletion } from './completion';

/** Build an analyse-args pair from a string with `|` marking the cursor.
 *  Makes the cursor offset obvious in the test body. */
function at(template: string): { sql: string; cursorOffset: number } {
  const cursorOffset = template.indexOf('|');
  if (cursorOffset < 0) throw new Error("cursor marker '|' missing");
  const sql = template.slice(0, cursorOffset) + template.slice(cursorOffset + 1);
  return { sql, cursorOffset };
}

describe('analyseCompletion — cursor context', () => {
  it('returns top-level keywords for an empty editor', () => {
    const analysis = analyseCompletion({ sql: '', cursorOffset: 0 });
    expect(analysis.statement).toBeNull();
    expect(analysis.keywords).toContain('SELECT');
    expect(analysis.keywords).toContain('WITH');
    expect(analysis.keywords).toContain('CREATE');
    expect(analysis.prefixParts).toEqual([]);
    expect(analysis.wordAtCursor).toBe('');
    expect(analysis.identifierKind).toBeNull();
  });

  it('returns top-level keywords for a whitespace-only editor', () => {
    const analysis = analyseCompletion({ sql: '   \n  ', cursorOffset: 2 });
    expect(analysis.statement).toBeNull();
    expect(analysis.keywords).toContain('SELECT');
  });

  it('reads a partial word at the cursor', () => {
    const analysis = analyseCompletion(at('SELECT * FROM fo|o'));
    expect(analysis.prefixParts).toEqual([]);
    expect(analysis.wordAtCursor).toBe('fo');
  });

  it('reads a dotted prefix with a partial word at the cursor', () => {
    const analysis = analyseCompletion(at('SELECT * FROM cat.sch|'));
    expect(analysis.prefixParts).toEqual(['cat']);
    expect(analysis.wordAtCursor).toBe('sch');
  });

  it('reads a dotted prefix with empty word after a trailing dot', () => {
    const analysis = analyseCompletion(at('SELECT * FROM cat.sch.|'));
    expect(analysis.prefixParts).toEqual(['cat', 'sch']);
    expect(analysis.wordAtCursor).toBe('');
  });

  it('walks a three-level dotted path', () => {
    const analysis = analyseCompletion(at('SELECT * FROM cat.sch.tab.|'));
    expect(analysis.prefixParts).toEqual(['cat', 'sch', 'tab']);
    expect(analysis.wordAtCursor).toBe('');
  });

  it('surfaces the statement the cursor is in for multi-statement input', () => {
    const analysis = analyseCompletion(at('SELECT 1; SELECT * FROM fo|o'));
    expect(analysis.statement).not.toBeNull();
    expect(analysis.statement?.sql.startsWith('SELECT *')).toBe(true);
    expect(analysis.wordAtCursor).toBe('fo');
  });
});

describe('analyseCompletion — grammar classification', () => {
  it('classifies a FROM target as a relation slot', () => {
    const analysis = analyseCompletion(at('SELECT * FROM |'));
    expect(analysis.identifierKind).toBe('relation');
  });

  it('classifies a mid-identifier FROM target as a relation slot', () => {
    const analysis = analyseCompletion(at('SELECT * FROM fo|'));
    expect(analysis.identifierKind).toBe('relation');
  });

  it('classifies a bare SELECT list slot as a column slot', () => {
    const analysis = analyseCompletion(at('SELECT | FROM foo'));
    expect(analysis.identifierKind).toBe('column');
  });

  it('classifies an alias-qualified SELECT expression as a column slot', () => {
    const analysis = analyseCompletion(at('SELECT t.| FROM foo t'));
    expect(analysis.identifierKind).toBe('column');
  });

  it('classifies a position after a completed expression as keyword-only', () => {
    const analysis = analyseCompletion(at('SELECT * FROM foo WHERE address |'));
    expect(analysis.identifierKind).toBeNull();
  });

  it('filters keywords by grammar context', () => {
    // At the very start of a statement, SELECT is grammar-valid but JOIN is not.
    const start = analyseCompletion({ sql: '', cursorOffset: 0 });
    expect(start.keywords).toContain('SELECT');
    expect(start.keywords).not.toContain('JOIN');

    // After FROM foo, JOIN becomes grammar-valid.
    const afterFrom = analyseCompletion(at('SELECT * FROM foo |'));
    expect(afterFrom.keywords).toContain('JOIN');
  });
});

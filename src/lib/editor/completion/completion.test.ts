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

describe('analyseCompletion — base layer', () => {
  it('returns top-level keywords for an empty editor', () => {
    const r = analyseCompletion({ sql: '', cursorOffset: 0 });
    expect(r.statement).toBeNull();
    expect(r.keywords).toContain('SELECT');
    expect(r.keywords).toContain('WITH');
    expect(r.keywords).toContain('CREATE');
    expect(r.prefixParts).toEqual([]);
    expect(r.wordAtCursor).toBe('');
  });

  it('returns top-level keywords for a whitespace-only editor', () => {
    const r = analyseCompletion({ sql: '   \n  ', cursorOffset: 2 });
    expect(r.statement).toBeNull();
    expect(r.keywords).toContain('SELECT');
  });

  it('returns the same top-level keywords regardless of cursor position', () => {
    // Base layer does not filter keywords by grammar context yet.
    const r = analyseCompletion(at('SELECT * FROM foo WHERE |'));
    expect(r.keywords).toContain('SELECT');
    expect(r.keywords).toContain('WITH');
  });

  it('reads a partial word at the cursor', () => {
    const r = analyseCompletion(at('SELECT * FROM fo|o'));
    expect(r.prefixParts).toEqual([]);
    expect(r.wordAtCursor).toBe('fo');
  });

  it('reads a dotted prefix with a partial word at the cursor', () => {
    const r = analyseCompletion(at('SELECT * FROM cat.sch|'));
    expect(r.prefixParts).toEqual(['cat']);
    expect(r.wordAtCursor).toBe('sch');
  });

  it('reads a dotted prefix with empty word after a trailing dot', () => {
    const r = analyseCompletion(at('SELECT * FROM cat.sch.|'));
    expect(r.prefixParts).toEqual(['cat', 'sch']);
    expect(r.wordAtCursor).toBe('');
  });

  it('walks a three-level dotted path', () => {
    const r = analyseCompletion(at('SELECT * FROM cat.sch.tab.|'));
    expect(r.prefixParts).toEqual(['cat', 'sch', 'tab']);
    expect(r.wordAtCursor).toBe('');
  });

  it('returns empty prefix when cursor is at an operator, not an identifier', () => {
    const r = analyseCompletion(at('SELECT 1 + |2'));
    expect(r.prefixParts).toEqual([]);
    expect(r.wordAtCursor).toBe('');
  });

  it('surfaces the statement the cursor is in for multi-statement input', () => {
    const r = analyseCompletion(at('SELECT 1; SELECT * FROM fo|o'));
    expect(r.statement).not.toBeNull();
    expect(r.statement?.sql.startsWith('SELECT *')).toBe(true);
    expect(r.wordAtCursor).toBe('fo');
  });
});

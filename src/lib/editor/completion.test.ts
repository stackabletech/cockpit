import { describe, it, expect } from 'vitest';
import { analyseCompletion } from './completion';

function at(sql: string, marker = '|'): { sql: string; offset: number } {
  const offset = sql.indexOf(marker);
  if (offset < 0) throw new Error(`marker ${marker} not found in: ${sql}`);
  return { sql: sql.slice(0, offset) + sql.slice(offset + 1), offset };
}

describe('analyseCompletion', () => {
  it('returns top-level keywords for empty input', () => {
    const r = analyseCompletion({ sql: '', cursorOffset: 0 });
    expect(r.statement).toBeNull();
    expect(r.keywords).toContain('SELECT');
    expect(r.keywords).toContain('WITH');
  });

  it('detects relation position after FROM', () => {
    const { sql, offset } = at('SELECT * FROM |');
    const r = analyseCompletion({ sql, cursorOffset: offset });
    expect(r.identifierKind).toBe('relation');
    expect(r.prefixParts).toEqual([]);
    expect(r.wordAtCursor).toBe('');
  });

  it('extracts dotted prefix after FROM cat.', () => {
    const { sql, offset } = at('SELECT * FROM mycat.|');
    const r = analyseCompletion({ sql, cursorOffset: offset });
    expect(r.identifierKind).toBe('relation');
    expect(r.prefixParts).toEqual(['mycat']);
    expect(r.wordAtCursor).toBe('');
  });

  it('extracts dotted prefix with partial word', () => {
    const { sql, offset } = at('SELECT * FROM mycat.mysch|');
    const r = analyseCompletion({ sql, cursorOffset: offset });
    expect(r.identifierKind).toBe('relation');
    expect(r.prefixParts).toEqual(['mycat']);
    expect(r.wordAtCursor).toBe('mysch');
  });

  it('detects column position after SELECT', () => {
    const { sql, offset } = at('SELECT | FROM mycat.mysch.mytab');
    const r = analyseCompletion({ sql, cursorOffset: offset });
    expect(r.identifierKind).toBe('column');
  });

  it('collects an alias into the alias map', () => {
    const { sql, offset } = at('SELECT t.| FROM mycat.mysch.mytab t');
    const r = analyseCompletion({ sql, cursorOffset: offset });
    expect(r.identifierKind).toBe('column');
    expect(r.prefixParts).toEqual(['t']);
    expect(r.aliasMap.get('t')).toEqual({
      catalog: 'mycat',
      schema: 'mysch',
      table: 'mytab'
    });
  });

  it('collects an alias with AS keyword', () => {
    const { sql, offset } = at('SELECT t.| FROM mycat.mysch.mytab AS t');
    const r = analyseCompletion({ sql, cursorOffset: offset });
    expect(r.aliasMap.get('t')?.table).toBe('mytab');
  });

  it('registers a bare table by its name in the alias map', () => {
    const { sql, offset } = at('SELECT mytab.| FROM mycat.mysch.mytab');
    const r = analyseCompletion({ sql, cursorOffset: offset });
    expect(r.aliasMap.get('mytab')).toEqual({
      catalog: 'mycat',
      schema: 'mysch',
      table: 'mytab'
    });
  });

  it('collects CTE names', () => {
    const { sql, offset } = at('WITH x AS (SELECT 1) SELECT * FROM |');
    const r = analyseCompletion({ sql, cursorOffset: offset });
    expect(r.aliasMap.get('x')).toEqual({ table: 'x' });
  });

  it('returns keyword candidates at the start of a statement', () => {
    const { sql, offset } = at('|');
    const r = analyseCompletion({ sql, cursorOffset: offset });
    expect(r.keywords).toContain('SELECT');
  });

  it('handles mid-identifier cursor', () => {
    const { sql, offset } = at('SELE|CT 1');
    const r = analyseCompletion({ sql, cursorOffset: offset });
    expect(r.wordAtCursor).toBe('SELE');
  });

  it('does not suggest top-level statement keywords after SELECT', () => {
    const { sql, offset } = at('SELECT |');
    const r = analyseCompletion({ sql, cursorOffset: offset });
    // Guard against regression: before phantom-insertion worked at this
    // cursor position, c3 returned the top-level statement keywords here.
    expect(r.keywords).not.toContain('ALTER');
    expect(r.keywords).not.toContain('INSERT');
    expect(r.keywords).not.toContain('CREATE');
  });

  it('suggests relation-starting keywords after FROM', () => {
    const { sql, offset } = at('SELECT 1 FROM |');
    const r = analyseCompletion({ sql, cursorOffset: offset });
    // Post-clause keywords like WHERE/GROUP/HAVING should not appear here —
    // a relation is required first.
    expect(r.keywords).not.toContain('WHERE');
    expect(r.keywords).not.toContain('GROUP');
    expect(r.keywords).not.toContain('HAVING');
  });

  it('suggests ON/USING after FROM <a> JOIN <b>', () => {
    const { sql, offset } = at('SELECT * FROM a JOIN b |');
    const r = analyseCompletion({ sql, cursorOffset: offset });
    // After the joined relation we are NOT in a fresh relation slot — only
    // join-condition / continuation keywords are valid.
    expect(r.identifierKind).toBeNull();
    expect(r.keywords).toContain('ON');
    expect(r.keywords).toContain('USING');
  });

  it('suppresses identifier suggestions immediately after a bare relation', () => {
    const { sql, offset } = at('SELECT * FROM mytable |');
    const r = analyseCompletion({ sql, cursorOffset: offset });
    expect(r.identifierKind).toBeNull(); // alias slot, not a new relation
  });

  it('suppresses column suggestions immediately after a completed expression', () => {
    // After "WHERE address |" the next valid token is an operator / AND / OR,
    // not another column. c3 still reports primaryExpression as reachable
    // (because it could appear after AND), but the rule's startTokenIndex is
    // the already-consumed `address` — not the cursor. We must not classify
    // this as a fresh column slot.
    for (const sql of [
      'SELECT * FROM customer WHERE address |',
      'SELECT * FROM customer WHERE col1 = 1 AND col2 |'
    ]) {
      const i = sql.indexOf('|');
      const r = analyseCompletion({ sql: sql.slice(0, i) + sql.slice(i + 1), cursorOffset: i });
      expect(r.identifierKind, sql).toBeNull();
    }
  });

  it('returns identifierKind=relation after a comma in FROM', () => {
    const { sql, offset } = at('SELECT * FROM a, |');
    const r = analyseCompletion({ sql, cursorOffset: offset });
    expect(r.identifierKind).toBe('relation');
  });

  it('returns identifierKind=relation for top-level statements that take a table', () => {
    for (const stem of [
      'INSERT INTO ',
      'UPDATE ',
      'DELETE FROM ',
      'CREATE TABLE ',
      'DROP TABLE '
    ]) {
      const { sql, offset } = at(`${stem}|`);
      const r = analyseCompletion({ sql, cursorOffset: offset });
      expect(r.identifierKind, stem).toBe('relation');
    }
  });

  it('repairs malformed top-down typing patterns', () => {
    // The user often types the skeleton first ("SELECT FROM …") before
    // filling in select items. The grammar can't parse this — without the
    // generic gap-insertion repair we'd return no candidates.
    for (const sql of ['SELECT FROM |', 'SELECT col, FROM |', 'SELECT * FROM a WHERE AND |']) {
      const i = sql.indexOf('|');
      const r = analyseCompletion({ sql: sql.slice(0, i) + sql.slice(i + 1), cursorOffset: i });
      expect(r.identifierKind, sql).not.toBeNull();
    }
  });

  it('repairs nested malformed inputs (multiple missing slots)', () => {
    // Two and three missing select items at different nesting levels — the
    // ANTLR error listener reports them across iterative repair passes.
    const cases: [string, 'relation' | 'column'][] = [
      ['SELECT FROM (SELECT FROM t) WHERE |', 'column'],
      ['SELECT col, FROM (SELECT FROM x) c WHERE |', 'column'],
      ['SELECT FROM (SELECT FROM (SELECT FROM x)) WHERE |', 'column'],
      ['SELECT FROM t WHERE col = AND |', 'column']
    ];
    for (const [sql, expected] of cases) {
      const i = sql.indexOf('|');
      const r = analyseCompletion({ sql: sql.slice(0, i) + sql.slice(i + 1), cursorOffset: i });
      expect(r.identifierKind, sql).toBe(expected);
    }
  });

  it('returns identifierKind=column inside expression contexts', () => {
    for (const stem of [
      'SELECT * FROM a WHERE ',
      'SELECT * FROM a GROUP BY ',
      'SELECT * FROM a ORDER BY ',
      'SELECT * FROM a JOIN b ON '
    ]) {
      const { sql, offset } = at(`${stem}|`);
      const r = analyseCompletion({ sql, cursorOffset: offset });
      expect(r.identifierKind, stem).toBe('column');
    }
  });
});

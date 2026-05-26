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

describe('analyseCompletion — repair of malformed SQL', () => {
  it('classifies a relation slot even when the preceding SELECT is missing its column list', () => {
    // `SELECT FROM foo` has an extraneous `FROM` that the plain parser can't
    // reach past. The repair pass injects a phantom before FROM, letting c3
    // see the FROM target as a relation slot.
    const analysis = analyseCompletion(at('SELECT FROM |'));
    expect(analysis.identifierKind).toBe('relation');
  });

  it('recovers keyword context after an extraneous keyword earlier in the statement', () => {
    // After the repair, JOIN should be grammar-valid at the cursor.
    const analysis = analyseCompletion(at('SELECT FROM foo |'));
    expect(analysis.keywords).toContain('JOIN');
  });

  it('surfaces classification inside a nested malformed subquery', () => {
    // `(SELECT FROM t)` is malformed; repair should still let the outer FROM
    // slot resolve.
    const analysis = analyseCompletion(at('SELECT * FROM (SELECT FROM t) WHERE |'));
    // The WHERE position is a column slot.
    expect(analysis.identifierKind).toBe('column');
  });

  it('classifies a relation slot inside a subquery with no closing paren', () => {
    const analysis = analyseCompletion(at('SELECT (SELECT * FROM |'));
    expect(analysis.identifierKind).toBe('relation');
  });

  it('classifies a column slot inside a subquery with no closing paren', () => {
    const analysis = analyseCompletion(at('SELECT (SELECT |'));
    expect(analysis.identifierKind).toBe('column');
  });
});

describe('analyseCompletion — alias map', () => {
  it('registers a bare table reference under its name', () => {
    const analysis = analyseCompletion(at('SELECT * FROM foo WHERE |'));
    expect(analysis.aliasMap.get('foo')).toEqual({ table: 'foo' });
  });

  it('registers an alias under both its alias and the underlying table', () => {
    const analysis = analyseCompletion(at('SELECT * FROM mytab AS t WHERE |'));
    expect(analysis.aliasMap.get('mytab')).toEqual({ table: 'mytab' });
    expect(analysis.aliasMap.get('t')).toEqual({ table: 'mytab' });
  });

  it('accepts alias without AS keyword', () => {
    const analysis = analyseCompletion(at('SELECT * FROM foo t WHERE |'));
    expect(analysis.aliasMap.get('t')).toEqual({ table: 'foo' });
  });

  it('preserves qualified parts of FROM targets', () => {
    const analysis = analyseCompletion(at('SELECT * FROM cat.sch.mytab t WHERE |'));
    expect(analysis.aliasMap.get('t')).toEqual({
      catalog: 'cat',
      schema: 'sch',
      table: 'mytab'
    });
  });

  it('registers each relation in a JOIN', () => {
    const analysis = analyseCompletion(at('SELECT * FROM foo f JOIN bar b ON f.id = b.id WHERE |'));
    expect(analysis.aliasMap.get('f')).toEqual({ table: 'foo' });
    expect(analysis.aliasMap.get('b')).toEqual({ table: 'bar' });
  });

  it('resolves alias-map lookups case-insensitively', () => {
    const analysis = analyseCompletion(at('SELECT * FROM MyTab AS T WHERE |'));
    expect(analysis.aliasMap.get('mytab')).toEqual({ table: 'MyTab' });
    expect(analysis.aliasMap.get('t')).toEqual({ table: 'MyTab' });
  });
});

describe('analyseCompletion — CTE alias map', () => {
  it('registers a CTE name from a WITH clause', () => {
    const analysis = analyseCompletion(at('WITH my_cte AS (SELECT 1 AS x) SELECT | FROM my_cte'));
    expect(analysis.aliasMap.get('my_cte')).toEqual({ table: 'my_cte' });
  });

  it('registers multiple CTEs in a chained WITH', () => {
    const analysis = analyseCompletion(
      at('WITH c1 AS (SELECT 1), c2 AS (SELECT 2) SELECT | FROM c1')
    );
    expect(analysis.aliasMap.get('c1')).toEqual({ table: 'c1' });
    expect(analysis.aliasMap.get('c2')).toEqual({ table: 'c2' });
  });

  it('accepts an explicit column list on a CTE', () => {
    const analysis = analyseCompletion(at('WITH c(x, y) AS (SELECT 1, 2) SELECT | FROM c'));
    expect(analysis.aliasMap.get('c')).toEqual({ table: 'c' });
  });

  it('does not leak FROM targets from a CTE body into the outer scope', () => {
    // Cursor is in the outer main SELECT's column position, so the CTE body
    // is skipped entirely — `inner_tab` (inside the body) must NOT appear
    // in the alias map of the outer scope.
    const analysis = analyseCompletion(at('WITH c AS (SELECT col FROM inner_tab) SELECT | FROM c'));
    expect(analysis.aliasMap.get('c')).toEqual({ table: 'c' });
    expect(analysis.aliasMap.has('inner_tab')).toBe(false);
  });

  it('keeps CTE entries free of catalog/schema so the relation provider can surface them', () => {
    // The bare-relation provider iterates aliasMap.values() and surfaces
    // entries with no catalog/schema as in-scope relations. CTE entries
    // must qualify, otherwise typing `SELECT FROM re|` against a
    // `WITH recent AS …` wouldn't suggest `recent`.
    const analysis = analyseCompletion(
      at('WITH recent AS (SELECT clerk FROM tpch.sf1.orders) SELECT | FROM recent')
    );
    const recent = analysis.aliasMap.get('recent');
    expect(recent).toEqual({ table: 'recent' });
    expect(recent?.catalog).toBeUndefined();
    expect(recent?.schema).toBeUndefined();
  });
});

describe('analyseCompletion — scope-aware alias map', () => {
  it("sees the CTE body's FROMs when cursor is inside the body", () => {
    const analysis = analyseCompletion(
      at('WITH c AS (SELECT | FROM inner_tab) SELECT * FROM outer_tab')
    );
    // Cursor is inside the CTE body — aliasMap should reflect that scope
    // (inner_tab only), NOT the outer SELECT's `outer_tab`.
    expect(analysis.aliasMap.get('inner_tab')).toEqual({ table: 'inner_tab' });
    expect(analysis.aliasMap.has('outer_tab')).toBe(false);
  });

  it("sees the subquery's FROM when cursor is inside an IN (SELECT …)", () => {
    const analysis = analyseCompletion(
      at('SELECT * FROM outer_tab WHERE x IN (SELECT | FROM inner_tab)')
    );
    expect(analysis.aliasMap.get('inner_tab')).toEqual({ table: 'inner_tab' });
    expect(analysis.aliasMap.has('outer_tab')).toBe(false);
  });

  it("sees the derived table's FROM when cursor is inside a FROM (SELECT …)", () => {
    const analysis = analyseCompletion(at('SELECT * FROM (SELECT | FROM inner_tab) d WHERE true'));
    expect(analysis.aliasMap.get('inner_tab')).toEqual({ table: 'inner_tab' });
  });

  it('narrows to the deepest scope when cursor is in nested subqueries', () => {
    const analysis = analyseCompletion(
      at('SELECT * FROM a WHERE x IN (SELECT id FROM b WHERE y IN (SELECT | FROM c))')
    );
    expect(analysis.aliasMap.get('c')).toEqual({ table: 'c' });
    expect(analysis.aliasMap.has('b')).toBe(false);
    expect(analysis.aliasMap.has('a')).toBe(false);
  });

  it('ignores plain expression parentheses (not a SELECT/WITH scope)', () => {
    const analysis = analyseCompletion(at('SELECT (x + y) AS z FROM outer_tab WHERE |'));
    expect(analysis.aliasMap.get('outer_tab')).toEqual({ table: 'outer_tab' });
  });

  it('narrows scope correctly when the body is unclosed (mid-edit)', () => {
    // User is typing a CTE body and hasn't closed it yet — `inner_tab`
    // should still resolve at the cursor.
    const analysis = analyseCompletion(at('WITH c AS (SELECT | FROM inner_tab'));
    expect(analysis.aliasMap.get('inner_tab')).toEqual({ table: 'inner_tab' });
  });
});

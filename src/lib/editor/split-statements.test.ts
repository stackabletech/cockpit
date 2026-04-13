import { describe, it, expect } from 'vitest';
import { splitStatements, getStatementAtOffset, getStatementsInRange } from './split-statements';

describe('splitStatements', () => {
  it('returns an empty array for empty input', () => {
    expect(splitStatements('')).toEqual([]);
  });

  it('returns an empty array for whitespace-only input', () => {
    expect(splitStatements('   \n\t  ')).toEqual([]);
  });

  it('parses a single statement without semicolon', () => {
    const result = splitStatements('SELECT 1');
    expect(result).toEqual([{ sql: 'SELECT 1', offset: 0, endOffset: 8 }]);
  });

  it('parses a single statement with trailing semicolon', () => {
    const result = splitStatements('SELECT 1;');
    expect(result).toEqual([{ sql: 'SELECT 1', offset: 0, endOffset: 8 }]);
  });

  it('parses multiple statements', () => {
    const result = splitStatements('SELECT 1; SELECT 2; SELECT 3');
    expect(result).toHaveLength(3);
    expect(result[0].sql).toBe('SELECT 1');
    expect(result[1].sql).toBe('SELECT 2');
    expect(result[2].sql).toBe('SELECT 3');
  });

  it('computes correct offsets for multiple statements', () => {
    const sql = 'SELECT 1; SELECT 2';
    const result = splitStatements(sql);
    expect(result[0]).toEqual({ sql: 'SELECT 1', offset: 0, endOffset: 8 });
    expect(result[1]).toEqual({ sql: 'SELECT 2', offset: 10, endOffset: 18 });
  });

  it('ignores semicolons inside single-quoted strings', () => {
    const sql = "SELECT 'a;b'";
    const result = splitStatements(sql);
    expect(result).toHaveLength(1);
    expect(result[0].sql).toBe("SELECT 'a;b'");
  });

  it('ignores semicolons inside line comments', () => {
    const sql = 'SELECT 1 -- a; comment\n; SELECT 2';
    const result = splitStatements(sql);
    expect(result).toHaveLength(2);
    expect(result[0].sql).toBe('SELECT 1 -- a; comment');
    expect(result[1].sql).toBe('SELECT 2');
  });

  it('ignores semicolons inside block comments', () => {
    const sql = 'SELECT 1 /* a; comment */; SELECT 2';
    const result = splitStatements(sql);
    expect(result).toHaveLength(2);
    expect(result[0].sql).toBe('SELECT 1 /* a; comment */');
    expect(result[1].sql).toBe('SELECT 2');
  });

  it('keeps semicolons inside BEGIN...END blocks together', () => {
    const sql = 'BEGIN INSERT INTO t VALUES (1); INSERT INTO t VALUES (2); END';
    const result = splitStatements(sql);
    expect(result).toHaveLength(1);
    expect(result[0].sql).toBe(sql);
  });

  it('keeps semicolons inside CASE...END together', () => {
    const sql = 'SELECT CASE WHEN x > 0 THEN 1; ELSE 0; END; SELECT 2';
    const result = splitStatements(sql);
    expect(result).toHaveLength(2);
    expect(result[0].sql).toBe('SELECT CASE WHEN x > 0 THEN 1; ELSE 0; END');
    expect(result[1].sql).toBe('SELECT 2');
  });

  it('keeps semicolons inside nested BEGIN...END blocks together', () => {
    const sql = 'BEGIN BEGIN INSERT INTO t VALUES (1); END; INSERT INTO t VALUES (2); END';
    const result = splitStatements(sql);
    expect(result).toHaveLength(1);
    expect(result[0].sql).toBe(sql);
  });

  it('keeps semicolons inside IF...END blocks together', () => {
    const sql = 'IF x > 0 THEN INSERT INTO t VALUES (1); END IF';
    const result = splitStatements(sql);
    expect(result).toHaveLength(1);
    expect(result[0].sql).toBe(sql);
  });

  it('does not treat IF in CREATE TABLE IF NOT EXISTS as a block', () => {
    const sql = 'CREATE TABLE IF NOT EXISTS t (id INT); SELECT 1';
    const result = splitStatements(sql);
    expect(result).toHaveLength(2);
    expect(result[0].sql).toBe('CREATE TABLE IF NOT EXISTS t (id INT)');
    expect(result[1].sql).toBe('SELECT 1');
  });

  it('keeps semicolons inside LOOP...END blocks together', () => {
    const sql = 'LOOP INSERT INTO t VALUES (1); END LOOP';
    const result = splitStatements(sql);
    expect(result).toHaveLength(1);
    expect(result[0].sql).toBe(sql);
  });

  it('keeps semicolons inside WHILE...END blocks together', () => {
    const sql = 'WHILE x > 0 DO INSERT INTO t VALUES (1); END WHILE';
    const result = splitStatements(sql);
    expect(result).toHaveLength(1);
    expect(result[0].sql).toBe(sql);
  });

  it('keeps semicolons inside REPEAT...END blocks together', () => {
    const sql = 'REPEAT INSERT INTO t VALUES (1); UNTIL x > 0 END REPEAT';
    const result = splitStatements(sql);
    expect(result).toHaveLength(1);
    expect(result[0].sql).toBe(sql);
  });

  it('splits correctly after a compound block', () => {
    const sql = 'BEGIN INSERT INTO t VALUES (1); END; SELECT 2; SELECT 3';
    const result = splitStatements(sql);
    expect(result).toHaveLength(3);
    expect(result[0].sql).toBe('BEGIN INSERT INTO t VALUES (1); END');
    expect(result[1].sql).toBe('SELECT 2');
    expect(result[2].sql).toBe('SELECT 3');
  });

  it('trims whitespace from each statement', () => {
    const result = splitStatements('  SELECT 1 ;  SELECT 2  ');
    expect(result[0].sql).toBe('SELECT 1');
    expect(result[1].sql).toBe('SELECT 2');
  });
});

describe('getStatementAtOffset', () => {
  const sql = 'SELECT 1; SELECT 2; SELECT 3';

  it('returns the statement containing the cursor', () => {
    // Cursor inside "SELECT 2" (offset 10-18)
    const result = getStatementAtOffset(sql, 12);
    expect(result).not.toBeNull();
    expect(result!.sql).toBe('SELECT 2');
  });

  it('returns the statement when cursor is at statement start', () => {
    const result = getStatementAtOffset(sql, 0);
    expect(result).not.toBeNull();
    expect(result!.sql).toBe('SELECT 1');
  });

  it('returns the statement when cursor is at statement end', () => {
    const result = getStatementAtOffset(sql, 8);
    expect(result).not.toBeNull();
    expect(result!.sql).toBe('SELECT 1');
  });

  it('returns the previous statement when cursor is on whitespace between statements', () => {
    // Offset 9 is the semicolon/space between SELECT 1 and SELECT 2
    const result = getStatementAtOffset(sql, 9);
    expect(result).not.toBeNull();
    expect(result!.sql).toBe('SELECT 1');
  });

  it('returns the last statement when cursor is past all statements', () => {
    const result = getStatementAtOffset(sql, 999);
    expect(result).not.toBeNull();
    expect(result!.sql).toBe('SELECT 3');
  });

  it('returns null for empty input', () => {
    expect(getStatementAtOffset('', 0)).toBeNull();
  });
});

describe('getStatementsInRange', () => {
  const sql = 'SELECT 1; SELECT 2; SELECT 3';

  it('returns statements overlapping the range', () => {
    // Range covering "SELECT 2" (offset 10-18)
    const result = getStatementsInRange(sql, 10, 18);
    expect(result).toHaveLength(1);
    expect(result[0].sql).toBe('SELECT 2');
  });

  it('returns multiple overlapping statements', () => {
    // Range covering parts of all three
    const result = getStatementsInRange(sql, 5, 25);
    expect(result).toHaveLength(3);
  });

  it('returns empty array when range has no overlap', () => {
    // Range on the semicolon between statements
    const result = getStatementsInRange(sql, 8, 10);
    expect(result).toEqual([]);
  });

  it('returns statement when range exactly matches its bounds', () => {
    const result = getStatementsInRange(sql, 0, 8);
    expect(result).toHaveLength(1);
    expect(result[0].sql).toBe('SELECT 1');
  });

  it('returns empty array for empty input', () => {
    expect(getStatementsInRange('', 0, 10)).toEqual([]);
  });
});

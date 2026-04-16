import { describe, it, expect } from 'vitest';
import { detectDdlInvalidation } from './ddl-invalidation';

describe('detectDdlInvalidation', () => {
  it('returns null for SELECT statements', () => {
    expect(detectDdlInvalidation('SELECT 1', undefined, undefined)).toBeNull();
  });

  it('detects CREATE SCHEMA with a qualified name', () => {
    expect(detectDdlInvalidation('CREATE SCHEMA mycat.myschema', undefined, undefined)).toEqual({
      kind: 'schema',
      catalog: 'mycat',
      name: 'myschema'
    });
  });

  it('detects CREATE SCHEMA IF NOT EXISTS', () => {
    expect(
      detectDdlInvalidation('CREATE SCHEMA IF NOT EXISTS mycat.myschema', undefined, undefined)
    ).toEqual({ kind: 'schema', catalog: 'mycat', name: 'myschema' });
  });

  it('resolves CREATE TABLE against default catalog + schema', () => {
    expect(detectDdlInvalidation('CREATE TABLE mytab (x INT)', 'dcat', 'dsch')).toEqual({
      kind: 'table',
      catalog: 'dcat',
      schema: 'dsch',
      name: 'mytab'
    });
  });

  it('detects DROP TABLE fully qualified', () => {
    expect(detectDdlInvalidation('DROP TABLE c.s.t', undefined, undefined)).toEqual({
      kind: 'table',
      catalog: 'c',
      schema: 's',
      name: 't'
    });
  });

  it('detects ALTER TABLE ADD COLUMN', () => {
    expect(
      detectDdlInvalidation('ALTER TABLE c.s.t ADD COLUMN newcol INT', undefined, undefined)
    ).toEqual({ kind: 'column', catalog: 'c', schema: 's', table: 't' });
  });

  it('detects CREATE OR REPLACE VIEW', () => {
    expect(
      detectDdlInvalidation('CREATE OR REPLACE VIEW c.s.v AS SELECT 1', undefined, undefined)
    ).toEqual({ kind: 'view', catalog: 'c', schema: 's', name: 'v' });
  });

  it('detects CREATE MATERIALIZED VIEW', () => {
    expect(
      detectDdlInvalidation('CREATE MATERIALIZED VIEW c.s.v AS SELECT 1', undefined, undefined)
    ).toEqual({ kind: 'view', catalog: 'c', schema: 's', name: 'v' });
  });
});

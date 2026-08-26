import { describe, expect, it } from 'vitest';
import { buildQuerySpec, buildSql, type BuilderNode } from './sql-builder.js';
import type { CommandNodeData } from '$lib/components/sql-diagram/DiagramCommandNode.svelte';

function tableNode(
  tableName: string,
  selectedColumns: string[] = [],
  columnClauses: Record<string, unknown> = {}
): BuilderNode {
  return {
    id: `table-${tableName}`,
    type: 'tableNode',
    data: { tableName, selectedColumns, columnClauses }
  };
}

function commandNode(partial: Partial<CommandNodeData>, id = 'cmd-1'): BuilderNode {
  return {
    id,
    type: 'commandNode',
    data: {
      command: 'WHERE',
      connectedColumns: [],
      whereClauses: [],
      orderClauses: [],
      limitValue: 10,
      joinType: 'INNER',
      ...partial
    }
  };
}

describe('buildSql', () => {
  it('returns an empty string when nothing is selected', () => {
    expect(buildSql(buildQuerySpec([]))).toBe('');
    expect(
      buildSql({
        selectColumns: [],
        joinTables: [],
        whereClauses: [],
        groupByColumns: [],
        orderBy: [],
        limitValue: null
      })
    ).toBe('');
  });

  it('builds a simple single-table select', () => {
    const sql = buildSql(buildQuerySpec([tableNode('customer', ['custkey', 'name'])]));
    expect(sql).toBe('SELECT customer.custkey, customer.name\nFROM customer');
  });

  it('qualifies table names with catalog and schema when provided', () => {
    const sql = buildSql(
      buildQuerySpec([tableNode('customer', ['name'])], { catalog: 'tpch', schema: 'sf1' })
    );
    expect(sql).toBe('SELECT customer.name\nFROM tpch.sf1.customer');
  });

  it('qualifies joined tables but keeps alias references short', () => {
    const spec = {
      ...buildQuerySpec(
        [
          tableNode('orders', ['total']),
          tableNode('customer'),
          commandNode({
            command: 'JOIN',
            joinType: 'INNER',
            connectedColumns: [
              { edgeId: 'a', table: 'orders', column: 'custkey' },
              { edgeId: 'b', table: 'customer', column: 'custkey' }
            ]
          })
        ],
        { catalog: 'tpch', schema: 'sf1' }
      )
    };
    const sql = buildSql(spec);
    expect(sql).toMatch(
      /FROM tpch\.sf1\.orders \w+\nINNER JOIN tpch\.sf1\.customer \w+ ON \w+\.custkey = \w+\.custkey/
    );
  });

  it('aliases tables and qualifies references across multiple tables', () => {
    const spec = buildQuerySpec([
      tableNode('orders', ['total']),
      tableNode('customer', [], {
        name: { where: [{ operator: '=', value: 'Alice' }] }
      })
    ]);
    const sql = buildSql(spec);
    // Tables are aliased a/b in insertion order of first use.
    expect(sql).toContain('FROM orders a');
    expect(sql).toContain('SELECT a.total');
    expect(sql).toContain("WHERE b.name = 'Alice'");
  });

  it('renders joins with ON conditions', () => {
    const spec = buildQuerySpec([
      tableNode('orders', ['total']),
      tableNode('customer'),
      commandNode({
        command: 'JOIN',
        joinType: 'LEFT',
        connectedColumns: [
          { edgeId: 'a', table: 'orders', column: 'custkey' },
          { edgeId: 'b', table: 'customer', column: 'custkey' }
        ]
      })
    ]);
    const sql = buildSql(spec);
    expect(sql).toMatch(/FROM orders \w+\nLEFT JOIN customer \w+ ON \w+\.custkey = \w+\.custkey/);
  });

  it('escapes single quotes and keeps numeric values unquoted', () => {
    const spec = buildQuerySpec([
      tableNode('t', ['note', 'id'], {
        note: { where: [{ operator: '!=', value: "it's" }] },
        id: { where: [{ operator: '>', value: '5' }] }
      })
    ]);
    const sql = buildSql(spec);
    expect(sql).toContain("t.note != 'it''s'");
    expect(sql).toContain('t.id > 5');
  });

  it('supports LIKE and IN operators', () => {
    const sql = buildSql(
      buildQuerySpec([
        tableNode('t', ['name', 'id'], {
          name: { where: [{ operator: 'LIKE', value: '%bob%' }] },
          id: { where: [{ operator: 'IN', value: '1,2,3' }] }
        })
      ])
    );
    expect(sql).toContain("t.name LIKE '%bob%'");
    expect(sql).toContain("t.id IN '1,2,3'");
  });

  it('adds GROUP BY from GROUP BY command nodes', () => {
    const sql = buildSql(
      buildQuerySpec([
        tableNode('t', ['status']),
        commandNode(
          {
            command: 'GROUP BY',
            connectedColumns: [{ edgeId: 'g1', table: 't', column: 'status' }]
          },
          'cmd-group'
        )
      ])
    );
    expect(sql).toBe('SELECT t.status\nFROM t\nGROUP BY t.status');
  });

  it('renders configured aggregate functions and groups remaining selected columns', () => {
    const sql = buildSql(
      buildQuerySpec([
        tableNode('orders', ['status', 'total']),
        commandNode(
          {
            command: 'GROUP BY',
            connectedColumns: [
              { edgeId: 'status', table: 'orders', column: 'status' },
              { edgeId: 'total', table: 'orders', column: 'total' }
            ],
            aggregateClauses: [
              { edgeId: 'status', fn: 'NONE' },
              { edgeId: 'total', fn: 'SUM' }
            ]
          },
          'cmd-group'
        )
      ])
    );
    expect(sql).toBe(
      'SELECT orders.status, SUM(orders.total) AS sum_orders_total\nFROM orders\nGROUP BY orders.status'
    );
  });

  it('applies command-box ORDER BY before priority-sorted inline ORDER BY', () => {
    const spec = buildQuerySpec([
      tableNode('t', ['id', 'created_at'], {
        created_at: { orderBy: { direction: 'DESC', seq: 2 } },
        id: { orderBy: { direction: 'ASC', seq: 1 } }
      }),
      commandNode(
        {
          command: 'ORDER BY',
          orderClauses: [{ edgeId: 'o1', table: 't', column: 'name', direction: 'ASC' }]
        },
        'cmd-order'
      )
    ]);
    const sql = buildSql(spec);
    expect(sql).toBe(
      'SELECT t.id, t.created_at\nFROM t\nORDER BY t.name ASC, t.id ASC, t.created_at DESC'
    );
  });

  it('appends LIMIT when positive', () => {
    const withLimit = buildSql(
      buildQuerySpec([
        tableNode('t', ['id']),
        commandNode({ command: 'LIMIT', limitValue: 25 }, 'cmd-limit')
      ])
    );
    expect(withLimit).toBe('SELECT t.id\nFROM t\nLIMIT 25');

    const zeroLimit = buildSql(
      buildQuerySpec([
        tableNode('t', ['id']),
        commandNode({ command: 'LIMIT', limitValue: 0 }, 'cmd-limit0')
      ])
    );
    expect(zeroLimit).toBe('SELECT t.id\nFROM t');
  });
});

describe('buildQuerySpec', () => {
  it('ignores WHERE rows with empty values', () => {
    const spec = buildQuerySpec([
      tableNode('t', [], {
        name: {
          where: [
            { operator: '=', value: '' },
            { operator: '=', value: 'x' }
          ]
        }
      })
    ]);
    expect(spec.whereClauses).toHaveLength(1);
    expect(spec.whereClauses[0]).toMatchObject({ table: 't', column: 'name', value: 'x' });
  });

  it('skips malformed nodes safely', () => {
    const spec = buildQuerySpec([
      { id: 'x', type: 'tableNode', data: {} },
      { id: 'y', type: 'unknown' },
      commandNode({
        connectedColumns: [null]
      } as unknown as Partial<CommandNodeData>)
    ]);
    expect(spec.selectColumns).toHaveLength(0);
    expect(spec.joins).toHaveLength(0);
    expect(spec.joinTables).toHaveLength(0);
  });

  it('collects selected columns and join tables', () => {
    const spec = buildQuerySpec([tableNode('a', ['x']), tableNode('b', ['y'])]);
    expect(spec.selectColumns).toEqual([
      { edgeId: 'a.x', table: 'a', column: 'x' },
      { edgeId: 'b.y', table: 'b', column: 'y' }
    ]);
    expect(spec.joinTables.sort()).toEqual(['a', 'b']);
  });
});

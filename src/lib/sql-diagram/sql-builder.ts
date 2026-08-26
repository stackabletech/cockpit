/**
 * Pure SQL assembly for the visual query builder.
 *
 * `buildQuerySpec` walks the diagram nodes (tables + command boxes) and
 * collects a declarative QuerySpec; `buildSql` renders it as Trino SQL.
 * Both functions are side-effect free so they can be unit tested easily.
 */

import type {
  AggregateFn,
  CommandType,
  ColumnAggregate,
  ConnectedColumn,
  JoinClause,
  OrderByClause,
  QuerySpec,
  TableColumnClauses,
  WhereCondition
} from './types.js';

/** Minimal structural view of an XYFlow node (avoids importing @xyflow/svelte). */
export interface BuilderNode {
  id: string;
  type?: string;
  data?: Record<string, unknown>;
}

/** Session context used to qualify table names in the generated SQL. */
export interface QueryContext {
  catalog?: string;
  schema?: string;
}

interface TableData {
  tableName?: unknown;
  selectedColumns?: unknown;
  columnClauses?: unknown;
}

interface CommandData {
  command?: unknown;
  connectedColumns?: unknown;
  whereClauses?: unknown;
  orderClauses?: unknown;
  aggregateClauses?: unknown;
  limitValue?: unknown;
  joinType?: unknown;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null;
}

function asStringArray(value: unknown): string[] {
  return Array.isArray(value) ? value.filter((v): v is string => typeof v === 'string') : [];
}

/** Build the declarative QuerySpec from the current diagram state. */
export function buildQuerySpec(nodes: BuilderNode[], context: QueryContext = {}): QuerySpec {
  const selectColumns: QuerySpec['selectColumns'] = [];
  const aggregates: ColumnAggregate[] = [];
  const joins: JoinClause[] = [];
  const whereAll: WhereCondition[] = [];
  const groupAll: ConnectedColumn[] = [];
  const orderAll: OrderByClause[] = [];
  const inlineOrders: { seq: number; clause: OrderByClause }[] = [];
  let limitVal: number | null = null;

  for (const node of nodes) {
    if (!isRecord(node.data)) continue;

    if (node.type === 'tableNode') {
      const d = node.data as TableData;
      if (typeof d.tableName !== 'string') continue;
      const tableName = d.tableName;

      for (const colName of asStringArray(d.selectedColumns)) {
        selectColumns.push({
          edgeId: `${tableName}.${colName}`,
          table: tableName,
          column: colName
        });
      }

      const clauses = (isRecord(d.columnClauses) ? d.columnClauses : {}) as Record<
        string,
        TableColumnClauses
      >;
      for (const [colName, clause] of Object.entries(clauses)) {
        for (const [i, w] of (clause.where ?? []).entries()) {
          if (w.value.trim() === '') continue;
          whereAll.push({
            edgeId: `inline-${tableName}.${colName}-${i}`,
            table: tableName,
            column: colName,
            operator: w.operator,
            value: w.value.trim()
          });
        }
        if (clause.orderBy) {
          inlineOrders.push({
            seq: clause.orderBy.seq,
            clause: {
              edgeId: `inline-order-${tableName}.${colName}`,
              table: tableName,
              column: colName,
              direction: clause.orderBy.direction
            }
          });
        }
      }
      continue;
    }

    if (node.type !== 'commandNode') continue;
    const d = node.data as CommandData;
    const command = d.command as CommandType;

    if (command === 'JOIN') {
      const cols = Array.isArray(d.connectedColumns) ? d.connectedColumns : [];
      const [left, right] = cols;
      if (
        isRecord(left) &&
        isRecord(right) &&
        typeof left.table === 'string' &&
        typeof left.column === 'string' &&
        typeof right.table === 'string' &&
        typeof right.column === 'string' &&
        typeof d.joinType === 'string'
      ) {
        joins.push({
          nodeId: node.id,
          joinType: d.joinType as JoinClause['joinType'],
          leftTable: left.table,
          leftColumn: left.column,
          rightTable: right.table,
          rightColumn: right.column
        });
      }
    } else if (command === 'WHERE') {
      whereAll.push(...asStringFilter(d.whereClauses));
    } else if (command === 'ORDER BY') {
      orderAll.push(...asOrderList(d.orderClauses));
    } else if (command === 'GROUP BY') {
      groupAll.push(...asConnectedColumns(d.connectedColumns));
      aggregates.push(...asAggregateList(d.aggregateClauses));
    } else if (command === 'LIMIT') {
      const val = Number(d.limitValue);
      if (Number.isFinite(val) && val > 0) limitVal = val;
    }
  }

  // Inline ORDER BYs are applied in insertion order (priority),
  // command-box ORDER BYs come after them.
  inlineOrders.sort((a, b) => a.seq - b.seq);
  orderAll.push(...inlineOrders.map((o) => o.clause));

  const joinTables = [
    ...new Set([
      ...selectColumns.map((c) => c.table),
      ...aggregates.map((a) => a.table),
      ...joins.flatMap((j) => [j.leftTable, j.rightTable])
    ])
  ];

  return {
    selectColumns,
    aggregateColumns: aggregates.filter((a) => a.fn !== 'NONE'),
    joinTables,
    joins,
    whereClauses: whereAll,
    groupByColumns: groupAll,
    orderBy: orderAll,
    limitValue: limitVal,
    catalog: context.catalog,
    schema: context.schema
  };
}

function asConnectedColumns(value: unknown): ConnectedColumn[] {
  if (!Array.isArray(value)) return [];
  return value.filter(
    (c): c is ConnectedColumn =>
      isRecord(c) &&
      typeof c.edgeId === 'string' &&
      typeof c.table === 'string' &&
      typeof c.column === 'string'
  );
}

function asStringFilter(value: unknown): WhereCondition[] {
  return asConnectedColumns(value)
    .filter(
      (c): c is WhereCondition =>
        isRecord(c) && typeof c.operator === 'string' && typeof c.value === 'string'
    )
    .filter((c) => c.value.trim() !== '');
}

function asOrderList(value: unknown): OrderByClause[] {
  return asConnectedColumns(value).filter(
    (c): c is OrderByClause => isRecord(c) && (c.direction === 'ASC' || c.direction === 'DESC')
  );
}

const AGGREGATE_FNS: AggregateFn[] = ['NONE', 'COUNT', 'SUM', 'MIN', 'MAX', 'AVG'];

function asAggregateList(value: unknown): ColumnAggregate[] {
  if (!Array.isArray(value)) return [];
  return value.filter(
    (c): c is ColumnAggregate =>
      isRecord(c) &&
      typeof c.edgeId === 'string' &&
      typeof c.table === 'string' &&
      typeof c.column === 'string' &&
      AGGREGATE_FNS.includes(c.fn as AggregateFn)
  );
}

/** Escape single quotes in a literal value. */
function escapeValue(value: string): string {
  return value.replace(/'/g, "''");
}

function looksNumeric(value: string): boolean {
  return value.trim() !== '' && !Number.isNaN(Number(value));
}

/**
 * Qualify a bare table name with catalog and schema. Trino requires the
 * schema to be set in the session; the diagram always emits it explicitly so
 * assembled queries work regardless of session context.
 */
function qualify(name: string, spec: QuerySpec): string {
  if (spec.catalog && spec.schema) return `${spec.catalog}.${spec.schema}.${name}`;
  return name;
}

/** Render the QuerySpec as a Trino SQL statement (empty string when nothing is selected). */
export function buildSql(spec: QuerySpec): string {
  const aggregateColumns = spec.aggregateColumns ?? [];
  if (
    spec.selectColumns.length === 0 &&
    aggregateColumns.length === 0 &&
    !(spec.joins && spec.joins.length > 0)
  )
    return '';

  const tableAliases = new Map<string, string>();
  const usedTables = new Set<string>();

  for (const col of spec.selectColumns) usedTables.add(col.table);
  for (const w of spec.whereClauses) usedTables.add(w.table);
  for (const g of spec.groupByColumns) usedTables.add(g.table);
  for (const o of spec.orderBy) usedTables.add(o.table);
  for (const a of aggregateColumns) usedTables.add(a.table);
  for (const j of spec.joins ?? []) {
    usedTables.add(j.leftTable);
    usedTables.add(j.rightTable);
  }

  // Assign short aliases when more than one table is involved.
  const tableList = Array.from(usedTables);
  if (tableList.length > 1) {
    tableList.forEach((t, i) => tableAliases.set(t, String.fromCharCode(97 + i)));
  }

  const alias = (t: string) =>
    tableAliases.get(t) ? `${qualify(t, spec)} ${tableAliases.get(t)}` : qualify(t, spec);
  const ref = (t: string, c: string) =>
    tableAliases.get(t) ? `${tableAliases.get(t)}.${c}` : `${t}.${c}`;

  // Columns with an aggregate are rendered as FUNC(col); the plain select of
  // the same column is dropped in favour of its aggregate version.
  const aggregatedKeys = new Set(aggregateColumns.map((a) => `${a.table}.${a.column}`));
  const plainSelects = spec.selectColumns.filter((c) => !aggregatedKeys.has(`${c.table}.${c.column}`));

  const aggExpr = (a: ColumnAggregate): string => {
    const inner = ref(a.table, a.column);
    const outName = tableAliases.get(a.table) ?? a.table;
    return `${a.fn}(${inner}) AS ${a.fn.toLowerCase()}_${outName}_${a.column}`;
  };

  const selectParts =
    plainSelects.length > 0 || aggregateColumns.length > 0
      ? [...plainSelects.map((c) => ref(c.table, c.column)), ...aggregateColumns.map(aggExpr)].join(
          ', '
        )
      : '*';

  // Grouping is active when GROUP BY columns exist or any aggregate is used;
  // every plain selected column then automatically becomes a grouping key.
  const groupingActive = spec.groupByColumns.length > 0 || aggregateColumns.length > 0;

  const primaryTable = spec.selectColumns[0]?.table ?? spec.joins?.[0]?.leftTable ?? tableList[0];

  const joinLines: string[] = [];
  for (const j of spec.joins ?? []) {
    const kw = j.joinType === 'INNER' ? 'INNER JOIN' : `${j.joinType} JOIN`;
    joinLines.push(
      `${kw} ${alias(j.rightTable)} ON ${ref(j.leftTable, j.leftColumn)} = ${ref(j.rightTable, j.rightColumn)}`
    );
  }

  const whereParts = spec.whereClauses.map((w) => {
    const col = ref(w.table, w.column);
    const val = looksNumeric(w.value) ? w.value.trim() : `'${escapeValue(w.value)}'`;
    return `${col} ${w.operator} ${val}`;
  });

  const groupParts = groupingActive
    ? [
        ...new Set([
          ...spec.groupByColumns.map((g) => ref(g.table, g.column)),
          ...plainSelects.map((c) => ref(c.table, c.column))
        ])
      ]
    : [];
  const orderParts = spec.orderBy.map((o) => `${ref(o.table, o.column)} ${o.direction}`);

  let sql = `SELECT ${selectParts}\nFROM ${alias(primaryTable)}`;
  if (joinLines.length) sql += '\n' + joinLines.join('\n');
  if (whereParts.length) sql += '\nWHERE ' + whereParts.join('\n  AND ');
  if (groupParts.length) sql += '\nGROUP BY ' + groupParts.join(', ');
  if (orderParts.length) sql += '\nORDER BY ' + orderParts.join(', ');
  if (spec.limitValue != null && spec.limitValue > 0) sql += `\nLIMIT ${spec.limitValue}`;

  return sql;
}

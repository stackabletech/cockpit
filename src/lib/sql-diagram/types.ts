/** Shared types for the visual SQL query builder (/sql-diagram). */

export type WhereOperator = '=' | '!=' | '>' | '<' | '>=' | '<=' | 'LIKE' | 'IN';

export const WHERE_OPERATORS: WhereOperator[] = ['=', '!=', '>', '<', '>=', '<=', 'LIKE', 'IN'];

export type JoinType = 'INNER' | 'LEFT' | 'RIGHT' | 'FULL';

export const JOIN_TYPES: JoinType[] = ['INNER', 'LEFT', 'RIGHT', 'FULL'];

export type SortDirection = 'ASC' | 'DESC';

export type CommandType = 'WHERE' | 'ORDER BY' | 'LIMIT' | 'GROUP BY' | 'JOIN';

export const COMMAND_TYPES: CommandType[] = ['JOIN', 'WHERE', 'ORDER BY', 'GROUP BY', 'LIMIT'];

/** A column as reported by `DESCRIBE`. */
export interface DiagramColumn {
  name: string;
  dataType: string;
}

export interface InlineWhereClause {
  operator: WhereOperator;
  value: string;
}

export interface InlineOrderByClause {
  direction: SortDirection;
  /** Global insertion counter – lower = higher sort priority */
  seq: number;
}

/** Inline WHERE / ORDER BY clauses attached to a single table column. */
export interface TableColumnClauses {
  where?: InlineWhereClause[];
  orderBy?: InlineOrderByClause;
}

/** Reference to a column connected to a command node via an edge. */
export interface ConnectedColumn {
  edgeId: string;
  table: string;
  column: string;
}

export interface WhereCondition extends ConnectedColumn {
  operator: WhereOperator;
  value: string;
}

export interface OrderByClause extends ConnectedColumn {
  direction: SortDirection;
}

export interface JoinClause {
  nodeId: string;
  joinType: JoinType;
  leftTable: string;
  leftColumn: string;
  rightTable: string;
  rightColumn: string;
}

export interface QuerySpec {
  selectColumns: { edgeId: string; table: string; column: string }[];
  joinTables: string[];
  joins?: JoinClause[];
  whereClauses: WhereCondition[];
  groupByColumns: ConnectedColumn[];
  orderBy: OrderByClause[];
  limitValue: number | null;
  /** Session context – when set, tables are qualified as catalog.schema.table. */
  catalog?: string;
  schema?: string;
}

export interface DiagramQueryResult {
  columns: string[];
  rows: Record<string, unknown>[];
  durationMs: number;
  /** True when collection stopped at MAX_CLIENT_ROWS. */
  truncated?: boolean;
  error?: string;
}

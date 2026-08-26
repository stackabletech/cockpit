<script lang="ts" module>
  /** Handles on command nodes that accept incoming connections. */
  const CMD_INPUT_HANDLES = new Set(['cmd-input', 'join-input-a', 'join-input-b']);
</script>

<script lang="ts">
  import { onMount } from 'svelte';
  import { SvelteFlow, Background, Controls, MiniMap, type Node, type Edge } from '@xyflow/svelte';
  import '@xyflow/svelte/dist/style.css';
  import * as m from '$lib/paraglide/messages.js';
  import Modal from '$lib/components/Modal.svelte';
  import ModuleTabs from '$lib/components/trino/ModuleTabs.svelte';
  import DiagramTableNode from '$lib/components/sql-diagram/DiagramTableNode.svelte';
  import DiagramCommandNode, {
    type CommandNodeData,
    type ConnectedColumn
  } from '$lib/components/sql-diagram/DiagramCommandNode.svelte';
  import DiagramCanvasMenu from '$lib/components/sql-diagram/DiagramCanvasMenu.svelte';
  import DiagramColumnMenu from '$lib/components/sql-diagram/DiagramColumnMenu.svelte';
  import DiagramResultsPanel from '$lib/components/sql-diagram/DiagramResultsPanel.svelte';
  import { buildQuerySpec, buildSql } from '$lib/sql-diagram/sql-builder.js';
  import {
    deserializeDiagram,
    serializeDiagram,
    type SavedDiagramQuery
  } from '$lib/sql-diagram/serialization.js';
  import {
    WHERE_OPERATORS,
    type AggregateFn,
    type CommandType,
    type DiagramColumn,
    type DiagramQueryResult,
    type JoinType,
    type SortDirection,
    type TableColumnClauses,
    type WhereOperator
  } from '$lib/sql-diagram/types.js';
  import type { TableNodeData } from '$lib/components/sql-diagram/DiagramTableNode.svelte';
  import type { PageData } from './$types';

  let { data }: { data: PageData } = $props();

  const uid = $props.id();

  // ─── Node types ───────────────────────────────────────────────────────────
  const nodeTypes = { tableNode: DiagramTableNode, commandNode: DiagramCommandNode };

  // ─── Helpers ─────────────────────────────────────────────────────────────
  /** Parse a column source-handle string like "users.id" → { table, column } */
  function parseHandle(
    handle: string | null | undefined
  ): { table: string; column: string } | null {
    if (!handle || handle.startsWith('cmd-')) return null;
    let h = handle;
    // Strip the dynamic side suffix appended to left/right duplicate handles.
    if (h.endsWith('|l') || h.endsWith('|r')) h = h.slice(0, -2);
    const dot = h.indexOf('.');
    if (dot < 0) return null;
    return { table: h.slice(0, dot), column: h.slice(dot + 1) };
  }

  function makeCommandData(nodeId: string, cmd: CommandType): CommandNodeData {
    return {
      command: cmd,
      connectedColumns: [],
      whereClauses: [],
      orderClauses: [],
      aggregateClauses: [],
      limitValue: 10,
      joinType: 'INNER',
      onWhereUpdate(edgeId, field, val) {
        updateNodeWhereClause(nodeId, edgeId, field, val);
      },
      onOrderUpdate(edgeId, direction) {
        updateNodeOrderClause(nodeId, edgeId, direction);
      },
      onLimitUpdate(val) {
        updateNodeLimit(nodeId, val);
      },
      onJoinUpdate(id, joinType) {
        updateNodeJoinType(id, joinType);
      },
      onAggregateUpdate(edgeId, fn) {
        updateNodeAggregate(nodeId, edgeId, fn);
      }
    };
  }

  function makeTableData(tableName: string, columns: DiagramColumn[]): TableNodeData {
    return {
      tableName,
      columns,
      selectedColumns: [],
      columnClauses: {},
      onToggleColumn(table, column, checked) {
        toggleTableColumn(table, column, checked);
      },
      onToggleAllColumns(table, checked) {
        toggleAllTableColumns(table, checked);
      },
      onColumnContextMenu(table, column, e) {
        openColumnContextMenu(table, column, e);
      },
      onGetOrderRank(table, column) {
        return getOrderRank(table, column);
      }
    };
  }

  // ─── State ────────────────────────────────────────────────────────────────
  let nodes = $state<Node[]>([]);
  let edges = $state<Edge[]>([]);

  // Connection state mirrors the SQL editor tab.
  let catalogs = $state<string[]>([]);
  let schemas = $state<string[]>([]);
  let catalog = $state('');
  let schema = $state('');
  let loadingTables = $state(false);
  let loadError = $state<string | null>(null);

  let cmdCounter = $state(0);
  /** Global counter giving inline ORDER BY clauses their priority order. */
  let orderSeq = $state(0);
  let initialised = $state(false);

  // XYFlow's renderer diffs by node object reference; replace the node object
  // so it sees a reference change and re-renders the custom component.
  function replaceNodeData(nodeId: string, newData: Record<string, unknown>) {
    nodes = nodes.map((n) => (n.id === nodeId ? { ...n, data: newData } : n));
  }

  // ─── Catalogue loading (via the shared Trino metadata API) ────────────────
  async function fetchLevel(params: Record<string, string>): Promise<unknown[][]> {
    const qs = new URLSearchParams(params).toString();
    const res = await fetch(`/api/trino/catalog?${qs}`);
    if (!res.ok) throw new Error(await res.text());
    return res.json();
  }

  async function loadCatalogs() {
    try {
      const rows = await fetchLevel({ level: 'catalogs' });
      catalogs = rows.map((row) => String((row as string[])[0]));
      loadError = null;
    } catch (err) {
      loadError = err instanceof Error ? err.message : m.sql_diagram_load_failed();
    }
  }

  async function loadSchemas(catalogName: string) {
    try {
      const rows = await fetchLevel({ level: 'schemas', catalog: catalogName });
      schemas = rows.map((row) => String((row as string[])[0]));
    } catch {
      schemas = [];
    }
  }

  async function loadDiagram() {
    if (!catalog || !schema) return;
    loadingTables = true;
    loadError = null;
    try {
      const rows = await fetchLevel({ level: 'tables', catalog, schema });
      // Only concrete tables become diagram nodes (skip views / materialised views).
      const tables = rows
        .map((row) => row as string[])
        .filter(([, type]) => (type ?? '').toUpperCase() === 'BASE TABLE')
        .map(([name]) => name);

      const newNodes: Node[] = [];
      for (const [i, tableName] of tables.entries()) {
        const columns = await loadColumns(tableName);
        newNodes.push({
          id: `table-${tableName}`,
          type: 'tableNode',
          position: { x: 60 + (i % 3) * 300, y: 60 + Math.floor(i / 3) * 280 },
          data: makeTableData(tableName, columns) as unknown as Record<string, unknown>,
          draggable: true
        });
      }
      nodes = newNodes;
      edges = [];
      cmdCounter = 0;
      orderSeq = 0;
    } catch (err) {
      loadError = err instanceof Error ? err.message : m.sql_diagram_load_failed();
    } finally {
      loadingTables = false;
    }
  }

  async function loadColumns(tableName: string): Promise<DiagramColumn[]> {
    const rows = await fetchLevel({ level: 'columns', catalog, schema, table: tableName });
    return rows.map((row) => {
      const arr = row as unknown[];
      return { name: String(arr[0]), dataType: String(arr[1] ?? '') };
    });
  }

  function handleCatalogChange(e: Event) {
    catalog = (e.target as HTMLSelectElement).value;
    schema = '';
    schemas = [];
    if (catalog) void loadSchemas(catalog);
  }

  function handleSchemaChange(e: Event) {
    schema = (e.target as HTMLSelectElement).value;
  }

  onMount(() => {
    initialised = true;
    if (!data.trinoConfigured && !data.userClientExists) return;

    // Reuse the default context the user picked in the SQL editor tab.
    try {
      catalog = localStorage.getItem('trino_default_catalog') ?? '';
      schema = localStorage.getItem('trino_default_schema') ?? '';
    } catch {
      catalog = '';
      schema = '';
    }

    void loadCatalogs().then(() => {
      if (catalog && catalogs.includes(catalog)) {
        void loadSchemas(catalog).then(() => {
          if (schema && schemas.includes(schema)) void loadDiagram();
        });
      } else if (!catalogs.includes(catalog)) {
        catalog = '';
        schema = '';
      }
    });
  });

  // ─── Table column selection + inline clauses ─────────────────────────────
  function getTableNode(table: string): Node | undefined {
    return nodes.find(
      (n) => n.type === 'tableNode' && (n.data as TableNodeData).tableName === table
    );
  }

  function mutateTableData(table: string, mutate: (d: TableNodeData) => Partial<TableNodeData>) {
    const node = getTableNode(table);
    if (!node) return;
    const d = node.data as TableNodeData;
    replaceNodeData(node.id, { ...d, ...mutate(d) });
  }

  function toggleTableColumn(table: string, column: string, checked: boolean) {
    mutateTableData(table, (d) => ({
      selectedColumns: checked
        ? [...d.selectedColumns, column]
        : d.selectedColumns.filter((c) => c !== column)
    }));
  }

  function toggleAllTableColumns(table: string, checked: boolean) {
    mutateTableData(table, (d) => ({
      selectedColumns: checked ? d.columns.map((c) => c.name) : []
    }));
  }

  function setColumnClauses(table: string, column: string, clauses: TableColumnClauses) {
    const hasClauses = (clauses.where?.length ?? 0) > 0 || !!clauses.orderBy;
    mutateTableData(table, (d) => ({
      columnClauses: hasClauses
        ? { ...d.columnClauses, [column]: clauses }
        : Object.fromEntries(Object.entries(d.columnClauses).filter(([k]) => k !== column)),
      selectedColumns:
        hasClauses && !d.selectedColumns.includes(column)
          ? [...d.selectedColumns, column]
          : d.selectedColumns
    }));
  }

  /**
   * Rank of a column's inline ORDER BY among all inline ORDER BYs,
   * by insertion sequence. Rank 1 = applied first in the final query.
   * Returns null when there is none or only one (no number needed).
   */
  function getOrderRank(table: string, column: string): number | null {
    const items: { key: string; seq: number }[] = [];
    for (const node of nodes) {
      if (node.type !== 'tableNode') continue;
      const d = node.data as TableNodeData;
      for (const [colName, clause] of Object.entries(d.columnClauses)) {
        if (clause.orderBy) {
          items.push({ key: `${d.tableName}.${colName}`, seq: clause.orderBy.seq });
        }
      }
    }
    if (items.length <= 1) return null;
    items.sort((a, b) => a.seq - b.seq);
    const idx = items.findIndex((it) => it.key === `${table}.${column}`);
    return idx < 0 ? null : idx + 1;
  }

  // ─── Command node data updates ───────────────────────────────────────────
  function updateNodeWhereClause(
    nodeId: string,
    edgeId: string,
    field: 'operator' | 'value',
    val: string
  ) {
    const node = nodes.find((n) => n.id === nodeId);
    if (!node) return;
    const d = node.data as CommandNodeData;
    const clauses = d.whereClauses.map((c) => (c.edgeId === edgeId ? { ...c, [field]: val } : c));
    replaceNodeData(nodeId, { ...d, whereClauses: clauses });
  }

  function updateNodeOrderClause(nodeId: string, edgeId: string, direction: SortDirection) {
    const node = nodes.find((n) => n.id === nodeId);
    if (!node) return;
    const d = node.data as CommandNodeData;
    const clauses = d.orderClauses.map((c) => (c.edgeId === edgeId ? { ...c, direction } : c));
    replaceNodeData(nodeId, { ...d, orderClauses: clauses });
  }

  function updateNodeLimit(nodeId: string, val: number) {
    const node = nodes.find((n) => n.id === nodeId);
    if (!node) return;
    const d = node.data as CommandNodeData;
    replaceNodeData(node.id, { ...d, limitValue: val });
  }

  function updateNodeAggregate(nodeId: string, edgeId: string, fn: AggregateFn) {
    const node = nodes.find((n) => n.id === nodeId);
    if (!node) return;
    const d = node.data as CommandNodeData;
    const clauses = (d.aggregateClauses ?? []).some((a) => a.edgeId === edgeId)
      ? d.aggregateClauses!.map((a) => (a.edgeId === edgeId ? { ...a, fn } : a))
      : [...d.aggregateClauses!, { edgeId, fn }];
    replaceNodeData(nodeId, { ...d, aggregateClauses: clauses });
  }

  function updateNodeJoinType(nodeId: string, joinType: JoinType) {
    const node = nodes.find((n) => n.id === nodeId);
    if (!node) return;
    const d = node.data as CommandNodeData;
    replaceNodeData(node.id, { ...d, joinType });
  }

  // ─── Context menu (canvas) ───────────────────────────────────────────────
  let contextMenu = $state<{ x: number; y: number; flowX: number; flowY: number } | null>(null);

  function handlePaneContextMenu({ event }: { event: MouseEvent }) {
    event.preventDefault();
    contextMenu = {
      x: event.clientX,
      y: event.clientY,
      flowX: event.offsetX,
      flowY: event.offsetY
    };
  }

  function addCommandNode(cmd: CommandType) {
    if (!contextMenu) return;
    const newId = `cmd-${cmd.replace(/ /g, '_')}-${++cmdCounter}`;
    const newNode: Node = {
      id: newId,
      type: 'commandNode',
      position: { x: contextMenu.flowX, y: contextMenu.flowY },
      data: makeCommandData(newId, cmd) as unknown as Record<string, unknown>,
      draggable: true
    };
    nodes = [...nodes, newNode];
    contextMenu = null;
  }

  // ─── Column context menu + WHERE dialog ──────────────────────────────────
  let columnMenu = $state<{ x: number; y: number; table: string; column: string } | null>(null);

  function openColumnContextMenu(table: string, column: string, e: MouseEvent) {
    e.preventDefault();
    e.stopPropagation();
    columnMenu = { x: e.clientX, y: e.clientY, table, column };
  }

  function currentColumnClauses(): TableColumnClauses {
    if (!columnMenu) return {};
    const d = getTableNode(columnMenu.table)?.data as TableNodeData | undefined;
    return d?.columnClauses[columnMenu.column] ?? {};
  }

  function applyInlineOrder(direction: SortDirection) {
    if (!columnMenu) return;
    const { table, column } = columnMenu;
    setColumnClauses(table, column, {
      ...currentColumnClauses(),
      orderBy: { direction, seq: ++orderSeq }
    });
    columnMenu = null;
  }

  function clearInlineWhere() {
    if (!columnMenu) return;
    setColumnClauses(columnMenu.table, columnMenu.column, {
      orderBy: currentColumnClauses().orderBy
    });
    columnMenu = null;
  }

  function clearInlineOrder() {
    if (!columnMenu) return;
    setColumnClauses(columnMenu.table, columnMenu.column, {
      where: currentColumnClauses().where
    });
    columnMenu = null;
  }

  // WHERE dialog state (rendered in the shared Modal component).
  let whereDialogOpen = $state(false);
  let whereDialogTarget = $state<{ table: string; column: string } | null>(null);
  let draftRows = $state<{ operator: WhereOperator; value: string }[]>([]);

  function openWhereDialog() {
    if (!columnMenu) return;
    const existing = currentColumnClauses().where;
    draftRows =
      existing && existing.length > 0
        ? existing.map((w) => ({ operator: w.operator, value: w.value }))
        : [{ operator: '=', value: '' }];
    whereDialogTarget = { table: columnMenu.table, column: columnMenu.column };
    whereDialogOpen = true;
    columnMenu = null;
  }

  function addDraftRow() {
    draftRows.push({ operator: '=', value: '' });
  }

  function removeDraftRow(index: number) {
    draftRows.splice(index, 1);
  }

  const draftRowsValid = $derived(
    draftRows.length === 0 || draftRows.some((r) => r.value.trim() !== '')
  );

  function confirmWhereDialog(e: SubmitEvent) {
    e.preventDefault();
    if (!whereDialogTarget || !draftRowsValid) return;
    const d = getTableNode(whereDialogTarget.table)?.data as TableNodeData | undefined;
    const existing = d?.columnClauses[whereDialogTarget.column] ?? {};
    const rows = draftRows
      .map((r) => ({ operator: r.operator, value: r.value.trim() }))
      .filter((r) => r.value !== '');
    setColumnClauses(whereDialogTarget.table, whereDialogTarget.column, {
      ...existing,
      where: rows
    });
    whereDialogOpen = false;
  }

  // ─── Edge connection ─────────────────────────────────────────────────────
  function xyEdgeId(params: {
    source: string;
    sourceHandle: string | null;
    target: string;
    targetHandle: string | null;
  }): string {
    return (
      `xy-edge__${params.source}${params.sourceHandle ?? ''}-` +
      `${params.target}${params.targetHandle ?? ''}`
    );
  }

  const commandEdgeStyle = 'stroke:var(--color-accent);stroke-width:1.5;';

  /** Centre point of a node (falls back to an estimate before first render). */
  function nodeCentre(n: Node): { x: number; y: number } {
    const w = n.measured?.width ?? n.width ?? 220;
    const h = n.measured?.height ?? n.height ?? 240;
    return { x: n.position.x + w / 2, y: n.position.y + h / 2 };
  }

  /**
   * Resolve which source-side handle an edge should leave from.
   * When the user explicitly dragged from one of the column's two endpoints
   * (left/right), that choice is honoured; otherwise the edge leaves from
   * the side of the origin column facing the destination, comparing node
   * centres so nodes of different sizes are handled symmetrically.
   */
  function resolveSourceHandle(
    dragged: string | null | undefined,
    from: Node,
    to: Node,
    table: string,
    column: string
  ): string {
    const right = `${table}.${column}`;
    const left = `${right}|l`;
    if (dragged === right || dragged === left) return dragged;
    const cFrom = nodeCentre(from);
    const cTo = nodeCentre(to);
    return cTo.x >= cFrom.x ? right : left;
  }

  function makeJoinInputEdge(
    id: string,
    sourceNode: string,
    sourceCol: string,
    targetId: string,
    targetHandle: string
  ): Edge {
    return {
      id,
      source: sourceNode,
      sourceHandle: sourceCol,
      target: targetId,
      targetHandle,
      type: 'smoothstep',
      animated: false,
      style: commandEdgeStyle
    };
  }

  /** Create a JOIN command box between two columns and wire both into it. */
  function createJoinBetween(
    a: { table: string; column: string },
    b: { table: string; column: string },
    nodeA: Node,
    nodeB: Node,
    removeEdgeId: string,
    draggedSourceHandle: string | null | undefined
  ) {
    const posA = nodeCentre(nodeA);
    const posB = nodeCentre(nodeB);
    const joinId = `cmd-JOIN-${++cmdCounter}`;
    const cmdData = makeCommandData(joinId, 'JOIN');
    cmdData.joinType = 'INNER';
    cmdData.connectedColumns = [
      { edgeId: `${joinId}-a`, table: a.table, column: a.column },
      { edgeId: `${joinId}-b`, table: b.table, column: b.column }
    ];

    const newNode: Node = {
      id: joinId,
      type: 'commandNode',
      // Centre the JOIN box on the midpoint between the two columns so the
      // incoming edges from both sides stay short and balanced.
      position: { x: (posA.x + posB.x) / 2 - 110, y: (posA.y + posB.y) / 2 - 55 },
      data: cmdData as unknown as Record<string, unknown>,
      draggable: true
    };

    nodes = [...nodes, newNode];
    // Drop the direct column→column edge XYFlow added; route through JOIN instead,
    // one connection per entrypoint (A = top, B = bottom). Each edge leaves from
    // the endpoint the user dragged from when possible, otherwise from the side
    // of its origin column facing the other end.
    edges = [
      ...edges.filter((e) => e.id !== removeEdgeId),
      makeJoinInputEdge(
        `${joinId}-edge-a`,
        `table-${a.table}`,
        resolveSourceHandle(draggedSourceHandle, nodeA, nodeB, a.table, a.column),
        joinId,
        'join-input-a'
      ),
      makeJoinInputEdge(
        `${joinId}-edge-b`,
        `table-${b.table}`,
        resolveSourceHandle(undefined, nodeB, nodeA, b.table, b.column),
        joinId,
        'join-input-b'
      )
    ];
  }

  function handleConnect(params: {
    source: string;
    sourceHandle: string | null;
    target: string;
    targetHandle: string | null;
  }) {
    const srcCol = parseHandle(params.sourceHandle);
    const tgtCol = parseHandle(params.targetHandle);

    // Column → column connection: create a JOIN box automatically
    if (srcCol && tgtCol) {
      if (srcCol.table === tgtCol.table) {
        edges = edges.filter((e) => e.id !== xyEdgeId(params));
        return;
      }
      const srcNode = nodes.find((n) => n.id === params.source);
      const tgtNode = nodes.find((n) => n.id === params.target);
      if (!srcNode || !tgtNode) return;
      createJoinBetween(srcCol, tgtCol, srcNode, tgtNode, xyEdgeId(params), params.sourceHandle);
      return;
    }

    const edgeId = xyEdgeId(params);
    const targetNode = nodes.find((n) => n.id === params.target);
    const cmdInputHandles = CMD_INPUT_HANDLES;
    const isCmdInput =
      targetNode?.type === 'commandNode' && cmdInputHandles.has(params.targetHandle ?? '');

    if (srcCol && isCmdInput) {
      const srcNode = nodes.find((n) => n.id === params.source);
      if (!srcNode) return;
      connectColumnToCommand(
        srcCol,
        srcNode,
        targetNode!,
        edgeId,
        params.targetHandle ?? 'cmd-input',
        params.sourceHandle
      );
    } else if (!srcCol && !tgtCol && isCmdInput) {
      // Command → command chain: just restyle the edge XYFlow added
      edges = edges.map((e) =>
        e.id === edgeId ? { ...e, type: 'smoothstep', animated: true, style: commandEdgeStyle } : e
      );
    } else {
      edges = edges.filter((e) => e.id !== edgeId);
    }
  }

  function connectColumnToCommand(
    colRef: { table: string; column: string },
    sourceNode: Node,
    targetNode: Node,
    edgeId: string,
    targetHandle: string,
    draggedSourceHandle: string | null | undefined
  ) {
    const cmd = targetNode.data?.command as CommandType;
    const currentData = targetNode.data as CommandNodeData;

    // Restyle the edge XYFlow already added and re-anchor its source to the
    // endpoint the user dragged from (or the side facing the command node).
    edges = edges.map((e) =>
      e.id === edgeId
        ? {
            ...e,
            type: 'smoothstep',
            animated: true,
            style: commandEdgeStyle,
            sourceHandle: resolveSourceHandle(
              draggedSourceHandle,
              sourceNode,
              targetNode,
              colRef.table,
              colRef.column
            )
          }
        : e
    );

    let updatedCols: (ConnectedColumn | null)[];
    let updatedAggregates = [...(currentData.aggregateClauses ?? [])];

    if (cmd === 'JOIN') {
      const cols: (ConnectedColumn | null)[] = [
        currentData.connectedColumns[0] ?? null,
        currentData.connectedColumns[1] ?? null
      ];
      let slot = targetHandle === 'join-input-b' ? 1 : 0;
      // Prefer the free entrypoint when the dropped-onto one is occupied, so
      // both endpoints behave identically regardless of which one was used.
      if (cols[slot] && !cols[1 - slot]) slot = 1 - slot;
      if (cols[slot]) {
        // Both entry points occupied – drop the old edge of the chosen slot
        edges = edges.filter((e) => e.id !== cols[slot]!.edgeId);
        updatedAggregates = updatedAggregates.filter((a) => a.edgeId !== cols[slot]!.edgeId);
      }
      cols[slot] = { edgeId, table: colRef.table, column: colRef.column };
      updatedCols = cols;
    } else {
      updatedCols = [
        ...(currentData.connectedColumns ?? []),
        { edgeId, table: colRef.table, column: colRef.column }
      ];
      if (cmd === 'GROUP BY') {
        updatedAggregates.push({ edgeId, fn: 'NONE' });
      } else {
        // Entry points of other commands don't keep aggregates
        updatedAggregates = [];
      }
    }

    let updatedWhere = [...(currentData.whereClauses ?? [])];
    let updatedOrder = [...(currentData.orderClauses ?? [])];

    if (cmd === 'WHERE') {
      updatedWhere = [
        ...updatedWhere,
        { edgeId, table: colRef.table, column: colRef.column, operator: '=', value: '' }
      ];
    } else if (cmd === 'ORDER BY') {
      updatedOrder = [
        ...updatedOrder,
        { edgeId, table: colRef.table, column: colRef.column, direction: 'ASC' }
      ];
    }

    replaceNodeData(targetNode.id, {
      ...currentData,
      connectedColumns: updatedCols,
      whereClauses: updatedWhere,
      orderClauses: updatedOrder,
      aggregateClauses: updatedAggregates
    });
  }

  // ─── Node + edge deletion cleanup ────────────────────────────────────────
  function handleDelete({
    nodes: deletedNodes,
    edges: deletedEdges
  }: {
    nodes: Node[];
    edges: Edge[];
  }) {
    // eslint-disable-next-line svelte/prefer-svelte-reactivity -- local, never read reactively
    const allDeletedEdgeIds = new Set(deletedEdges.map((e) => e.id));
    for (const node of deletedNodes) {
      for (const e of edges) {
        if (e.source === node.id || e.target === node.id) allDeletedEdgeIds.add(e.id);
      }
    }

    // Purge deleted edge refs from surviving command nodes
    for (const node of nodes) {
      if (node.type !== 'commandNode') continue;
      const d = node.data as CommandNodeData;
      const newCols = d.connectedColumns.filter(
        (c): c is ConnectedColumn => !!c && !allDeletedEdgeIds.has(c.edgeId)
      );
      const newWhere = d.whereClauses.filter((c) => !allDeletedEdgeIds.has(c.edgeId));
      const newOrder = d.orderClauses.filter((c) => !allDeletedEdgeIds.has(c.edgeId));
      const newAggregates = (d.aggregateClauses ?? []).filter(
        (c) => !allDeletedEdgeIds.has(c.edgeId)
      );

      if (
        newCols.length !== d.connectedColumns.length ||
        newWhere.length !== d.whereClauses.length ||
        newOrder.length !== d.orderClauses.length ||
        newAggregates.length !== (d.aggregateClauses ?? []).length
      ) {
        replaceNodeData(node.id, {
          ...d,
          connectedColumns: newCols,
          whereClauses: newWhere,
          orderClauses: newOrder,
          aggregateClauses: newAggregates
        });
      }
    }
  }

  // ─── Query execution ─────────────────────────────────────────────────────
  let queryResult = $state<DiagramQueryResult | null>(null);
  let isRunning = $state(false);

  const previewSql = $derived(buildSql(buildQuerySpec(nodes, { catalog, schema })));

  async function runQuery() {
    if (!previewSql || isRunning) return;
    isRunning = true;
    queryResult = null;
    try {
      const res = await fetch('/api/trino/diagram-query', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ sql: previewSql })
      });
      const body = (await res.json()) as DiagramQueryResult & { error?: string };
      queryResult = res.ok
        ? { columns: body.columns ?? [], rows: body.rows ?? [], durationMs: body.durationMs ?? 0 }
        : {
            columns: [],
            rows: [],
            durationMs: 0,
            error: body.error ?? m.sql_diagram_query_failed()
          };
    } catch (err) {
      queryResult = {
        columns: [],
        rows: [],
        durationMs: 0,
        error: err instanceof Error ? err.message : m.sql_diagram_query_failed()
      };
    } finally {
      isRunning = false;
    }
  }

  // ─── Saved queries (persisted in Postgres) ──────────────────────────────
  let queriesModalOpen = $state(false);
  let savedQueries = $state<SavedDiagramQuery[]>([]);
  let queriesLoading = $state(false);
  let savingQuery = $state(false);
  let saveName = $state('');
  let queriesError = $state<string | null>(null);

  async function refreshSavedQueries() {
    queriesLoading = true;
    try {
      const res = await fetch('/api/sql-diagram/queries');
      if (!res.ok) throw new Error(await res.text());
      savedQueries = (await res.json()) as SavedDiagramQuery[];
      queriesError = null;
    } catch (err) {
      queriesError = err instanceof Error ? err.message : m.sql_diagram_load_failed();
    } finally {
      queriesLoading = false;
    }
  }

  function openQueriesModal() {
    saveName = '';
    void refreshSavedQueries();
    queriesModalOpen = true;
  }

  async function saveCurrentQuery() {
    const name = saveName.trim();
    if (!name || savingQuery) return;
    savingQuery = true;
    try {
      const serialised = serializeDiagram(nodes, edges, catalog, schema);
      const res = await fetch('/api/sql-diagram/queries', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          name,
          catalog,
          schema,
          nodes: serialised.nodes,
          edges: serialised.edges,
          sqlPreview: previewSql
        })
      });
      if (!res.ok) throw new Error(await res.text());
      await refreshSavedQueries();
    } catch (err) {
      queriesError = err instanceof Error ? err.message : m.sql_diagram_save_failed();
    } finally {
      savingQuery = false;
    }
  }

  async function deleteSavedQuery(id: string) {
    try {
      const res = await fetch(`/api/sql-diagram/queries?id=${encodeURIComponent(id)}`, {
        method: 'DELETE'
      });
      if (!res.ok) throw new Error(await res.text());
      savedQueries = savedQueries.filter((q) => q.id !== id);
    } catch (err) {
      queriesError = err instanceof Error ? err.message : m.sql_diagram_delete_failed();
    }
  }

  /** Rebuild a stored diagram into live nodes/edges with callbacks attached. */
  function restoreDiagram(saved: SavedDiagramQuery) {
    const restored = deserializeDiagram(saved.diagram);
    if (!restored || restored.nodes.length === 0) return;

    const restoredNodes: Node[] = restored.nodes.map((n) => {
      if (n.type === 'tableNode') {
        const d = makeTableData(String(n.data.tableName ?? ''), []);
        return {
          id: n.id,
          type: n.type,
          position: n.position,
          data: {
            ...n.data,
            onToggleColumn: d.onToggleColumn,
            onToggleAllColumns: d.onToggleAllColumns,
            onColumnContextMenu: d.onColumnContextMenu,
            onGetOrderRank: d.onGetOrderRank
          } as unknown as Record<string, unknown>,
          draggable: true
        };
      }
      const cmd = (n.data.command as CommandType | undefined) ?? 'WHERE';
      const d = makeCommandData(n.id, cmd);
      return {
        id: n.id,
        type: n.type,
        position: n.position,
        data: {
          ...d,
          ...n.data,
          // Callbacks always come from this session, never from storage
          onWhereUpdate: d.onWhereUpdate,
          onOrderUpdate: d.onOrderUpdate,
          onLimitUpdate: d.onLimitUpdate,
          onJoinUpdate: d.onJoinUpdate,
          onAggregateUpdate: d.onAggregateUpdate
        } as unknown as Record<string, unknown>,
        draggable: true
      };
    });

    nodes = restoredNodes;
    edges = restored.edges.map((e) => ({ ...e })) as Edge[];

    // Keep counters ahead of any ids present in the restored diagram.
    let maxCmd = 0;
    for (const id of [...nodes.map((n) => n.id), ...edges.map((e) => String(e.id))]) {
      const match = /-(\d+)$/.exec(id);
      if (match) maxCmd = Math.max(maxCmd, Number(match[1]));
    }
    cmdCounter = maxCmd;

    // Restore the catalogue context of the saved query.
    catalog = saved.catalog;
    schema = saved.schema;
    schemas = saved.schema ? [saved.schema] : [];
    if (catalog && !catalogs.includes(catalog)) catalogs = [...catalogs, catalog];

    queriesModalOpen = false;
  }

  // ─── Results panel resize ────────────────────────────────────────────────
  let resultsHeight = $state(260);
  let isResizing = $state(false);
  let resizeStartY = $state(0);
  let resizeStartH = $state(0);

  function startResize(e: MouseEvent) {
    isResizing = true;
    resizeStartY = e.clientY;
    resizeStartH = resultsHeight;
    e.preventDefault();
  }

  $effect(() => {
    if (!isResizing) return;
    function onMove(e: MouseEvent) {
      resultsHeight = Math.max(120, Math.min(600, resizeStartH + (resizeStartY - e.clientY)));
    }
    function onUp() {
      isResizing = false;
    }
    window.addEventListener('mousemove', onMove);
    window.addEventListener('mouseup', onUp);
    return () => {
      window.removeEventListener('mousemove', onMove);
      window.removeEventListener('mouseup', onUp);
    };
  });

  const noConnection = $derived(!data.trinoConfigured && !data.userClientExists);
</script>

<svelte:head>
  <title>{m.page_title_sql_diagram()}</title>
</svelte:head>

<div class="flex h-full flex-col gap-2 overflow-hidden">
  <ModuleTabs />

  <!-- Toolbar -->
  <div
    class="border-base-300 bg-base-100 flex shrink-0 flex-wrap items-center gap-3 rounded-xl border px-4 py-2"
  >
    <div class="flex items-center gap-2">
      <span class="text-base-content/60 text-sm font-medium">{m.page_title_sql_diagram()}</span>
    </div>

    <div class="bg-base-300 h-5 w-px"></div>

    {#if noConnection}
      <p class="text-error text-sm">{m.sql_diagram_no_connection()}</p>
    {:else}
      <div class="flex flex-wrap items-center gap-2">
        <div class="flex flex-col">
          <label for="{uid}-catalog" class="text-base-content/60 text-[11px] font-medium">
            {m.trino_default_catalog()}
          </label>
          <select
            id="{uid}-catalog"
            class="select select-sm w-40"
            value={catalog}
            onchange={handleCatalogChange}
          >
            <option value="">-</option>
            {#each catalogs as cat (cat)}
              <option value={cat}>{cat}</option>
            {/each}
          </select>
        </div>
        <div class="flex flex-col">
          <label for="{uid}-schema" class="text-base-content/60 text-[11px] font-medium">
            {m.trino_default_schema()}
          </label>
          <select
            id="{uid}-schema"
            class="select select-sm w-40"
            value={schema}
            onchange={handleSchemaChange}
            disabled={!catalog}
          >
            <option value="">-</option>
            {#each schemas as s (s)}
              <option value={s}>{s}</option>
            {/each}
          </select>
        </div>
        <button
          type="button"
          class="btn btn-sm btn-neutral mt-4"
          onclick={loadDiagram}
          disabled={!catalog || !schema || loadingTables}
        >
          {#if loadingTables}
            <span class="loading loading-spinner loading-xs"></span>
          {/if}
          {m.sql_diagram_load_tables()}
        </button>
      </div>

      <div class="ml-auto flex items-center gap-3">
        <span class="text-base-content/40 hidden text-[11px] lg:block">
          {m.sql_diagram_hint()}
        </span>
        <button
          type="button"
          class="btn btn-sm btn-ghost"
          onclick={openQueriesModal}
          data-testid="diagram-open-queries"
        >
          {m.sql_diagram_saved_queries()}
        </button>
        <button
          type="button"
          class="btn btn-primary btn-sm"
          onclick={runQuery}
          disabled={isRunning || !previewSql}
          data-testid="diagram-run"
        >
          {#if isRunning}
            <span class="loading loading-spinner loading-xs"></span>
            {m.sql_diagram_running()}
          {:else}
            {m.sql_diagram_run()}
          {/if}
        </button>
      </div>
    {/if}
  </div>

  {#if loadError}
    <div role="alert" class="alert alert-error py-2 text-sm">
      {m.sql_diagram_load_failed()}
      <span class="font-mono text-xs opacity-70">{loadError}</span>
    </div>
  {/if}

  {#if noConnection}
    <div
      class="border-base-300 bg-base-100 flex flex-1 flex-col items-center justify-center rounded-xl border p-8"
    >
      <p class="text-base-content/60 max-w-md text-center text-sm">
        {m.sql_diagram_no_connection()}
      </p>
    </div>
  {:else}
    <!-- Canvas + results -->
    <div class="flex min-h-0 flex-1 flex-col overflow-hidden">
      <div
        class="relative min-h-0 flex-1 overflow-hidden"
        style="height: calc(100% - {resultsHeight + 10}px)"
      >
        <SvelteFlow
          bind:nodes
          bind:edges
          {nodeTypes}
          onpanecontextmenu={handlePaneContextMenu}
          onconnect={handleConnect}
          ondelete={handleDelete}
          deleteKey={['Delete', 'Backspace']}
          fitView
          class="bg-base-200"
          proOptions={{ hideAttribution: true }}
        >
          <Background gap={20} size={1} class="opacity-30" />
          <Controls />
          <MiniMap
            nodeColor={(n) =>
              n.type === 'tableNode' ? 'var(--color-primary)' : 'var(--color-accent)'}
            class="!border-base-300 !bg-base-100"
          />

          <!-- Legend -->
          <div
            class="border-base-300 bg-base-100/90 pointer-events-none absolute top-4 left-4 z-10 rounded-lg border p-3 text-[11px] backdrop-blur-sm"
          >
            <p class="text-base-content/50 mb-1.5 font-semibold tracking-widest uppercase">
              {m.sql_diagram_legend()}
            </p>
            <div class="space-y-1.5">
              <div class="flex items-center gap-2">
                <svg width="24" height="8" aria-hidden="true" class="text-accent"
                  ><line
                    x1="0"
                    y1="4"
                    x2="24"
                    y2="4"
                    stroke="currentColor"
                    stroke-width="1.5"
                  /></svg
                >
                <span class="text-base-content/50">{m.sql_diagram_legend_join()}</span>
              </div>
            </div>
          </div>

          {#if loadingTables}
            <div class="absolute inset-0 z-20 flex items-center justify-center">
              <div class="border-base-300 bg-base-100 rounded-xl border p-6 shadow-lg">
                <span class="loading loading-dots loading-md"></span>
              </div>
            </div>
          {/if}
        </SvelteFlow>

        {#if initialised && nodes.length === 0 && !loadingTables}
          <div class="pointer-events-none absolute inset-0 z-10 flex items-center justify-center">
            <p
              class="text-base-content/40 border-base-300 rounded-xl border border-dashed px-6 py-4 text-sm"
            >
              {m.sql_diagram_pick_schema()}
            </p>
          </div>
        {/if}
      </div>

      <!-- Resize handle -->
      <!-- svelte-ignore a11y_no_static_element_interactions -->
      <div
        class="group bg-base-300 hover:bg-primary/30 flex h-2 shrink-0 cursor-row-resize items-center justify-center"
        onmousedown={startResize}
      >
        <div class="bg-base-content/20 group-hover:bg-primary/50 h-0.5 w-12 rounded-full"></div>
      </div>

      <!-- Permanent results panel with assembled SQL preview -->
      <div
        class="border-base-300 bg-base-100 shrink-0 overflow-hidden rounded-xl border"
        style="height: {resultsHeight}px"
      >
        <DiagramResultsPanel {previewSql} result={queryResult} {isRunning} />
      </div>
    </div>
  {/if}
</div>

<!-- Context menu (canvas) -->
{#if contextMenu}
  <DiagramCanvasMenu
    x={contextMenu.x}
    y={contextMenu.y}
    onselect={addCommandNode}
    onclose={() => (contextMenu = null)}
  />
{/if}

<!-- Context menu (column) -->
{#if columnMenu}
  <DiagramColumnMenu
    x={columnMenu.x}
    y={columnMenu.y}
    tableName={columnMenu.table}
    columnName={columnMenu.column}
    hasWhere={(currentColumnClauses().where?.length ?? 0) > 0}
    orderBy={currentColumnClauses().orderBy?.direction}
    onwhere={openWhereDialog}
    onorder={applyInlineOrder}
    onclearwhere={clearInlineWhere}
    onclearorder={clearInlineOrder}
    onclose={() => (columnMenu = null)}
  />
{/if}

<!-- WHERE dialog -->
{#if whereDialogTarget}
  <Modal bind:open={whereDialogOpen} class="modal">
    <form class="modal-box max-w-sm" onsubmit={confirmWhereDialog}>
      <h3 class="text-base font-semibold">
        WHERE
        <span class="text-warning font-mono"
          >{whereDialogTarget.table}.{whereDialogTarget.column}</span
        >
      </h3>
      <p class="text-base-content/50 mt-1 text-xs">{m.sql_diagram_where_dialog_hint()}</p>

      <!-- One row per condition, − removes it -->
      <div class="mt-4 space-y-2">
        {#each draftRows as row, i (i)}
          <div class="flex items-center gap-2">
            <select
              class="select select-sm w-24 font-mono"
              aria-label={m.sql_diagram_operator_aria({ index: i + 1 })}
              bind:value={row.operator}
            >
              {#each WHERE_OPERATORS as op (op)}
                <option value={op}>{op}</option>
              {/each}
            </select>
            <input
              type="text"
              class="input input-sm min-w-0 flex-1 font-mono"
              placeholder={m.sql_diagram_value_placeholder()}
              aria-label={m.sql_diagram_value_aria({ index: i + 1 })}
              bind:value={row.value}
            />
            <button
              type="button"
              class="btn btn-ghost btn-circle btn-sm hover:bg-error/10 text-error px-2"
              aria-label={m.sql_diagram_remove_where_row({ index: i + 1 })}
              onclick={() => removeDraftRow(i)}
            >
              ×
            </button>
          </div>
        {/each}
      </div>

      <!-- + adds another WHERE row -->
      <button
        type="button"
        class="btn btn-ghost btn-warning btn-xs mt-2 gap-1"
        onclick={addDraftRow}
      >
        +
        {m.sql_diagram_add_where_row()}
      </button>

      <div class="modal-action">
        <button
          type="button"
          class="btn btn-ghost btn-sm"
          onclick={() => (whereDialogOpen = false)}
        >
          {m.sql_diagram_cancel()}
        </button>
        <button type="submit" class="btn btn-primary btn-sm" disabled={!draftRowsValid}>
          {draftRows.length === 0 ? m.sql_diagram_remove_where() : m.sql_diagram_apply_where()}
        </button>
      </div>
    </form>
  </Modal>
{/if}

<!-- Saved queries modal -->
<Modal bind:open={queriesModalOpen} class="modal">
  <div class="modal-box max-w-md" data-testid="saved-queries-modal">
    <h3 class="text-base font-semibold">{m.sql_diagram_saved_queries()}</h3>

    <!-- Save current diagram -->
    <form
      class="mt-3 flex items-end gap-2"
      onsubmit={(e) => {
        e.preventDefault();
        void saveCurrentQuery();
      }}
    >
      <div class="flex-1">
        <label
          for="{uid}-query-name"
          class="text-base-content/60 mb-0.5 block text-[11px] font-medium"
        >
          {m.sql_diagram_query_name()}
        </label>
        <input
          id="{uid}-query-name"
          type="text"
          class="input input-sm w-full"
          placeholder={m.sql_diagram_query_name()}
          maxlength="100"
          bind:value={saveName}
        />
      </div>
      <button
        type="submit"
        class="btn btn-primary btn-sm"
        disabled={savingQuery || saveName.trim() === ''}
        data-testid="diagram-save-query"
      >
        {#if savingQuery}
          <span class="loading loading-spinner loading-xs"></span>
        {/if}
        {m.sql_diagram_save()}
      </button>
    </form>

    {#if queriesError}
      <p role="alert" class="text-error mt-2 text-xs">{queriesError}</p>
    {/if}

    <!-- Saved query list -->
    <div class="border-base-200 mt-4 border-t pt-3">
      {#if queriesLoading}
        <div class="flex justify-center py-4">
          <span class="loading loading-dots loading-sm"></span>
        </div>
      {:else if savedQueries.length === 0}
        <p class="text-base-content/40 py-4 text-center text-sm italic">
          {m.sql_diagram_no_saved_queries()}
        </p>
      {:else}
        <ul class="space-y-1">
          {#each savedQueries as q (q.id)}
            <li
              class="border-base-200 hover:bg-base-200/50 flex items-center gap-2 rounded-lg border px-2 py-1.5"
            >
              <div class="min-w-0 flex-1">
                <p class="truncate text-sm font-medium">{q.name}</p>
                <p class="text-base-content/40 font-mono text-[10px]">
                  {q.catalog}{q.schema ? `.${q.schema}` : ''} · {new Date(
                    q.updatedAt
                  ).toLocaleDateString()} · {q.nodeCount}
                  {m.sql_diagram_nodes()}
                </p>
              </div>
              <button
                type="button"
                class="btn btn-ghost btn-xs"
                onclick={() => restoreDiagram(q)}
                data-testid="diagram-load-query"
              >
                {m.sql_diagram_load()}
              </button>
              <button
                type="button"
                class="btn btn-ghost btn-circle hover:bg-error/10 text-error btn-xs"
                aria-label={m.sql_diagram_delete_query_aria({ name: q.name })}
                onclick={() => void deleteSavedQuery(q.id)}
                data-testid="diagram-delete-query"
              >
                ×
              </button>
            </li>
          {/each}
        </ul>
      {/if}
    </div>

    <div class="modal-action">
      <button type="button" class="btn btn-ghost btn-sm" onclick={() => (queriesModalOpen = false)}>
        {m.sql_diagram_cancel()}
      </button>
    </div>
  </div>
</Modal>

<style>
  :global(.svelte-flow) {
    --xy-node-border-radius: 0.5rem;
    --xy-background-color: transparent;
    border-radius: 0.75rem;
  }
  :global(.svelte-flow .svelte-flow__minimap) {
    border-radius: 0.5rem;
  }
  :global(.svelte-flow .svelte-flow__controls button) {
    background-color: var(--color-base-100);
    border-color: var(--color-base-300);
    color: var(--color-base-content);
  }
</style>

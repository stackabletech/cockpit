/**
 * Serialisation of diagram state for persistence.
 *
 * Node data contains live callbacks (`on*` functions) which cannot be stored;
 * they are stripped on save and re-attached by the page when loading.
 */

import type { Edge } from '@xyflow/svelte';

export const DIAGRAM_FORMAT_VERSION = 1;

/** A saved query as returned by /api/sql-diagram/queries. */
export interface SavedDiagramQuery {
  id: string;
  name: string;
  catalog: string;
  schema: string;
  diagram: StoredDiagram | null;
  sqlPreview: string;
  nodeCount: number;
  createdAt: string;
  updatedAt: string;
}

export interface StoredDiagram {
  version: number;
  nodes: StoredNode[];
  edges: unknown[];
  catalog: string;
  schema: string;
}

interface StoredNode {
  id: string;
  type?: string;
  position?: { x: number; y: number };
  data: Record<string, unknown>;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null;
}

/** Minimal structural views so the server can re-serialise untrusted payloads. */
interface SerialisableNode {
  id: string;
  type?: string;
  position?: { x: number; y: number };
  data?: Record<string, unknown>;
}

interface SerialisableEdge {
  id?: string;
  source: string;
  target: string;
  sourceHandle?: string | null;
  targetHandle?: string | null;
  type?: string;
  animated?: boolean;
}

/**
 * Convert live XYFlow nodes/edges into a JSON-safe structure by removing
 * all callback properties from node data.
 */
export function serializeDiagram(
  nodes: readonly SerialisableNode[],
  edges: readonly SerialisableEdge[],
  catalog: string,
  schema: string
): StoredDiagram {
  return {
    version: DIAGRAM_FORMAT_VERSION,
    nodes: nodes.map((n) => ({
      id: n.id,
      type: n.type,
      position: { x: n.position?.x ?? 0, y: n.position?.y ?? 0 },
      data: Object.fromEntries(
        Object.entries(n.data ?? {}).filter(
          ([key, value]) => !key.startsWith('on') && typeof value !== 'function'
        )
      )
    })),
    edges: edges.map((e) => ({
      id: e.id,
      source: e.source,
      target: e.target,
      sourceHandle: e.sourceHandle,
      targetHandle: e.targetHandle,
      type: e.type,
      animated: e.animated
    })),
    catalog,
    schema
  };
}

/**
 * Validate and normalise a stored payload back into XYFlow-ready
 * nodes/edges. Node data still lacks callbacks – the caller must attach them.
 * Returns null when the payload is malformed.
 */
export function deserializeDiagram(value: unknown):
  | {
      nodes: { id: string; type: string; position: { x: number; y: number }; data: Record<string, unknown> }[];
      edges: Partial<Edge>[];
    }
  | null {
  if (!isRecord(value)) return null;
  const rawNodes = value.nodes;
  if (!Array.isArray(rawNodes)) return null;

  const nodes: NonNullable<ReturnType<typeof deserializeDiagram>>['nodes'] = [];
  for (const raw of rawNodes) {
    if (!isRecord(raw) || typeof raw.id !== 'string' || !isRecord(raw.data)) continue;
    if (raw.type !== 'tableNode' && raw.type !== 'commandNode') continue;
    const pos = isRecord(raw.position) ? raw.position : {};
    nodes.push({
      id: raw.id,
      type: raw.type,
      position: {
        x: typeof pos.x === 'number' ? pos.x : 0,
        y: typeof pos.y === 'number' ? pos.y : 0
      },
      data: Object.fromEntries(
        Object.entries(raw.data).filter(([, v]) => typeof v !== 'function')
      )
    });
  }

  const rawEdges = Array.isArray(value.edges) ? value.edges : [];
  const edges = rawEdges.filter(
    (e): e is Partial<Edge> =>
      isRecord(e) && typeof e.source === 'string' && typeof e.target === 'string'
  );

  return { nodes, edges };
}

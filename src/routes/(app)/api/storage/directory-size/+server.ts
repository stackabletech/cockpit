import { error } from '@sveltejs/kit';
import { getProvider } from '$lib/server/storage/utils.js';
import { requireBucket } from '../params.js';
import type {
  DirectorySizeEvent,
  DirectoryChildItem,
  TreemapNode
} from '$lib/storage/details-types.js';
import type { RequestHandler } from './$types';

const MAX_DEPTH = 5;

function buildTree(prefix: string, keys: Array<{ key: string; size: number }>): TreemapNode {
  const rootName = prefix.split('/').filter(Boolean).pop() || '(root)';

  interface TrieNode {
    name: string;
    size: number;
    children: Map<string, TrieNode>;
  }

  const rootTrie: TrieNode = { name: rootName, size: 0, children: new Map() };

  for (const { key, size } of keys) {
    const relative = key.slice(prefix.length);
    const parts = relative.split('/').filter(Boolean);
    if (parts.length === 0) continue;

    rootTrie.size += size;
    let current = rootTrie;
    for (let i = 0; i < parts.length; i++) {
      const part = parts[i];
      if (!current.children.has(part)) {
        current.children.set(part, { name: part, size: 0, children: new Map() });
      }
      current = current.children.get(part)!;
      current.size += size;
    }
  }

  function trieToTreemap(node: TrieNode): TreemapNode {
    function convert(n: TrieNode, parentPrefix: string, isRoot: boolean): TreemapNode {
      const result: TreemapNode = {
        name: n.name,
        size: n.size
      };
      if (n.children.size > 0) {
        result.children = [...n.children.entries()]
          .map(([, v]) => convert(v, isRoot ? '' : parentPrefix + n.name + '/', false))
          .sort((a, b) => b.size - a.size);
      } else {
        result.path = parentPrefix || undefined;
        result.fullKey = prefix + (parentPrefix || '') + n.name;
      }
      return result;
    }
    return convert(node, '', true);
  }

  return trieToTreemap(rootTrie);
}

function buildChildrenByDepth(
  prefix: string,
  keys: Array<{ key: string; size: number; lastModified?: Date }>,
  maxDepth: number
): Record<number, DirectoryChildItem[]> {
  const depthMaps: Map<string, { size: number; lastModified: Date | undefined }>[] = [];
  for (let d = 1; d <= maxDepth; d++) {
    depthMaps.push(new Map());
  }

  for (const { key, size, lastModified } of keys) {
    const relative = key.slice(prefix.length);
    const parts = relative.split('/').filter(Boolean);
    if (parts.length === 0) continue;

    for (let d = 1; d <= maxDepth; d++) {
      if (parts.length < d) continue;

      const nameParts = parts.slice(0, d);
      const index = d - 1;
      const isDir = index < parts.length - 1 || relative.endsWith('/');
      const childName = isDir ? nameParts.join('/') + '/' : nameParts.join('/');

      const map = depthMaps[d - 1];
      const existing = map.get(childName);
      if (existing) {
        existing.size += size;
        if (lastModified && (!existing.lastModified || lastModified > existing.lastModified)) {
          existing.lastModified = lastModified;
        }
      } else {
        map.set(childName, { size, lastModified });
      }
    }
  }

  const result: Record<number, DirectoryChildItem[]> = {};
  for (let d = 1; d <= maxDepth; d++) {
    result[d] = [...depthMaps[d - 1].entries()]
      .map(([name, entry]) => ({
        name,
        size: entry.size,
        lastModified: entry.lastModified?.toISOString(),
        isDirectory: name.endsWith('/')
      }))
      .sort((a, b) => b.size - a.size);
  }

  return result;
}

export const GET: RequestHandler = async ({ url, locals }) => {
  const bucket = requireBucket(url);
  const prefix = url.searchParams.get('prefix') ?? '';

  if (!prefix) {
    throw error(400, 'Missing required query parameter: prefix');
  }

  locals.logger.debug({ bucket, prefix }, 'calculating directory size');

  const provider = getProvider(locals.storageConfig!, bucket);
  const allKeys: Array<{ key: string; size: number; lastModified?: Date }> = [];
  const startTime = Date.now();
  const encoder = new TextEncoder();

  const stream = new ReadableStream({
    async start(controller) {
      try {
        await provider.listAllKeysProgressively(prefix, (batch) => {
          allKeys.push(...batch);

          const progress: DirectorySizeEvent = {
            type: 'progress',
            keysFound: allKeys.length,
            totalSize: allKeys.reduce((sum, k) => sum + k.size, 0)
          };

          controller.enqueue(encoder.encode(`data: ${JSON.stringify(progress)}\n\n`));
        });

        const tree = buildTree(prefix, allKeys);
        const childrenByDepth = buildChildrenByDepth(prefix, allKeys, MAX_DEPTH);
        let totalFiles = 0;
        let totalDirectories = 0;
        for (const { key } of allKeys) {
          if (key.endsWith('/')) {
            totalDirectories++;
          } else {
            totalFiles++;
          }
        }

        const result: DirectorySizeEvent = {
          type: 'complete',
          totalSize: allKeys.reduce((sum, k) => sum + k.size, 0),
          totalKeys: allKeys.length,
          totalFiles,
          totalDirectories,
          tree,
          childrenByDepth,
          durationMs: Date.now() - startTime
        };

        controller.enqueue(encoder.encode(`data: ${JSON.stringify(result)}\n\n`));
        controller.close();
      } catch (err) {
        const errorEvent: DirectorySizeEvent = {
          type: 'error',
          message: err instanceof Error ? err.message : 'Unknown error'
        };
        controller.enqueue(encoder.encode(`data: ${JSON.stringify(errorEvent)}\n\n`));
        controller.close();
      }
    }
  });

  return new Response(stream, {
    headers: {
      'Content-Type': 'text/event-stream',
      'Cache-Control': 'no-cache',
      Connection: 'keep-alive'
    }
  });
};

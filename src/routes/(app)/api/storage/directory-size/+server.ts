import { error } from '@sveltejs/kit';
import { getProvider } from '$lib/server/storage/utils.js';
import { requireBucket } from '../params.js';
import type { DirectorySizeEvent, TreemapNode } from '$lib/storage/details-types.js';
import type { RequestHandler } from './$types';

function buildTree(prefix: string, keys: Array<{ key: string; size: number }>): TreemapNode {
  const root: TreemapNode = {
    name: prefix.split('/').filter(Boolean).pop() || '(root)',
    size: 0,
    children: []
  };

  const childMap = new Map<string, TreemapNode>();

  for (const { key, size } of keys) {
    const relative = key.slice(prefix.length);
    const parts = relative.split('/').filter(Boolean);

    if (parts.length === 0) continue;

    const topName = parts[0];
    const existing = childMap.get(topName) ?? { name: topName, size: 0, children: [] };
    existing.size += size;
    childMap.set(topName, existing);
    root.size += size;
  }

  root.children = [...childMap.entries()]
    .map(([, v]) => v)
    .sort((a, b) => b.size - a.size);

  return root;
}

export const GET: RequestHandler = async ({ url, locals }) => {
  const bucket = requireBucket(url);
  const prefix = url.searchParams.get('prefix') ?? '';

  if (!prefix) {
    throw error(400, 'Missing required query parameter: prefix');
  }

  locals.logger.debug({ bucket, prefix }, 'calculating directory size');

  const provider = getProvider(locals.storageConfig!, bucket);
  const allKeys: Array<{ key: string; size: number }> = [];
  const startTime = Date.now();
  const encoder = new TextEncoder();

  const stream = new ReadableStream({
    async start(controller) {
      try {
        await provider.listAllKeysProgressively(prefix, (batch) => {
          allKeys.push(...batch);

          const subdirs: Record<string, number> = {};
          for (const { key } of batch) {
            const relative = key.slice(prefix.length);
            const parts = relative.split('/').filter(Boolean);
            if (parts.length > 1) {
              const dir = prefix + parts[0] + '/';
              subdirs[dir] = (subdirs[dir] ?? 0) + 1;
            }
          }

          const progress: DirectorySizeEvent = {
            type: 'progress',
            keysFound: allKeys.length,
            totalSize: allKeys.reduce((sum, k) => sum + k.size, 0),
            subdirs
          };

          controller.enqueue(encoder.encode(`data: ${JSON.stringify(progress)}\n\n`));
        });

        const tree = buildTree(prefix, allKeys);
        const result: DirectorySizeEvent = {
          type: 'complete',
          totalSize: allKeys.reduce((sum, k) => sum + k.size, 0),
          totalKeys: allKeys.length,
          tree,
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

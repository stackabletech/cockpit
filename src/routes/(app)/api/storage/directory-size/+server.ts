import { error } from '@sveltejs/kit';
import type { DirectorySizeEvent } from '$lib/storage/details-types.js';
import { buildTree, buildChildrenByDepth } from '$lib/server/storage/directory-tree.js';
import { withStorage } from '../_middleware.js';

export const GET = async (event) => {
  const { provider, params } = await withStorage(event);
  const prefix = params.prefix;

  if (!prefix) throw error(400, 'Missing required query parameter: prefix');

  event.locals.logger.debug({ bucket: params.bucket, prefix }, 'calculating directory size');

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
        const actualMaxDepth =
          allKeys.length > 0
            ? Math.max(
                1,
                ...allKeys.map(({ key }) => {
                  const relative = key.slice(prefix.length);
                  return relative.split('/').filter(Boolean).length;
                })
              )
            : 1;
        const childrenByDepth = buildChildrenByDepth(prefix, allKeys, actualMaxDepth);
        let totalFiles = 0;
        let totalDirectories = 0;
        for (const { key } of allKeys) {
          if (key.endsWith('/')) totalDirectories++;
          else totalFiles++;
        }

        const result: DirectorySizeEvent = {
          type: 'complete',
          totalSize: allKeys.reduce((sum, k) => sum + k.size, 0),
          totalKeys: allKeys.length,
          totalFiles,
          totalDirectories,
          tree,
          childrenByDepth,
          maxDepth: actualMaxDepth,
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

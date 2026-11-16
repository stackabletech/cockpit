import fs from 'node:fs/promises';
import path from 'node:path';

/** The adapter-node body size limit of the image, so E2E apps match production. */
export async function productionBodySizeLimit(): Promise<string> {
  const dockerfile = await fs.readFile(
    path.join(import.meta.dirname, '../../docker/Dockerfile'),
    'utf-8'
  );
  const limit = /^ENV BODY_SIZE_LIMIT=(\S+)$/m.exec(dockerfile)?.[1];
  if (!limit) throw new Error('BODY_SIZE_LIMIT not found in docker/Dockerfile');
  return limit;
}

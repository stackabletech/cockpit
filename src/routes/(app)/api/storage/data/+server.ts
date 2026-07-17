import { error, isHttpError, json } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import type { StorageProvider } from '$lib/server/storage/provider.js';
import type { FileDetails, DirectoryMetadata } from '$lib/storage/details-types.js';
import { maxEditableFileSize } from '$lib/server/feature-flags.js';
import { withStorage, type StorageParams } from '../_middleware.js';

// ─── Operation Handlers ─────────────────────────────────────────────────────

async function handleList(
  provider: StorageProvider,
  params: StorageParams,
  logger: App.Locals['logger']
) {
  const prefix = params.prefix ?? '';
  const pageSize = params.pageSize;

  logger.debug(
    {
      bucket: params.bucket,
      prefix,
      continuation_token: params.continuationToken,
      page_size: pageSize
    },
    'listing objects'
  );

  const page = await provider.listObjects(prefix, pageSize, params.continuationToken);
  return Response.json(page);
}

async function handleDetails(
  provider: StorageProvider,
  params: StorageParams,
  logger: App.Locals['logger']
) {
  if (!params.key) throw error(400, 'Missing required parameter: key');

  logger.debug({ bucket: params.bucket, key: params.key }, 'fetching object details');

  const meta = await provider.getMetadata(params.key);

  const details: FileDetails = {
    key: params.key,
    name: params.key.split('/').filter(Boolean).pop() ?? params.key,
    size: meta.size,
    lastModified: meta.lastModified,
    contentType: meta.contentType,
    etag: meta.etag,
    customMetadata: meta.customMetadata,
    versionId: meta.versionId,
    storageClass: meta.storageClass,
    isDeleteMarker: meta.isDeleteMarker ?? false
  };

  return Response.json(details);
}

async function handleCheckBucket(
  provider: StorageProvider,
  params: StorageParams,
  logger: App.Locals['logger']
) {
  try {
    await provider.listObjects('', 1);
    logger.debug({ bucket: params.bucket }, 'bucket access check passed');
    return new Response(null, { status: 204 });
  } catch (err) {
    if (isHttpError(err)) throw err;
    logger.warn({ err, bucket: params.bucket }, 'unexpected error during bucket access check');
    throw error(502, 'Could not reach bucket');
  }
}

async function handleCreate(
  provider: StorageProvider,
  params: StorageParams,
  logger: App.Locals['logger']
) {
  if (!params.key) throw error(400, 'Missing required parameter: key');

  const contentType = params.key.endsWith('/') ? 'application/x-directory' : 'text/plain';

  logger.debug({ bucket: params.bucket, key: params.key }, 'creating object');

  await provider.putObject(params.key, Buffer.alloc(0), contentType, 0);

  logger.info(
    { bucket: params.bucket, key: params.key, content_type: contentType },
    'object created'
  );

  return new Response(null, { status: 201 });
}

async function handleDelete(
  provider: StorageProvider,
  params: StorageParams,
  logger: App.Locals['logger']
) {
  const keys = params.keys;
  if (!keys.length) throw error(400, 'Missing required parameter: keys');

  logger.debug({ bucket: params.bucket, key_count: keys.length }, 'delete request received');

  const result = await provider.deleteObjects(keys);

  logger.info(
    { bucket: params.bucket, key_count: keys.length, failed_count: result.failed.length },
    'objects delete completed'
  );

  return Response.json(result);
}

async function handleRename(
  provider: StorageProvider,
  params: StorageParams,
  logger: App.Locals['logger']
) {
  if (!params.key) throw error(400, 'Missing required body field: key');
  if (!params.newKey) throw error(400, 'Missing required body field: newKey');

  logger.debug(
    { bucket: params.bucket, source_key: params.key, dest_key: params.newKey },
    'rename request received'
  );

  const exists = await provider.exists(params.newKey);
  if (exists) throw error(409, `Destination "${params.newKey}" already exists`);

  if (params.key.endsWith('/')) {
    const children = await provider.listAllKeys(params.key);
    try {
      await provider.copyObject(params.key, params.newKey);
    } catch (err) {
      throw error(
        502,
        `Rename failed for directory marker: ${err instanceof Error ? err.message : 'Unknown error'}`
      );
    }
    for (const child of children) {
      const destChild = params.newKey + child.slice(params.key.length);
      try {
        await provider.copyObject(child, destChild);
      } catch (err) {
        throw error(
          502,
          `Rename failed for child "${child}": ${err instanceof Error ? err.message : 'Unknown error'}`
        );
      }
    }
    const deleteResult = await provider.deleteObjects([params.key, ...children]);
    if (deleteResult.failed.length > 0) {
      logger.warn(
        { bucket: params.bucket, failed_count: deleteResult.failed.length },
        'rename delete had failures'
      );
    }
  } else {
    try {
      await provider.copyObject(params.key, params.newKey);
    } catch (err) {
      throw error(502, `Rename failed: ${err instanceof Error ? err.message : 'Unknown error'}`);
    }
    try {
      await provider.deleteObjects([params.key]);
    } catch (err) {
      throw error(
        502,
        `Rename delete failed: ${err instanceof Error ? err.message : 'Unknown error'}`
      );
    }
  }

  logger.info(
    { bucket: params.bucket, source_key: params.key, dest_key: params.newKey },
    'rename completed'
  );

  return json({ success: true });
}

async function handleSaveText(
  provider: StorageProvider,
  params: StorageParams,
  logger: App.Locals['logger'],
  request: Request
) {
  if (!params.key) throw error(400, 'Missing required parameter: key');

  const contentType = params.contentType || 'text/plain';
  const originalSize = params.originalSize!;
  const previewBytes = params.previewBytes ?? originalSize;

  if (!Number.isFinite(originalSize) || originalSize < 0) {
    throw error(400, 'Invalid originalSize: must be a non-negative integer');
  }
  if (!Number.isFinite(previewBytes) || previewBytes < 0) {
    throw error(400, 'Invalid previewBytes: must be a non-negative integer');
  }

  if (!request.body) throw error(400, 'Missing request body');

  if (originalSize > maxEditableFileSize) {
    logger.warn(
      {
        bucket: params.bucket,
        key: params.key,
        original_size: originalSize,
        max_editable_size: maxEditableFileSize
      },
      'save-text rejected: file exceeds max editable size (read-only)'
    );
    throw error(413, 'File exceeds the maximum editable size and is read-only');
  }

  const truncated = previewBytes > 0 && previewBytes < originalSize;

  logger.debug(
    {
      bucket: params.bucket,
      key: params.key,
      content_type: contentType,
      original_size: originalSize,
      preview_bytes: previewBytes,
      truncated
    },
    'save-text request received'
  );

  const editReader = request.body.getReader();
  const editChunks: Uint8Array[] = [];
  let totalEditBytes = 0;
  while (true) {
    const { done, value } = await editReader.read();
    if (done) break;
    editChunks.push(value);
    totalEditBytes += value.length;
    if (totalEditBytes > maxEditableFileSize) {
      editReader.cancel();
      throw error(413, 'File exceeds the maximum editable size and is read-only');
    }
  }

  let mergedBuffer: Buffer;
  let totalLength: number;

  if (truncated) {
    const tailStream = await provider.getObjectRange(params.key, previewBytes, originalSize - 1);
    const tailReader = tailStream.getReader();
    const tailChunks: Uint8Array[] = [];
    let totalTailBytes = 0;
    while (true) {
      const { done, value } = await tailReader.read();
      if (done) break;
      tailChunks.push(value);
      totalTailBytes += value.length;
    }

    const merged = new Uint8Array(totalEditBytes + totalTailBytes);
    let offset = 0;
    for (const chunk of editChunks) {
      merged.set(chunk, offset);
      offset += chunk.length;
    }
    for (const chunk of tailChunks) {
      merged.set(chunk, offset);
      offset += chunk.length;
    }

    mergedBuffer = Buffer.from(merged.buffer);
    totalLength = merged.length;

    logger.info(
      {
        bucket: params.bucket,
        key: params.key,
        edit_bytes: totalEditBytes,
        tail_bytes: totalTailBytes,
        total_bytes: totalLength
      },
      'saving truncated file with tail merge'
    );
  } else {
    const merged = new Uint8Array(totalEditBytes);
    let offset = 0;
    for (const chunk of editChunks) {
      merged.set(chunk, offset);
      offset += chunk.length;
    }
    mergedBuffer = Buffer.from(merged.buffer);
    totalLength = totalEditBytes;
  }

  await provider.putObject(params.key, mergedBuffer, contentType, totalLength);

  logger.info({ bucket: params.bucket, key: params.key }, 'save-text completed');

  return new Response(null, { status: 200 });
}

async function handleDirectoryMetadata(
  provider: StorageProvider,
  params: StorageParams,
  logger: App.Locals['logger']
) {
  if (!params.prefix) throw error(400, 'Missing required parameter: prefix');

  logger.debug({ bucket: params.bucket, prefix: params.prefix }, 'fetching directory metadata');

  const acl = await provider.getBucketAcl();
  const result: DirectoryMetadata = {
    bucketOwner: acl.owner,
    bucketGrants: acl.grants,
    markerExists: false
  };

  try {
    const meta = await provider.getMetadata(params.prefix);
    result.markerExists = true;
    result.markerLastModified = meta.lastModified.toISOString();
    result.markerContentType = meta.contentType;
    result.markerETag = meta.etag;
    result.markerContentLength = meta.size;
    result.markerVersionId = meta.versionId;
    result.markerStorageClass = meta.storageClass;
    result.markerIsDeleteMarker = meta.isDeleteMarker;
    result.markerCustomMetadata = meta.customMetadata;
  } catch {
    // No directory marker object — that's fine
  }

  return Response.json(result);
}

// ─── HTTP Method Dispatch ────────────────────────────────────────────────────
//
// Priority order for GET:
//   1. params.prefix + metadata=true query param → directory-metadata
//   2. params.key without params.prefix → details
//   3. params.prefix or params.continuationToken → list objects
//   4. otherwise → check-bucket
//
// Priority order for POST:
//   1. params.originalSize (from query) → save-text (body is raw text)
//   2. body.newKey (from JSON body) → rename
//   3. otherwise → create

export const GET: RequestHandler = async (event) => {
  const { provider, params } = await withStorage(event);
  const metadataParam = event.url.searchParams.get('metadata') === 'true';

  if (params.prefix && metadataParam) {
    return handleDirectoryMetadata(provider, params, event.locals.logger);
  }
  if (params.key && !params.prefix) {
    return handleDetails(provider, params, event.locals.logger);
  }
  if (params.prefix != null || params.continuationToken) {
    return handleList(provider, params, event.locals.logger);
  }
  return handleCheckBucket(provider, params, event.locals.logger);
};

export const POST: RequestHandler = async (event) => {
  const { provider, params } = await withStorage(event);

  if (params.originalSize != null) {
    return handleSaveText(provider, params, event.locals.logger, event.request);
  }

  const body = (await event.request.json()) as { key?: string; newKey?: string };

  if (body.newKey) {
    params.newKey = body.newKey;
    params.key = body.key || params.key;
    return handleRename(provider, params, event.locals.logger);
  }

  return handleCreate(provider, params, event.locals.logger);
};

export const DELETE: RequestHandler = async (event) => {
  const { provider, params } = await withStorage(event);
  return handleDelete(provider, params, event.locals.logger);
};

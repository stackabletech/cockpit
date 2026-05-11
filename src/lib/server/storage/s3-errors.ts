import { S3ServiceException } from '@aws-sdk/client-s3';
import { error } from '@sveltejs/kit';
import { logger } from '$lib/server/logging';

const log = logger.child({ module: 's3-errors' });

type Context = { bucket?: string; key?: string; operation?: string };

function isS3ServiceException(err: unknown): err is S3ServiceException {
  return err instanceof S3ServiceException;
}

function getHttpStatus(err: unknown): number | undefined {
  return (err as any)?.$metadata?.httpStatusCode;
}

function isAccessDenied(code: string, httpStatus?: number): boolean {
  return code === 'AccessDenied' || httpStatus === 403;
}

function isNotFound(code: string, httpStatus?: number): boolean {
  return code === 'NoSuchKey' || code === 'NoSuchBucket' || httpStatus === 404;
}

function notFoundMessage(context: Context): string {
  if (context.key) return `Object "${context.key}" not found`;
  if (context.bucket) return `Bucket "${context.bucket}" not found`;
  return 'Not found';
}

function accessDeniedMessage(context: Context): string {
  return context.key ? `Access denied to "${context.key}"` : 'Access denied';
}

export function mapS3ErrorToHttp(err: unknown, context: Context): never {
  if (!isS3ServiceException(err)) {
    throw err as any;
  }

  const code = err.name;
  const httpStatus = getHttpStatus(err);

  log.warn({ ...context, error_code: code }, 'S3 error');

  if (isAccessDenied(code, httpStatus)) {
    throw error(403, accessDeniedMessage(context));
  }

  if (isNotFound(code, httpStatus)) {
    throw error(404, notFoundMessage(context));
  }

  throw error(502, `Storage error: ${(err as Error).message}`);
}

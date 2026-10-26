import { error, isHttpError } from '@sveltejs/kit';
import { logger } from '$lib/server/logging';

const log = logger.child({ module: 'hdfs-errors' });

/** Body of a failed WebHDFS/HttpFS response. */
interface RemoteExceptionBody {
  RemoteException?: { exception?: string; javaClassName?: string; message?: string };
}

/** Extract the Java exception name and message from a failed WebHDFS response body. */
export function parseRemoteException(body: string): { exception?: string; message?: string } {
  try {
    const parsed = JSON.parse(body) as RemoteExceptionBody;
    return {
      exception: parsed.RemoteException?.exception,
      message: parsed.RemoteException?.message
    };
  } catch {
    return {};
  }
}

/**
 * Map a failed WebHDFS response to a SvelteKit HTTP error. Not-found, access
 * and conflict errors keep their meaning; everything else becomes 502.
 */
export function hdfsHttpError(
  status: number,
  body: string,
  context: { op: string; path: string }
): never {
  const { exception, message } = parseRemoteException(body);
  // DataNodes append the Java stack trace to the message; never send it to clients.
  const detail =
    message?.split('\n')[0].trim() || `HDFS ${context.op} failed with status ${status}`;
  log.debug({ op: context.op, path: context.path, status_code: status, exception }, detail);

  // Exception names first: WebHDFS reports e.g. FileAlreadyExistsException as 403.
  if (exception === 'FileNotFoundException') throw error(404, detail);
  if (exception === 'FileAlreadyExistsException') throw error(409, detail);
  if (exception === 'AccessControlException' || exception === 'SecurityException') {
    throw error(403, detail);
  }
  if (status === 404) throw error(404, detail);
  if (status === 401 || status === 403) throw error(403, detail);
  throw error(502, detail);
}

export function isNotFound(err: unknown): boolean {
  return isHttpError(err) && err.status === 404;
}

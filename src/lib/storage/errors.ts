import * as m from '$lib/paraglide/messages.js';

// ── StorageError (unified error hierarchy) ───────────────────────────────────

export type StorageErrorCode =
  | 'not_connected'
  | 'access_denied'
  | 'not_found'
  | 'conflict'
  | 'server_error'
  | 'no_such_bucket'
  | 'invalid_part'
  | 'file_too_large'
  | 'too_many_results'
  | 'unknown';

export class StorageError extends Error {
  constructor(
    public readonly code: string,
    message: string
  ) {
    super(message);
    this.name = 'StorageError';
  }
}

// ── Error message mapping ────────────────────────────────────────────────────

export function getActionErrorMessage(err: StorageError): string {
  switch (err.code) {
    case 'not_connected':
      return m.storage_download_error_not_connected();
    case 'access_denied':
      return m.storage_download_error_access_denied();
    case 'not_found':
      return m.storage_download_error_not_found();
    case 'server_error':
      return m.storage_download_error_server_error();
    case 'no_such_bucket':
      return m.storage_upload_error_no_such_bucket();
    case 'invalid_part':
      return m.storage_upload_error_invalid_part();
    default:
      return m.storage_download_error_unknown();
  }
}

export function getActionErrorMessageForCode(code: string): string {
  return getActionErrorMessage(new StorageError(code, ''));
}

/** Translated message for a failed details request; `fallback` covers all other failures. */
export function getDetailsErrorMessage(err: unknown, fallback: string): string {
  if (!(err instanceof StorageError)) return fallback;
  switch (err.code) {
    case 'not_connected':
      return m.storage_details_error_not_connected();
    case 'access_denied':
      return m.storage_details_error_access_denied();
    case 'not_found':
      return m.storage_details_error_not_found();
    default:
      return fallback;
  }
}

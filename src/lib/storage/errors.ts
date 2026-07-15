import * as m from '$lib/paraglide/messages.js';

// ── StorageError (unified error hierarchy) ───────────────────────────────────

export type StorageErrorCode =
  | 'not_connected'
  | 'access_denied'
  | 'not_found'
  | 'server_error'
  | 'no_such_bucket'
  | 'invalid_part'
  | 'unknown';

export type ActionErrorCode = StorageErrorCode;

export class StorageError extends Error {
  constructor(
    public readonly code: string,
    message: string
  ) {
    super(message);
    this.name = 'StorageError';
  }
}

// ── ActionError (backward-compatible alias) ──────────────────────────────────

export class ActionError extends StorageError {
  constructor(code: string, message: string) {
    super(code, message);
    this.name = 'ActionError';
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

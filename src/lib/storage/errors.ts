import * as m from '$lib/paraglide/messages.js';

// ── ActionError ──────────────────────────────────────────────────────────────

export class ActionError extends Error {
  constructor(
    public readonly code: string,
    message: string
  ) {
    super(message);
    this.name = 'ActionError';
  }
}

// ── Error message mapping ────────────────────────────────────────────────────

export function getActionErrorMessage(err: ActionError): string {
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
  return getActionErrorMessage(new ActionError(code, ''));
}

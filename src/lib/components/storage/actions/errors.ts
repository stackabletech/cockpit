import * as m from '$lib/paraglide/messages.js';
import type { ActionError } from './types.js';

/** Map an ActionError to a localised user-facing string. */
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

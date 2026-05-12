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
    default:
      return m.storage_download_error_unknown();
  }
}

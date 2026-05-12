import type { ActionContext, ActionResult } from './types';
import { ActionError } from './types';
import { downloadObject as clientDownload, DownloadError } from '$lib/storage/download.js';

export default async function downloadAction(ctx: ActionContext): Promise<ActionResult> {
  const key = ctx.key ?? ctx.selectedFiles?.[0]?.key;
  if (!key) throw new ActionError('no_key', 'No key specified for download');

  try {
    await clientDownload(ctx.bucket, key);
    return { success: true };
  } catch (err: unknown) {
    if (err instanceof DownloadError) {
      // map DownloadError to ActionError so callers only need to handle ActionError
      throw new ActionError(err.code, err.message);
    }
    throw err;
  }
}

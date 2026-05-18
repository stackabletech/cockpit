import type { ActionContext, ActionResult } from './types';
import { ActionError } from './types';
import { deleteObjects as clientDelete, DeleteError } from '$lib/storage/delete.js';

export default async function (ctx: ActionContext): Promise<ActionResult> {
  const keys = ctx.selectedKeys ?? (ctx.key ? [ctx.key] : []);
  if (!keys.length) throw new ActionError('no_key', 'No keys specified for deletion');

  try {
    const result = await clientDelete(ctx.bucket, keys);
    return {
      success: true,
      failedKeys: result.failed.map((f) => ({ key: f.key, message: f.message }))
    };
  } catch (err: unknown) {
    if (err instanceof DeleteError) {
      throw new ActionError(err.code, err.message);
    }
    throw err;
  }
}

import type { ActionContext, ActionResult } from './types';
import { ActionError } from './types';

export default async function previewAction(ctx: ActionContext): Promise<ActionResult> {
  const key = ctx.key ?? ctx.selectedFiles?.[0]?.key;
  if (!key) throw new ActionError('no_key', 'No key specified for preview');
  return { previewKey: key };
}

import type { ActionContext, ActionResult, ActionName } from './types';
import download from './download';
import preview from './preview';
import deleteAction from './delete';

const actions: Record<ActionName, (ctx: ActionContext) => Promise<ActionResult>> = {
  download,
  upload: async () => ({ unimplemented: true }),
  preview,
  delete: deleteAction
};

export async function executeAction(name: ActionName, ctx: ActionContext): Promise<ActionResult> {
  const handler = actions[name];
  if (!handler) return { unimplemented: true };
  return await handler(ctx);
}

export { actions };

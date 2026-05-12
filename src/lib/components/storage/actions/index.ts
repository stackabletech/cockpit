import type { ActionContext, ActionResult, ActionName } from './types';
import download from './download';
import preview from './preview';

const actions: Record<ActionName, (ctx: ActionContext) => Promise<ActionResult>> = {
  download,
  upload: async () => ({ unimplemented: true }),
  preview,
  delete: async () => ({ unimplemented: true })
};

export async function executeAction(name: ActionName, ctx: ActionContext): Promise<ActionResult> {
  const handler = actions[name];
  if (!handler) return { unimplemented: true };
  return await handler(ctx);
}

export { actions };

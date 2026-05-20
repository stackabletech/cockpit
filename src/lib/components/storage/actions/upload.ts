import type { ActionContext, ActionResult } from './types';

// eslint-disable-next-line @typescript-eslint/no-unused-vars
export default async function uploadAction(_ctx: ActionContext): Promise<ActionResult> {
  // The upload workflow is driven by UploadModal, which is opened directly
  // by the StorageBreadcrumb toolbar button. This action handler returns
  // openUpload so callers wiring through executeAction can also trigger it.
  return { openUpload: true };
}

// Re-export upload utilities so UploadModal can import from a single location.
export { checkObjectExists, uploadFile, UploadError } from '$lib/storage/upload.js';
export type { UploadErrorCode } from '$lib/storage/upload.js';

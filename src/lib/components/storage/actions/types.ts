export type ActionResult = {
  success?: true;
  unimplemented?: true;
  previewKey?: string;
  openUpload?: true;
};

export type ActionName = 'download' | 'upload' | 'preview' | 'delete';

export class ActionError extends Error {
  constructor(
    public readonly code: string,
    message: string
  ) {
    super(message);
    this.name = 'ActionError';
  }
}

export type ActionContext = {
  bucket: string;
  key?: string;
  selectedKeys?: string[];
  selectedFiles?: Array<{ key: string }>;
};

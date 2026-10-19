import { page, userEvent } from 'vitest/browser';
import { describe, expect, it, vi, beforeEach, afterEach } from 'vitest';
import { render, cleanup } from 'vitest-browser-svelte';
import PreviewModal from './PreviewModal.svelte';

// Replace Monaco with an editable textarea so saving can be exercised.
vi.mock('$lib/components/editor/TextEditor.svelte', async () => ({
  default: (await import('../../../../test/TextEditorStub.svelte')).default
}));

vi.mock('$app/paths', () => ({ resolve: (path: string) => path }));

const { previewMock, saveTextMock } = vi.hoisted(() => ({
  previewMock: vi.fn(),
  saveTextMock: vi.fn()
}));

vi.mock('$lib/storage/context.js', () => ({
  getStorageState: () => ({
    api: { preview: previewMock, archiveExtract: vi.fn(), saveText: saveTextMock },
    bucket: 'test-bucket'
  })
}));

const props = { open: true, bucket: 'b', objectKey: 'notes.txt' };

function previewResponse(bytes: Uint8Array<ArrayBuffer>, etag: string): Response {
  return new Response(new Blob([bytes]), {
    status: 200,
    headers: {
      'Content-Type': 'text/plain',
      'X-Preview-Format': 'text',
      'X-Preview-Truncated': 'false',
      'X-Preview-Total-Size': String(bytes.length),
      'X-Preview-Bytes': String(bytes.length),
      'X-Preview-ETag': etag
    }
  });
}

const editor = () => page.getByRole('textbox', { name: 'Text editor' });
const saveButton = () => page.getByRole('button', { name: 'Save', exact: true });

describe('PreviewModal saving', () => {
  beforeEach(() => {
    const withBom = new Uint8Array([0xef, 0xbb, 0xbf, ...new TextEncoder().encode('hello')]);
    previewMock.mockResolvedValue(previewResponse(withBom, '"e1"'));
  });

  afterEach(() => {
    cleanup();
    vi.clearAllMocks();
  });

  it('sends the loaded ETag, restores the BOM and uses the new ETag next time', async () => {
    saveTextMock.mockResolvedValueOnce({ etag: '"e2"' }).mockResolvedValueOnce({ etag: '"e3"' });
    render(PreviewModal, props);

    await expect.element(editor()).toHaveValue('hello');
    await editor().fill('hello!');
    await saveButton().click();

    await vi.waitFor(() => expect(saveTextMock).toHaveBeenCalledTimes(1));
    expect(saveTextMock).toHaveBeenLastCalledWith({
      bucket: 'b',
      key: 'notes.txt',
      body: '﻿hello!',
      etag: '"e1"',
      contentType: 'text/plain'
    });
    await expect.element(saveButton()).toBeDisabled();

    await editor().fill('hello!!');
    await saveButton().click();

    await vi.waitFor(() => expect(saveTextMock).toHaveBeenCalledTimes(2));
    expect(saveTextMock).toHaveBeenLastCalledWith(
      expect.objectContaining({ body: '﻿hello!!', etag: '"e2"' })
    );
  });

  it('ignores a second save while one is in flight', async () => {
    let finish!: (value: { etag: string }) => void;
    saveTextMock.mockReturnValueOnce(new Promise((resolve) => (finish = resolve)));
    render(PreviewModal, props);

    await expect.element(editor()).toHaveValue('hello');
    await editor().fill('hello!');
    await editor().click();
    await userEvent.keyboard('{Control>}s{/Control}');
    await userEvent.keyboard('{Control>}s{/Control}');

    await vi.waitFor(() => expect(saveTextMock).toHaveBeenCalledTimes(1));
    finish({ etag: '"e2"' });
    await expect.element(saveButton()).toBeDisabled();
    expect(saveTextMock).toHaveBeenCalledTimes(1);
  });
});

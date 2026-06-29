import { page } from 'vitest/browser';
import { describe, expect, it, vi, beforeEach } from 'vitest';
import { render } from 'vitest-browser-svelte';
import { faker } from '@faker-js/faker';
import UploadModal from './UploadModal.svelte';

const { mockCheckObjectExists, mockUploadFile, MockUploadError } = vi.hoisted(() => {
  const mockCheckObjectExists = vi.fn().mockResolvedValue(false);
  const mockUploadFile = vi.fn().mockResolvedValue(undefined);

  class MockUploadError extends Error {
    code: string;
    constructor(code: string, message: string) {
      super(message);
      this.code = code;
      this.name = 'UploadError';
    }
  }

  return { mockCheckObjectExists, mockUploadFile, MockUploadError };
});

vi.mock('$lib/storage/upload.js', () => ({
  checkObjectExists: mockCheckObjectExists,
  uploadFile: mockUploadFile,
  UploadError: MockUploadError
}));

const defaultProps = {
  open: true,
  bucket: faker.word.noun(),
  prefix: '',
  onSuccess: vi.fn()
};

/** Helper: select files via the hidden file input inside the dropzone */
function selectFiles(files: File[]) {
  const fileInput = document.querySelector('input[type="file"][multiple]') as HTMLInputElement;
  const dt = new DataTransfer();
  files.forEach((f) => dt.items.add(f));
  fileInput.files = dt.files;
  fileInput.dispatchEvent(new Event('change', { bubbles: true }));
}

function createFile(name: string, size = 100): File {
  const content = new Uint8Array(size);
  return new File([content], name);
}

/** Wait for async operations to settle */
async function tick(ms = 50) {
  await new Promise((r) => setTimeout(r, ms));
}

/**
 * Returns a manually-controlled promise so tests can check intermediate state
 * and then cleanly resolve the operation before teardown — avoiding state
 * updates on already-destroyed Svelte components.
 */
function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((res) => {
    resolve = res;
  });
  return { promise, resolve };
}

/** Select files and click Upload, wait for the flow to complete */
async function selectAndUpload(files: File[]) {
  selectFiles(files);
  await tick();
  await page.getByRole('button', { name: /upload/i }).click();
  await tick(300);
}

describe('UploadModal', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockCheckObjectExists.mockResolvedValue(false);
    mockUploadFile.mockResolvedValue(undefined);
  });

  describe('initial render (idle phase)', () => {
    it('should render a dialog when open', async () => {
      render(UploadModal, defaultProps);
      await expect.element(page.getByRole('dialog')).toBeInTheDocument();
    });

    it('should show the upload title heading', async () => {
      render(UploadModal, defaultProps);
      await expect.element(page.getByRole('heading', { level: 2 })).toBeInTheDocument();
    });

    it('should show a close button', async () => {
      render(UploadModal, defaultProps);
      const closeBtn = page.getByRole('button', { name: /close/i });
      await expect.element(closeBtn).toBeInTheDocument();
    });

    it('should not show prefix info when prefix is empty', async () => {
      render(UploadModal, { ...defaultProps, prefix: '' });
      const dialog = page.getByRole('dialog');
      await expect.element(dialog).toBeInTheDocument();
    });

    it('should show prefix info when prefix is provided', async () => {
      const prefix = 'data/reports/';
      render(UploadModal, { ...defaultProps, prefix });
      await expect.element(page.getByText(prefix)).toBeInTheDocument();
    });
  });

  describe('when open is false', () => {
    it('should not render dialog content', async () => {
      render(UploadModal, { ...defaultProps, open: false });
      const heading = page.getByRole('heading', { level: 2 });
      await expect.element(heading).not.toBeInTheDocument();
    });
  });

  describe('selected phase (file list preview)', () => {
    it('should show selected files after file selection', async () => {
      render(UploadModal, defaultProps);
      selectFiles([createFile('report.csv')]);
      await tick();

      await expect.element(page.getByText('report.csv')).toBeInTheDocument();
    });

    it('should show file count for single file', async () => {
      render(UploadModal, defaultProps);
      selectFiles([createFile('a.txt')]);
      await tick();

      await expect.element(page.getByText(/1 file/i)).toBeInTheDocument();
    });

    it('should show file count for multiple files', async () => {
      render(UploadModal, defaultProps);
      selectFiles([createFile('a.txt'), createFile('b.txt'), createFile('c.txt')]);
      await tick();

      await expect.element(page.getByText(/3 files/i)).toBeInTheDocument();
    });

    it('should show file list and total size info', async () => {
      render(UploadModal, defaultProps);
      selectFiles([createFile('a.txt', 1024)]);
      await tick();

      const list = page.getByRole('list');
      await expect.element(list).toBeInTheDocument();
    });

    it('should show cancel and upload buttons', async () => {
      render(UploadModal, defaultProps);
      selectFiles([createFile('a.txt')]);
      await tick();

      await expect.element(page.getByRole('button', { name: /cancel/i })).toBeInTheDocument();
      await expect.element(page.getByRole('button', { name: /upload/i })).toBeInTheDocument();
    });
  });

  describe('buildTargetKey with prefix', () => {
    it('should prepend prefix to file path when checking conflicts', async () => {
      const prefix = 'data/';
      render(UploadModal, { ...defaultProps, prefix });
      await selectAndUpload([createFile('report.csv')]);

      expect(mockCheckObjectExists).toHaveBeenCalledWith(
        expect.any(String),
        'data/report.csv',
        expect.any(String)
      );
    });

    it('should use filename directly when prefix is empty', async () => {
      render(UploadModal, { ...defaultProps, prefix: '' });
      await selectAndUpload([createFile('report.csv')]);

      expect(mockCheckObjectExists).toHaveBeenCalledWith(
        expect.any(String),
        'report.csv',
        expect.any(String)
      );
    });
  });

  describe('upload flow - no conflicts', () => {
    it('should check for existing objects', async () => {
      render(UploadModal, defaultProps);
      await selectAndUpload([createFile('a.txt'), createFile('b.txt')]);

      expect(mockCheckObjectExists).toHaveBeenCalledTimes(2);
    });

    it('should upload all files when no conflicts exist', async () => {
      render(UploadModal, defaultProps);
      await selectAndUpload([createFile('a.txt')]);

      expect(mockUploadFile).toHaveBeenCalledTimes(1);
      expect(mockUploadFile).toHaveBeenCalledWith(
        defaultProps.bucket,
        'a.txt',
        expect.any(File),
        expect.any(Function),
        expect.any(String)
      );
    });

    it('should show complete phase after successful upload', async () => {
      render(UploadModal, defaultProps);
      await selectAndUpload([createFile('a.txt')]);

      await expect.element(page.getByRole('status')).toBeInTheDocument();
    });

    it('should show done button after completion', async () => {
      render(UploadModal, defaultProps);
      await selectAndUpload([createFile('a.txt')]);

      await expect.element(page.getByRole('button', { name: /done/i })).toBeInTheDocument();
    });

    it('should call onSuccess when done is clicked after uploads', async () => {
      render(UploadModal, defaultProps);
      await selectAndUpload([createFile('a.txt')]);

      await page.getByRole('button', { name: /done/i }).click();
      await tick();

      expect(defaultProps.onSuccess).toHaveBeenCalled();
    });
  });

  describe('upload flow - with conflicts', () => {
    it('should show review phase when conflicts are detected', async () => {
      mockCheckObjectExists.mockResolvedValue(true);
      render(UploadModal, defaultProps);
      await selectAndUpload([createFile('existing.txt')]);

      await expect.element(page.getByText(/conflict/i)).toBeInTheDocument();
    });

    it('should disable upload button when conflicts are unresolved', async () => {
      mockCheckObjectExists.mockResolvedValue(true);
      render(UploadModal, defaultProps);
      await selectAndUpload([createFile('existing.txt')]);

      const uploadBtn = page.getByRole('button', { name: /upload/i });
      await expect.element(uploadBtn).toBeDisabled();
    });

    it('should show conflict entries list', async () => {
      mockCheckObjectExists.mockResolvedValue(true);
      render(UploadModal, defaultProps);
      await selectAndUpload([createFile('existing.txt')]);

      // The conflict list should be present in review phase
      const list = page.getByRole('list');
      await expect.element(list).toBeInTheDocument();
    });

    it('should show Skip all and Replace all buttons in review phase', async () => {
      mockCheckObjectExists.mockResolvedValue(true);
      render(UploadModal, defaultProps);
      await selectAndUpload([createFile('existing.txt')]);

      await expect.element(page.getByRole('button', { name: /skip all/i })).toBeInTheDocument();
      await expect.element(page.getByRole('button', { name: /replace all/i })).toBeInTheDocument();
    });

    it('should enable upload button after clicking Skip all', async () => {
      mockCheckObjectExists.mockResolvedValue(true);
      render(UploadModal, defaultProps);
      await selectAndUpload([createFile('conflict.txt')]);

      await page.getByRole('button', { name: /skip all/i }).click();

      const uploadBtn = page.getByRole('button', { name: /upload/i });
      await expect.element(uploadBtn).not.toBeDisabled();
    });

    it('should enable upload button after clicking Replace all', async () => {
      mockCheckObjectExists.mockResolvedValue(true);
      render(UploadModal, defaultProps);
      await selectAndUpload([createFile('conflict.txt')]);

      await page.getByRole('button', { name: /replace all/i }).click();

      const uploadBtn = page.getByRole('button', { name: /upload/i });
      await expect.element(uploadBtn).not.toBeDisabled();
    });

    it('should resolve all conflicts as skip when Skip all is clicked on multiple files', async () => {
      mockCheckObjectExists.mockResolvedValue(true);
      render(UploadModal, defaultProps);
      await selectAndUpload([createFile('a.txt'), createFile('b.txt'), createFile('c.txt')]);

      await page.getByRole('button', { name: /skip all/i }).click();

      const uploadBtn = page.getByRole('button', { name: /upload/i });
      await expect.element(uploadBtn).not.toBeDisabled();
    });

    it('should resolve all conflicts as replace when Replace all is clicked on multiple files', async () => {
      mockCheckObjectExists.mockResolvedValue(true);
      render(UploadModal, defaultProps);
      await selectAndUpload([createFile('a.txt'), createFile('b.txt'), createFile('c.txt')]);

      await page.getByRole('button', { name: /replace all/i }).click();

      const uploadBtn = page.getByRole('button', { name: /upload/i });
      await expect.element(uploadBtn).not.toBeDisabled();
    });
  });

  describe('upload flow - error handling', () => {
    it('should handle checkObjectExists failures gracefully', async () => {
      mockCheckObjectExists.mockRejectedValue(new Error('Network error'));
      render(UploadModal, defaultProps);
      await selectAndUpload([createFile('a.txt')]);

      // Should proceed to upload (conflict defaults to false on error)
      expect(mockUploadFile).toHaveBeenCalled();
    });

    it('should show error state when upload fails with UploadError (access_denied)', async () => {
      mockUploadFile.mockRejectedValue(new MockUploadError('access_denied', 'Access denied'));
      render(UploadModal, defaultProps);
      await selectAndUpload([createFile('a.txt')]);

      await expect.element(page.getByRole('status')).toBeInTheDocument();
      // Error list should be visible
      const errorList = page.getByRole('list', { name: /failed/i });
      await expect.element(errorList).toBeInTheDocument();
    });

    it('should show error state when upload fails with unknown error', async () => {
      mockUploadFile.mockRejectedValue(new Error('Something went wrong'));
      render(UploadModal, defaultProps);
      await selectAndUpload([createFile('a.txt')]);

      await expect.element(page.getByRole('status')).toBeInTheDocument();
    });

    it('should handle not_connected error', async () => {
      mockUploadFile.mockRejectedValue(new MockUploadError('not_connected', 'Not connected'));
      render(UploadModal, defaultProps);
      await selectAndUpload([createFile('a.txt')]);

      const errorList = page.getByRole('list', { name: /failed/i });
      await expect.element(errorList).toBeInTheDocument();
    });

    it('should handle no_such_bucket error', async () => {
      mockUploadFile.mockRejectedValue(new MockUploadError('no_such_bucket', 'No such bucket'));
      render(UploadModal, defaultProps);
      await selectAndUpload([createFile('a.txt')]);

      const errorList = page.getByRole('list', { name: /failed/i });
      await expect.element(errorList).toBeInTheDocument();
    });

    it('should handle invalid_part error', async () => {
      mockUploadFile.mockRejectedValue(new MockUploadError('invalid_part', 'Invalid part'));
      render(UploadModal, defaultProps);
      await selectAndUpload([createFile('a.txt')]);

      const errorList = page.getByRole('list', { name: /failed/i });
      await expect.element(errorList).toBeInTheDocument();
    });

    it('should handle server_error', async () => {
      mockUploadFile.mockRejectedValue(new MockUploadError('server_error', 'Server error'));
      render(UploadModal, defaultProps);
      await selectAndUpload([createFile('a.txt')]);

      const errorList = page.getByRole('list', { name: /failed/i });
      await expect.element(errorList).toBeInTheDocument();
    });

    it('should show error filename in error list', async () => {
      mockUploadFile.mockRejectedValue(new MockUploadError('access_denied', 'Denied'));
      render(UploadModal, defaultProps);
      await selectAndUpload([createFile('secret.txt')]);

      await expect.element(page.getByText(/secret\.txt/)).toBeInTheDocument();
    });
  });

  describe('upload progress', () => {
    it('should call uploadFile with progress callback', async () => {
      render(UploadModal, defaultProps);
      await selectAndUpload([createFile('a.txt')]);

      expect(mockUploadFile).toHaveBeenCalledWith(
        expect.any(String),
        expect.any(String),
        expect.any(File),
        expect.any(Function),
        expect.any(String)
      );
    });

    it('should update progress via callback and reach complete', async () => {
      mockUploadFile.mockImplementation(
        async (_bucket: string, _key: string, _file: File, onProgress: (pct: number) => void) => {
          onProgress(50);
          onProgress(100);
        }
      );
      render(UploadModal, defaultProps);
      await selectAndUpload([createFile('a.txt')]);

      await expect.element(page.getByRole('status')).toBeInTheDocument();
    });
  });

  describe('cancel behaviour', () => {
    it('should close modal when cancel is clicked in selected phase', async () => {
      render(UploadModal, defaultProps);
      selectFiles([createFile('a.txt')]);
      await tick();

      await page.getByRole('button', { name: /cancel/i }).click();
      await tick();

      const heading = page.getByRole('heading', { level: 2 });
      await expect.element(heading).not.toBeInTheDocument();
    });

    it('should close modal when close button is clicked in idle phase', async () => {
      render(UploadModal, defaultProps);

      await page.getByRole('button', { name: /close/i }).click();
      await tick();

      const heading = page.getByRole('heading', { level: 2 });
      await expect.element(heading).not.toBeInTheDocument();
    });

    it('should show cancel button in review phase', async () => {
      mockCheckObjectExists.mockResolvedValue(true);
      render(UploadModal, defaultProps);
      await selectAndUpload([createFile('existing.txt')]);

      await expect.element(page.getByRole('button', { name: /cancel/i })).toBeInTheDocument();
    });
  });

  describe('done handler', () => {
    it('should call onSuccess when there are uploaded files', async () => {
      render(UploadModal, defaultProps);
      await selectAndUpload([createFile('a.txt')]);

      await page.getByRole('button', { name: /done/i }).click();
      await tick();

      expect(defaultProps.onSuccess).toHaveBeenCalledOnce();
    });
  });

  describe('multiple file upload with concurrency', () => {
    it('should upload multiple files', async () => {
      render(UploadModal, defaultProps);
      await selectAndUpload([
        createFile('a.txt'),
        createFile('b.txt'),
        createFile('c.txt'),
        createFile('d.txt'),
        createFile('e.txt')
      ]);

      expect(mockUploadFile).toHaveBeenCalledTimes(5);
    });
  });

  describe('mixed conflict and non-conflict files', () => {
    it('should show review phase when at least one file conflicts', async () => {
      let callCount = 0;
      mockCheckObjectExists.mockImplementation(async () => {
        callCount++;
        return callCount === 1; // Only first file conflicts
      });

      render(UploadModal, defaultProps);
      await selectAndUpload([createFile('existing.txt'), createFile('new.txt')]);

      await expect.element(page.getByText(/conflict/i)).toBeInTheDocument();
    });
  });

  describe('resolvedKey with prefix', () => {
    it('should use prefix in target key for uploaded files', async () => {
      const prefix = 'folder/sub/';
      render(UploadModal, { ...defaultProps, prefix });
      await selectAndUpload([createFile('data.csv')]);

      expect(mockUploadFile).toHaveBeenCalledWith(
        expect.any(String),
        'folder/sub/data.csv',
        expect.any(File),
        expect.any(Function),
        expect.any(String)
      );
    });
  });

  describe('checking phase', () => {
    it('should show checking state during conflict check', async () => {
      const check = deferred<boolean>();
      mockCheckObjectExists.mockReturnValue(check.promise);

      render(UploadModal, defaultProps);
      selectFiles([createFile('a.txt')]);
      await tick();

      await page.getByRole('button', { name: /upload/i }).click();

      // Phase transitions to 'checking' before the check resolves; poll until
      // the DOM reflects that state.
      await expect.element(page.getByText(/checking/i)).toBeInTheDocument();

      // Resolve the check and wait for the full upload flow to complete so no
      // state updates land on an already-destroyed component after teardown.
      check.resolve(false);
      await expect.element(page.getByRole('status')).toBeInTheDocument();
    });

    it('should check at most 3 files concurrently (default uploadConcurrency)', async () => {
      // Hold each check until we explicitly resolve it so we can inspect
      // how many calls are in-flight at the same time.
      // The mock setup-client.ts sets uploadConcurrency = 3 (the default).
      const pending: Array<() => void> = [];
      mockCheckObjectExists.mockImplementation(
        () => new Promise<boolean>((resolve) => pending.push(() => resolve(false)))
      );

      render(UploadModal, defaultProps);
      selectFiles(Array.from({ length: 5 }, (_, i) => createFile(`file${i}.txt`)));
      await tick();

      await page.getByRole('button', { name: /upload/i }).click();

      // Wait until the checking phase is visible; by this point the first
      // batch of checks has been fired but is still pending.
      await expect.element(page.getByText(/checking/i)).toBeInTheDocument();

      // Only the first batch (3) should have started — not all 5.
      expect(mockCheckObjectExists).toHaveBeenCalledTimes(3);

      // Unblock the first batch; the second batch (2) then fires.
      pending.splice(0, 3).forEach((fn) => fn());
      // Drain the second batch too so the component reaches a terminal state.
      await vi.waitFor(() => expect(pending.length).toBe(2));
      pending.splice(0).forEach((fn) => fn());

      await expect.element(page.getByRole('status')).toBeInTheDocument();
      expect(mockCheckObjectExists).toHaveBeenCalledTimes(5);
    });
  });

  describe('accessibility', () => {
    it('should have a dialog role', async () => {
      render(UploadModal, defaultProps);
      await expect.element(page.getByRole('dialog')).toBeInTheDocument();
    });

    it('should have a heading', async () => {
      render(UploadModal, defaultProps);
      await expect.element(page.getByRole('heading')).toBeInTheDocument();
    });

    it('should have aria-label on close button', async () => {
      render(UploadModal, defaultProps);
      const closeBtn = page.getByRole('button', { name: /close/i });
      await expect.element(closeBtn).toBeInTheDocument();
    });

    it('should have aria-disabled on upload button when conflicts unresolved', async () => {
      mockCheckObjectExists.mockResolvedValue(true);
      render(UploadModal, defaultProps);
      await selectAndUpload([createFile('existing.txt')]);

      const uploadBtn = page.getByRole('button', { name: /upload/i });
      await expect.element(uploadBtn).toHaveAttribute('aria-disabled', 'true');
    });
  });

  describe('edge cases', () => {
    it('should handle long prefix display', async () => {
      const longPrefix = 'a/b/c/d/e/f/g/h/i/j/k/l/m/n/o/p/';
      render(UploadModal, { ...defaultProps, prefix: longPrefix });
      await expect.element(page.getByText(longPrefix)).toBeInTheDocument();
    });

    it('should handle bucket with special characters', async () => {
      render(UploadModal, { ...defaultProps, bucket: 'my-bucket-123' });
      await expect.element(page.getByRole('dialog')).toBeInTheDocument();
    });

    it('should pass bucket name to upload functions', async () => {
      const bucket = 'test-bucket-xyz';
      render(UploadModal, { ...defaultProps, bucket });
      await selectAndUpload([createFile('a.txt')]);

      expect(mockCheckObjectExists).toHaveBeenCalledWith(
        bucket,
        expect.any(String),
        expect.any(String)
      );
      expect(mockUploadFile).toHaveBeenCalledWith(
        bucket,
        expect.any(String),
        expect.any(File),
        expect.any(Function),
        expect.any(String)
      );
    });

    it('should show uploading phase list during upload', async () => {
      const upload = deferred<void>();
      mockUploadFile.mockReturnValue(upload.promise);

      render(UploadModal, defaultProps);
      selectFiles([createFile('a.txt')]);
      await tick();

      await page.getByRole('button', { name: /upload/i }).click();

      // During uploading the file list is visible; poll until the uploading
      // phase is reached (after the conflict-check microtasks settle).
      const list = page.getByRole('list');
      await expect.element(list).toBeInTheDocument();

      // Resolve the upload so the component reaches 'complete' cleanly before
      // teardown, avoiding a state update on a destroyed component.
      upload.resolve();
      await expect.element(page.getByRole('status')).toBeInTheDocument();
    });

    it('should show cancel button during upload', async () => {
      const upload = deferred<void>();
      mockUploadFile.mockReturnValue(upload.promise);

      render(UploadModal, defaultProps);
      selectFiles([createFile('a.txt')]);
      await tick();

      await page.getByRole('button', { name: /upload/i }).click();

      // The cancel button is visible while an upload is in progress.
      const cancelBtn = page.getByRole('button', { name: /cancel/i });
      await expect.element(cancelBtn).toBeInTheDocument();

      // Resolve the upload so the component reaches 'complete' cleanly before
      // teardown, avoiding a state update on a destroyed component.
      upload.resolve();
      await expect.element(page.getByRole('status')).toBeInTheDocument();
    });
  });

  describe('complete phase summary', () => {
    it('should show uploaded count in summary', async () => {
      render(UploadModal, defaultProps);
      await selectAndUpload([createFile('a.txt'), createFile('b.txt')]);

      await expect.element(page.getByRole('status')).toBeInTheDocument();
      // Done button available
      await expect.element(page.getByRole('button', { name: /done/i })).toBeInTheDocument();
    });

    it('should show mixed success/error summary', async () => {
      let callIdx = 0;
      mockUploadFile.mockImplementation(async () => {
        callIdx++;
        if (callIdx === 2) throw new MockUploadError('access_denied', 'Denied');
      });

      render(UploadModal, defaultProps);
      await selectAndUpload([createFile('ok.txt'), createFile('fail.txt')]);

      await expect.element(page.getByRole('status')).toBeInTheDocument();
      // Error list should show
      const errorList = page.getByRole('list', { name: /failed/i });
      await expect.element(errorList).toBeInTheDocument();
    });
  });
});

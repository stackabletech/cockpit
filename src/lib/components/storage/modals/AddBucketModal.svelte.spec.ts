import { page, userEvent } from 'vitest/browser';
import { describe, expect, it, vi, beforeEach } from 'vitest';
import { render } from 'vitest-browser-svelte';
import AddBucketModal from './AddBucketModal.svelte';

// Mock navigation
const mockGoto = vi.fn();
vi.mock('$app/navigation', () => ({
  goto: (...args: unknown[]) => mockGoto(...args)
}));

vi.mock('$app/paths', () => ({
  resolve: (_pattern: string, params: Record<string, string>) => `/storage/${params.bucket}`
}));

// Mock storage context
const mockAddBucket = vi.fn();
const mockCheckBucket = vi.fn();
const mockUpdateConnections = vi.fn();
vi.mock('$lib/storage/context.js', () => ({
  getStorageState: () => ({
    addBucket: mockAddBucket,
    api: {
      checkBucket: mockCheckBucket,
      updateConnections: mockUpdateConnections
    }
  })
}));

// Mock connection store
vi.mock('$lib/storage/connection-store.svelte.js', () => ({
  connectionStore: { activeConnectionId: 'mock-connection-id', connections: [] }
}));

// Mock storage errors
vi.mock('$lib/storage/errors.js', () => ({
  StorageError: class StorageError extends Error {
    code: string;
    constructor(code: string, message: string) {
      super(message);
      this.code = code;
      this.name = 'StorageError';
    }
  }
}));

// Mock paraglide messages
vi.mock('$lib/paraglide/messages.js', () => ({
  storage_add_bucket_title: () => 'Connect to a bucket',
  storage_add_bucket_subtitle: () => 'Enter the name of a bucket you have access to.',
  storage_add_bucket_name_label: () => 'Bucket name',
  storage_add_bucket_name_placeholder: () => 'my-bucket',
  storage_add_bucket_submit: () => 'Connect',
  storage_add_bucket_cancel: () => 'Cancel',
  storage_add_bucket_error_access_denied: () =>
    'Access denied — you do not have permission to read this bucket.',
  storage_add_bucket_error_not_found: () => 'Bucket not found — check the name and try again.',
  storage_add_bucket_error_unknown: () =>
    'Could not connect to this bucket — check the name and try again.'
}));

describe('AddBucketModal', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.stubGlobal('fetch', vi.fn());
  });

  describe('rendering', () => {
    it('should render the dialog when open', async () => {
      render(AddBucketModal, { open: true });

      await expect.element(page.getByRole('dialog')).toBeInTheDocument();
      await expect
        .element(page.getByRole('heading', { name: 'Connect to a bucket' }))
        .toBeInTheDocument();
      await expect
        .element(page.getByText('Enter the name of a bucket you have access to.'))
        .toBeInTheDocument();
    });

    it('should not render the dialog when closed', async () => {
      render(AddBucketModal, { open: false });

      await expect.element(page.getByRole('dialog')).not.toBeInTheDocument();
    });

    it('should render the bucket name input', async () => {
      render(AddBucketModal, { open: true });

      await expect.element(page.getByLabelText('Bucket name')).toBeInTheDocument();
      await expect.element(page.getByPlaceholder('my-bucket')).toBeInTheDocument();
    });

    it('should render Cancel and Connect buttons', async () => {
      render(AddBucketModal, { open: true });

      await expect.element(page.getByRole('button', { name: 'Cancel' })).toBeInTheDocument();
      await expect.element(page.getByRole('button', { name: 'Connect' })).toBeInTheDocument();
    });

    it('should have Connect button disabled when input is empty', async () => {
      render(AddBucketModal, { open: true });

      await expect.element(page.getByRole('button', { name: 'Connect' })).toBeDisabled();
    });

    it('should enable Connect button when input has a value', async () => {
      render(AddBucketModal, { open: true });

      await userEvent.type(page.getByLabelText('Bucket name'), 'my-bucket');

      await expect.element(page.getByRole('button', { name: 'Connect' })).not.toBeDisabled();
    });
  });

  describe('successful connection', () => {
    it('should call addBucket and navigate on ok response', async () => {
      mockCheckBucket.mockResolvedValue({ ok: true, status: 200 });
      mockUpdateConnections.mockResolvedValue(undefined);

      render(AddBucketModal, { open: true });

      await userEvent.type(page.getByLabelText('Bucket name'), 'my-bucket');
      await userEvent.click(page.getByRole('button', { name: 'Connect' }));

      await expect.poll(() => mockAddBucket).toHaveBeenCalledWith('my-bucket');
      await expect.poll(() => mockGoto).toHaveBeenCalledWith('/storage/my-bucket');
    });

    it('should pass the bucket name to checkBucket', async () => {
      mockCheckBucket.mockResolvedValue({ ok: true, status: 200 });
      mockUpdateConnections.mockResolvedValue(undefined);

      render(AddBucketModal, { open: true });

      await userEvent.type(page.getByLabelText('Bucket name'), 'my bucket');
      await userEvent.click(page.getByRole('button', { name: 'Connect' }));

      await expect.poll(() => mockCheckBucket).toHaveBeenCalledWith({ bucket: 'my bucket' });
    });
  });

  describe('error handling', () => {
    it('should show access denied error on 403', async () => {
      mockCheckBucket.mockResolvedValue({ ok: false, status: 403 });

      render(AddBucketModal, { open: true });

      await userEvent.type(page.getByLabelText('Bucket name'), 'locked-bucket');
      await userEvent.click(page.getByRole('button', { name: 'Connect' }));

      await expect
        .element(page.getByRole('alert'))
        .toHaveTextContent('Access denied — you do not have permission to read this bucket.');
    });

    it('should show not found error on 404', async () => {
      mockCheckBucket.mockResolvedValue({ ok: false, status: 404 });

      render(AddBucketModal, { open: true });

      await userEvent.type(page.getByLabelText('Bucket name'), 'missing-bucket');
      await userEvent.click(page.getByRole('button', { name: 'Connect' }));

      await expect
        .element(page.getByRole('alert'))
        .toHaveTextContent('Bucket not found — check the name and try again.');
    });

    it('should show generic error on 502', async () => {
      mockCheckBucket.mockResolvedValue({ ok: false, status: 502 });

      render(AddBucketModal, { open: true });

      await userEvent.type(page.getByLabelText('Bucket name'), 'bad-bucket');
      await userEvent.click(page.getByRole('button', { name: 'Connect' }));

      await expect
        .element(page.getByRole('alert'))
        .toHaveTextContent('Could not connect to this bucket — check the name and try again.');
    });

    it('should show generic error on network failure', async () => {
      mockCheckBucket.mockRejectedValue(new Error('Network error'));

      render(AddBucketModal, { open: true });

      await userEvent.type(page.getByLabelText('Bucket name'), 'unreachable-bucket');
      await userEvent.click(page.getByRole('button', { name: 'Connect' }));

      await expect
        .element(page.getByRole('alert'))
        .toHaveTextContent('Could not connect to this bucket — check the name and try again.');
    });

    it('should not navigate or add bucket on error', async () => {
      mockCheckBucket.mockResolvedValue({ ok: false, status: 403 });

      render(AddBucketModal, { open: true });

      await userEvent.type(page.getByLabelText('Bucket name'), 'locked-bucket');
      await userEvent.click(page.getByRole('button', { name: 'Connect' }));

      await expect.poll(() => page.getByRole('alert')).toBeInTheDocument();
      expect(mockAddBucket).not.toHaveBeenCalled();
      expect(mockGoto).not.toHaveBeenCalled();
    });

    it('should clear error when user types a new bucket name', async () => {
      mockCheckBucket
        .mockResolvedValueOnce({ ok: false, status: 404 })
        .mockResolvedValueOnce({ ok: true, status: 200 });
      mockUpdateConnections.mockResolvedValue(undefined);

      render(AddBucketModal, { open: true });

      await userEvent.type(page.getByLabelText('Bucket name'), 'missing');
      await userEvent.click(page.getByRole('button', { name: 'Connect' }));
      await expect.element(page.getByRole('alert')).toBeInTheDocument();

      await userEvent.clear(page.getByLabelText('Bucket name'));
      await userEvent.type(page.getByLabelText('Bucket name'), 'good-bucket');
      await userEvent.click(page.getByRole('button', { name: 'Connect' }));

      await expect.element(page.getByRole('alert')).not.toBeInTheDocument();
    });
  });

  describe('cancel', () => {
    it('should close the dialog when Cancel is clicked', async () => {
      render(AddBucketModal, { open: true });

      await expect.element(page.getByRole('dialog')).toBeInTheDocument();

      await userEvent.click(page.getByRole('button', { name: 'Cancel' }));

      await expect.element(page.getByRole('dialog')).not.toBeInTheDocument();
    });

    it('should reset the input when Cancel is clicked', async () => {
      render(AddBucketModal, { open: true });

      await userEvent.type(page.getByLabelText('Bucket name'), 'some-value');
      await userEvent.click(page.getByRole('button', { name: 'Cancel' }));

      // Re-open
      render(AddBucketModal, { open: true });
      await expect.element(page.getByLabelText('Bucket name')).toHaveValue('');
    });
  });
});

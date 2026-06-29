import { page } from 'vitest/browser';
import { describe, expect, it, vi, beforeEach } from 'vitest';
import { render } from 'vitest-browser-svelte';
import type { ComponentProps } from 'svelte';
import StorageConnectForm from './StorageConnectForm.svelte';
import type { ConnectionMetadata } from '$lib/server/storage/types.js';

type ConnectionFormProp = ComponentProps<typeof StorageConnectForm>['connectionForm'];

// Note: $app/navigation is not mocked; invalidateAll is a no-op in test environments.

// Mock paraglide messages with all keys used by the new component
vi.mock('$lib/paraglide/messages.js', () => ({
  storage_connect_title: () => 'Connect to Storage',
  storage_connect_subtitle: () => 'Enter your connection details',
  storage_connect_reconnecting: () => 'Reconnecting...',
  storage_connect_saved: () => 'Saved connections',
  storage_connect_no_saved: () => 'No saved connections yet',
  storage_connect_type: () => 'Backend type',
  storage_connect_type_s3: () => 'Amazon S3',
  storage_connect_type_hdfs: () => 'HDFS',
  storage_connect_endpoint: () => 'Endpoint URL',
  storage_connect_endpoint_placeholder: () => 'https://s3.example.com',
  storage_connect_endpoint_hint: () => 'Leave empty for AWS S3',
  storage_connect_path_style: () => 'Path-style addressing',
  storage_connect_path_style_hint: () => 'Use path-style URLs',
  storage_connect_region: () => 'Region',
  storage_connect_access_key: () => 'Access key ID',
  storage_connect_secret_key: () => 'Secret access key',
  storage_connect_submit: () => 'Connect',
  storage_connect_testing: () => 'Testing connection...',
  storage_connect_additional_buckets: () => 'Additional buckets',
  storage_connect_additional_buckets_hint: () => 'One per line',
  storage_connect_forget_cancel: () => 'Cancel',
  storage_connect_forget: () => 'Forget',
  storage_connect_forget_label: ({ endpoint }: { endpoint: string }) =>
    `Forget connection to ${endpoint}`,
  storage_connect_forget_confirm: ({ endpoint }: { endpoint: string }) =>
    `Remove ${endpoint} from saved connections?`,
  storage_connect_error_unreachable: () => 'Could not connect'
}));

function createMockForm(overrides: Record<string, unknown> = {}): ConnectionFormProp {
  return {
    valid: true,
    posted: false,
    errors: {},
    data: {
      name: '',
      type: 's3' as const,
      endpoint: '',
      pathStyle: true,
      region: 'eu-central-1',
      accessKeyId: '',
      secretAccessKey: '',
      additionalBuckets: ''
    },
    id: 'test-form',
    constraints: {},
    shape: {},
    message: undefined,
    tainted: undefined,
    ...overrides
  } as unknown as ConnectionFormProp;
}

function makeConnection(overrides: Partial<ConnectionMetadata> = {}): ConnectionMetadata {
  return {
    id: 'conn-1',
    name: 'My Connection',
    endpoint: 'https://example.com',
    ...overrides
  };
}

function renderForm(
  formOverrides: Record<string, unknown> = {},
  connections: ConnectionMetadata[] = [],
  connectError: string | null = null
) {
  return render(StorageConnectForm, {
    connectionForm: createMockForm(formOverrides),
    connections,
    connectError
  });
}

describe('StorageConnectForm', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('should render the form title and subtitle', async () => {
    renderForm();

    await expect.element(page.getByText('Connect to Storage')).toBeInTheDocument();
    await expect.element(page.getByText('Enter your connection details')).toBeInTheDocument();
  });

  it('should show "No saved connections" when the store is empty', async () => {
    renderForm();

    await expect.element(page.getByText('No saved connections yet')).toBeInTheDocument();
  });

  it('should show saved connections from the connection store', async () => {
    renderForm({}, [
      makeConnection({ id: 'conn-1', name: 'My MinIO', endpoint: 'https://minio.example.com' })
    ]);

    await expect.element(page.getByText('My MinIO')).toBeInTheDocument();
  });

  it('should show delete buttons for saved connections', async () => {
    renderForm({}, [
      makeConnection({ id: 'conn-1', name: 'Test S3', endpoint: 'https://s3.test.io' })
    ]);

    await expect
      .element(page.getByRole('button', { name: 'Forget connection to Test S3' }))
      .toBeInTheDocument();
  });

  it('should show forget confirmation dialog when forget button is clicked', async () => {
    renderForm({}, [
      makeConnection({ id: 'conn-1', name: 'Work S3', endpoint: 'https://s3.work.io' })
    ]);

    await page.getByRole('button', { name: 'Forget connection to Work S3' }).click();

    await expect
      .element(page.getByText('Remove Work S3 from saved connections?'))
      .toBeInTheDocument();
    await expect
      .element(page.getByRole('button', { name: 'Forget', exact: true }))
      .toBeInTheDocument();
    await expect.element(page.getByRole('button', { name: 'Cancel' })).toBeInTheDocument();
  });

  it('should close forget dialog when cancel is clicked', async () => {
    renderForm({}, [
      makeConnection({ id: 'conn-1', name: 'Cancel Test', endpoint: 'https://s3.cancel.io' })
    ]);

    await page.getByRole('button', { name: 'Forget connection to Cancel Test' }).click();
    await expect
      .element(page.getByText('Remove Cancel Test from saved connections?'))
      .toBeInTheDocument();

    await page.getByRole('button', { name: 'Cancel', exact: true }).click();
    await expect
      .element(page.getByText('Remove Cancel Test from saved connections?'))
      .not.toBeInTheDocument();
  });

  it('should render multiple saved connections', async () => {
    renderForm({}, [
      makeConnection({ id: 'conn-1', name: 'First', endpoint: 'https://first.example.com' }),
      makeConnection({ id: 'conn-2', name: 'Second', endpoint: 'https://second.example.com' })
    ]);

    // Use .first() to avoid strict-mode violation: the name appears in both the
    // <span> label and the containing <button> (which inherits its text content).
    await expect.element(page.getByText('First').first()).toBeInTheDocument();
    await expect.element(page.getByText('Second').first()).toBeInTheDocument();
  });

  it('should show connection name for null endpoint', async () => {
    renderForm({}, [makeConnection({ id: 'conn-1', name: 'AWS Connection', endpoint: null })]);

    await expect.element(page.getByText('AWS Connection')).toBeInTheDocument();
  });

  it('should render the connection form fields', async () => {
    renderForm();

    await expect.element(page.getByLabelText('Backend type')).toBeInTheDocument();
    await expect.element(page.getByLabelText('Endpoint URL')).toBeInTheDocument();
    await expect.element(page.getByLabelText('Region')).toBeInTheDocument();
    await expect.element(page.getByLabelText('Access key ID')).toBeInTheDocument();
    await expect.element(page.getByLabelText('Secret access key')).toBeInTheDocument();
  });

  it('should render the form with POST method to ?/connect', async () => {
    renderForm();

    const connectBtn = page.getByRole('button', { name: 'Connect' });
    await expect.element(connectBtn).toBeInTheDocument();
    const form = connectBtn.element().closest('form');
    expect(form?.getAttribute('method')).toBe('POST');
    expect(form?.getAttribute('action')).toContain('/connect');
  });

  it('should render endpoint field error when form has endpoint error', async () => {
    renderForm({ errors: { endpoint: ['Invalid URL'] } });

    await expect.element(page.getByText('Invalid URL')).toBeInTheDocument();
  });

  it('should render endpoint field with url input type', async () => {
    renderForm();

    await expect.element(page.getByLabelText('Endpoint URL')).toHaveAttribute('type', 'url');
  });

  it('should render secret key field with password input type', async () => {
    renderForm();

    await expect
      .element(page.getByLabelText('Secret access key'))
      .toHaveAttribute('type', 'password');
  });

  it('should render connections in a list role', async () => {
    renderForm({}, [
      makeConnection({ id: 'conn-1', name: 'Listed', endpoint: 'https://listed.example.com' })
    ]);

    await expect.element(page.getByRole('list', { name: 'Saved connections' })).toBeInTheDocument();
    await expect.element(page.getByRole('listitem')).toBeInTheDocument();
  });
});

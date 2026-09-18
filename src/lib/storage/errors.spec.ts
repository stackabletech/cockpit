import { describe, it, expect, vi } from 'vitest';
import {
  StorageError,
  ActionError,
  getActionErrorMessage,
  getActionErrorMessageForCode
} from './errors.js';

const mockMessages = vi.hoisted(() => ({
  storage_download_error_not_connected: () => 'No storage connection configured',
  storage_download_error_access_denied: () => 'Access denied',
  storage_download_error_not_found: () => 'File not found',
  storage_download_error_server_error: () => 'Server error',
  storage_upload_error_no_such_bucket: () => 'Bucket not found',
  storage_upload_error_invalid_part: () => 'Invalid part',
  storage_download_error_unknown: () => 'Unknown error'
}));

vi.mock('$lib/paraglide/messages.js', () => mockMessages);

describe('StorageError', () => {
  it('creates an error with code and message', () => {
    const err = new StorageError('not_found', 'File was not found');
    expect(err).toBeInstanceOf(Error);
    expect(err.name).toBe('StorageError');
    expect(err.code).toBe('not_found');
    expect(err.message).toBe('File was not found');
  });
});

describe('ActionError', () => {
  it('extends StorageError with ActionError name', () => {
    const err = new ActionError('access_denied', 'No access');
    expect(err).toBeInstanceOf(StorageError);
    expect(err).toBeInstanceOf(Error);
    expect(err.name).toBe('ActionError');
    expect(err.code).toBe('access_denied');
    expect(err.message).toBe('No access');
  });
});

describe('getActionErrorMessage', () => {
  it('maps not_connected code', () => {
    expect(getActionErrorMessage(new StorageError('not_connected', ''))).toBe(
      'No storage connection configured'
    );
  });

  it('maps access_denied code', () => {
    expect(getActionErrorMessage(new StorageError('access_denied', ''))).toBe('Access denied');
  });

  it('maps not_found code', () => {
    expect(getActionErrorMessage(new StorageError('not_found', ''))).toBe('File not found');
  });

  it('maps server_error code', () => {
    expect(getActionErrorMessage(new StorageError('server_error', ''))).toBe('Server error');
  });

  it('maps no_such_bucket code', () => {
    expect(getActionErrorMessage(new StorageError('no_such_bucket', ''))).toBe('Bucket not found');
  });

  it('maps invalid_part code', () => {
    expect(getActionErrorMessage(new StorageError('invalid_part', ''))).toBe('Invalid part');
  });

  it('maps unknown code to unknown error message', () => {
    expect(getActionErrorMessage(new StorageError('unknown', ''))).toBe('Unknown error');
  });

  it('maps any unrecognised code to unknown error message', () => {
    expect(getActionErrorMessage(new StorageError('some_weird_code', ''))).toBe('Unknown error');
  });
});

describe('getActionErrorMessageForCode', () => {
  it('forwards to getActionErrorMessage with a StorageError', () => {
    expect(getActionErrorMessageForCode('not_found')).toBe('File not found');
    expect(getActionErrorMessageForCode('unknown')).toBe('Unknown error');
  });
});

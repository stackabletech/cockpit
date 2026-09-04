vi.mock('$app/environment', () => ({ browser: true }));
vi.mock('$app/navigation', () => ({ invalidateAll: vi.fn() }));
vi.mock('$lib/stores/toast.svelte.js', () => ({ addToast: vi.fn() }));

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { ArchiveState } from './archive.svelte.js';
import { addToast } from '$lib/stores/toast.svelte.js';
import { invalidateAll } from '$app/navigation';
import type { Mock } from 'vitest';
import type { StorageApi } from './api.js';
import type { StoragePage } from './types.js';

// ── Helpers ─────────────────────────────────────────────────────────────────

function makeMockApi(): StorageApi {
  return {
    list: vi.fn(),
    copy: vi.fn(),
    move: vi.fn(),
    rename: vi.fn(),
    delete: vi.fn(),
    create: vi.fn(),
    archiveExtract: vi.fn(),
    archiveListing: vi.fn(),
    pollJob: vi.fn(),
    checkObjectExists: vi.fn(),
    preview: vi.fn(),
    saveText: vi.fn(),
    details: vi.fn(),
    directoryMetadata: vi.fn(),
    directorySize: vi.fn(),
    bucketDetails: vi.fn(),
    checkBucket: vi.fn(),
    updateConnections: vi.fn()
  } as unknown as StorageApi;
}

function makeArchive(apiOverrides?: Partial<StorageApi>): {
  archive: ArchiveState;
  callbacks: ReturnType<typeof makeCallbacks>;
  api: StorageApi;
} {
  const api = makeMockApi();
  Object.assign(api, apiOverrides ?? {});
  const callbacks = makeCallbacks();
  const archive = new ArchiveState(api, callbacks);
  return { archive, callbacks, api };
}

function makeCallbacks() {
  return {
    getBucket: vi.fn().mockReturnValue('test-bucket'),
    getPrefix: vi.fn().mockReturnValue('s3/prefix/'),
    getPageSize: vi.fn().mockReturnValue(25),
    setObjects: vi.fn(),
    setLoading: vi.fn(),
    setPrefix: vi.fn(),
    clearPrevTokens: vi.fn(),
    onExit: vi.fn()
  };
}

beforeEach(() => {
  vi.clearAllMocks();
});

// ─────────────────────────────────────────────────────────────────────────────
// Group 1: State basics
// ─────────────────────────────────────────────────────────────────────────────

describe('state basics', () => {
  it('isInArchive is false when archiveKey is null', () => {
    const { archive } = makeArchive();
    expect(archive.isInArchive).toBe(false);
  });

  it('isInArchive is true when archiveKey is set', () => {
    const { archive } = makeArchive();
    archive.archiveKey = 'test.zip';
    expect(archive.isInArchive).toBe(true);
  });

  it('isInArchive transitions correctly when archiveKey changes', () => {
    const { archive } = makeArchive();
    expect(archive.isInArchive).toBe(false);
    archive.archiveKey = 'test.zip';
    expect(archive.isInArchive).toBe(true);
    archive.archiveKey = null;
    expect(archive.isInArchive).toBe(false);
  });

  it('nestedArchivePath getter returns undefined when not set', () => {
    const { archive } = makeArchive();
    expect(archive.nestedArchivePath).toBeUndefined();
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// Group 2: isArchiveFile
// ─────────────────────────────────────────────────────────────────────────────

describe('isArchiveFile', () => {
  it('returns true for .zip files', () => {
    const { archive } = makeArchive();
    expect(archive.isArchiveFile('data.zip')).toBe(true);
  });

  it('returns true for .tar.gz files', () => {
    const { archive } = makeArchive();
    expect(archive.isArchiveFile('backup.tar.gz')).toBe(true);
  });

  it('returns true for .tgz files', () => {
    const { archive } = makeArchive();
    expect(archive.isArchiveFile('archive.tgz')).toBe(true);
  });

  it('returns true for .tar files', () => {
    const { archive } = makeArchive();
    expect(archive.isArchiveFile('data.tar')).toBe(true);
  });

  it('returns true for .rar files', () => {
    const { archive } = makeArchive();
    expect(archive.isArchiveFile('data.rar')).toBe(true);
  });

  it('returns true for .7z files', () => {
    const { archive } = makeArchive();
    expect(archive.isArchiveFile('archive.7z')).toBe(true);
  });

  it('is case-insensitive', () => {
    const { archive } = makeArchive();
    expect(archive.isArchiveFile('DATA.ZIP')).toBe(true);
    expect(archive.isArchiveFile('Archive.Tar.Gz')).toBe(true);
  });

  it('returns false for non-archive files', () => {
    const { archive } = makeArchive();
    expect(archive.isArchiveFile('readme.txt')).toBe(false);
    expect(archive.isArchiveFile('image.png')).toBe(false);
    expect(archive.isArchiveFile('script.js')).toBe(false);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// Group 3: enterArchive
// ─────────────────────────────────────────────────────────────────────────────

describe('enterArchive', () => {
  it('fetches listing and sets state on success', async () => {
    const { archive, callbacks, api } = makeArchive();
    (api.archiveListing as Mock).mockResolvedValue({
      entries: [
        { key: 'file.txt', size: 100, lastModified: new Date(), isDirectory: false },
        { key: 'subdir/', size: 0, lastModified: new Date(), isDirectory: true }
      ],
      hasMore: false
    });

    await archive.enterArchive('archive.zip');

    expect(archive.archiveKey).toBe('archive.zip');
    expect(archive.archivePrefix).toBe('');
    expect(archive.isInArchive).toBe(true);
    expect(api.archiveListing).toHaveBeenCalledWith({
      bucket: 'test-bucket',
      key: 'archive.zip',
      internalPrefix: '',
      nestedArchivePath: undefined
    });
    expect(archive.archiveLoading).toBe(false);
    expect(callbacks.setObjects).toHaveBeenCalled();
    const page = callbacks.setObjects.mock.calls[0][0] as StoragePage;
    expect(page.objects).toHaveLength(2);
    expect(page.objects[0].key).toBe('file.txt');
    expect(page.objects[1].key).toBe('subdir/');
  });

  it('saves previous S3 prefix when entering archive', async () => {
    const { archive, callbacks, api } = makeArchive();
    callbacks.getPrefix.mockReturnValue('my/s3/path/');
    (api.archiveListing as Mock).mockResolvedValue({ entries: [], hasMore: false });

    await archive.enterArchive('archive.zip');

    // _previousS3Prefix was set before fetch
    // We verify indirectly by checking exitArchive uses it
    archive.exitArchive();
    expect(callbacks.onExit).toHaveBeenCalledWith('my/s3/path/');
  });

  it('handles nested archive entry', async () => {
    const { archive, api } = makeArchive();
    archive.archiveKey = 'outer.zip';
    (api.archiveListing as Mock).mockResolvedValue({ entries: [], hasMore: false });

    await archive.enterArchive('inner.tar');

    expect(archive.archiveKey).toBe('outer.zip'); // unchanged
    expect(archive.nestedArchivePath).toBe('inner.tar');
    expect(archive.archivePrefix).toBe('');
  });

  it('shows toast on error', async () => {
    const { archive, api } = makeArchive();
    (api.archiveListing as Mock).mockRejectedValue(new Error('API error'));

    await archive.enterArchive('archive.zip');

    expect(archive.archiveKey).toBeNull();
    expect(addToast).toHaveBeenCalledWith('error', expect.any(String));
    expect(archive.archiveLoading).toBe(false);
  });

  it('handles error during nested archive entry and restores nested path', async () => {
    const { archive, api } = makeArchive();
    archive.archiveKey = 'outer.zip';
    archive.archivePrefix = 'some/path/';
    (api.archiveListing as Mock).mockRejectedValue(new Error('Nested error'));

    await archive.enterArchive('inner.tar');

    // Should restore nested path to null
    expect(archive.nestedArchivePath).toBeUndefined();
    expect(archive.archiveKey).toBe('outer.zip'); // outer archive preserved
    expect(addToast).toHaveBeenCalledWith('error', expect.any(String));
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// Group 4: navigateInArchive
// ─────────────────────────────────────────────────────────────────────────────

describe('navigateInArchive', () => {
  it('fetches listing with new prefix', async () => {
    const { archive, callbacks, api } = makeArchive();
    archive.archiveKey = 'archive.zip';
    (api.archiveListing as Mock).mockResolvedValue({ entries: [], hasMore: false });

    await archive.navigateInArchive('subdir/');

    expect(archive.archivePrefix).toBe('subdir/');
    expect(api.archiveListing).toHaveBeenCalledWith({
      bucket: 'test-bucket',
      key: 'archive.zip',
      internalPrefix: 'subdir/',
      nestedArchivePath: undefined
    });
    expect(archive.archiveLoading).toBe(false);
    expect(callbacks.clearPrevTokens).toHaveBeenCalled();
  });

  it('does nothing when no archive is open', async () => {
    const { archive, api } = makeArchive();

    await archive.navigateInArchive('subdir/');

    expect(api.archiveListing).not.toHaveBeenCalled();
    expect(archive.archivePrefix).toBe('');
  });

  it('shows toast on error', async () => {
    const { archive, api } = makeArchive();
    archive.archiveKey = 'archive.zip';
    (api.archiveListing as Mock).mockRejectedValue(new Error('Fail'));

    await archive.navigateInArchive('subdir/');

    expect(addToast).toHaveBeenCalledWith('error', expect.any(String));
    expect(archive.archiveLoading).toBe(false);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// Group 5: navigateToOuterArchiveRoot
// ─────────────────────────────────────────────────────────────────────────────

describe('navigateToOuterArchiveRoot', () => {
  it('clears nested path and fetches root listing', async () => {
    const { archive, callbacks, api } = makeArchive();
    archive.archiveKey = 'outer.zip';
    // Simulate being inside a nested archive
    // _archiveNestedPath is private, but we can call navigateToOuterArchiveRoot directly
    (api.archiveListing as Mock).mockResolvedValue({ entries: [], hasMore: false });

    // Set nested state via enterArchive
    archive.archivePrefix = 'subdir/';
    await archive.enterArchive('inner.tar'); // sets _archiveNestedPath
    vi.clearAllMocks();

    archive.navigateToOuterArchiveRoot();

    expect(callbacks.clearPrevTokens).toHaveBeenCalled();
    expect(api.archiveListing).toHaveBeenCalledWith(
      expect.objectContaining({ internalPrefix: '' })
    );
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// Group 6: navigateUpFromArchive
// ─────────────────────────────────────────────────────────────────────────────

describe('navigateUpFromArchive', () => {
  it('goes up one directory level within the archive', async () => {
    const { archive, api } = makeArchive();
    archive.archiveKey = 'archive.zip';
    archive.archivePrefix = 'music/videos/';
    (api.archiveListing as Mock).mockResolvedValue({ entries: [], hasMore: false });

    archive.navigateUpFromArchive();

    // Wait for async navigateInArchive
    await vi.waitFor(() => {
      expect(archive.archivePrefix).toBe('music/');
    });
  });

  it('exits archive when at root without nested path', () => {
    const { archive, callbacks } = makeArchive();
    archive.archiveKey = 'archive.zip';
    archive.archivePrefix = '';

    archive.navigateUpFromArchive();

    expect(callbacks.onExit).toHaveBeenCalled();
    expect(archive.archiveKey).toBeNull();
  });

  it('goes to outer archive root when at root with nested path', async () => {
    const { archive, callbacks, api } = makeArchive();
    archive.archiveKey = 'outer.zip';
    archive.archivePrefix = '';
    (api.archiveListing as Mock).mockResolvedValue({ entries: [], hasMore: false });
    // Enter nested archive to set _archiveNestedPath
    await archive.enterArchive('inner.tar');
    vi.clearAllMocks();
    (api.archiveListing as Mock).mockResolvedValue({ entries: [], hasMore: false });

    archive.navigateUpFromArchive();

    expect(archive.nestedArchivePath).toBeUndefined();
    expect(api.archiveListing).toHaveBeenCalledWith(
      expect.objectContaining({ internalPrefix: '' })
    );
    expect(callbacks.clearPrevTokens).toHaveBeenCalled();
  });

  it('goes one level up when not at root', async () => {
    const { archive, api } = makeArchive();
    archive.archiveKey = 'archive.zip';
    archive.archivePrefix = 'a/b/';
    (api.archiveListing as Mock).mockResolvedValue({ entries: [], hasMore: false });

    archive.navigateUpFromArchive();

    await vi.waitFor(() => {
      expect(archive.archivePrefix).toBe('a/');
    });
  });

  it('goes to root when at top-level prefix', async () => {
    const { archive, api } = makeArchive();
    archive.archiveKey = 'archive.zip';
    archive.archivePrefix = 'docs/';
    (api.archiveListing as Mock).mockResolvedValue({ entries: [], hasMore: false });

    archive.navigateUpFromArchive();

    await vi.waitFor(() => {
      expect(archive.archivePrefix).toBe('');
    });
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// Group 7: exitArchive
// ─────────────────────────────────────────────────────────────────────────────

describe('exitArchive', () => {
  it('clears state and calls onExit with previous S3 prefix', async () => {
    const { archive, callbacks, api } = makeArchive();
    (api.archiveListing as Mock).mockResolvedValue({ entries: [], hasMore: false });

    // Enter archive first to set _previousS3Prefix from getPrefix callback
    await archive.enterArchive('archive.zip');

    archive.exitArchive();

    expect(archive.archiveKey).toBeNull();
    expect(archive.archivePrefix).toBe('');
    expect(archive.archiveLoading).toBe(false);
    expect(archive.archiveTooLarge).toBe(false);
    expect(archive.isInArchive).toBe(false);
    expect(callbacks.onExit).toHaveBeenCalledWith('s3/prefix/');
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// Group 8: downloadFromArchive
// ─────────────────────────────────────────────────────────────────────────────

describe('downloadFromArchive', () => {
  it('downloads blob and creates download link', async () => {
    const { archive, api } = makeArchive();
    archive.archiveKey = 'archive.zip';
    const blob = new Blob(['test content']);
    (api.archiveExtract as Mock).mockResolvedValue(new Response(blob));
    const createObjectURLSpy = vi.spyOn(URL, 'createObjectURL').mockReturnValue('blob:fake-url');

    await archive.downloadFromArchive('path/to/file.txt');

    expect(api.archiveExtract).toHaveBeenCalledWith({
      bucket: 'test-bucket',
      key: 'archive.zip',
      path: 'path/to/file.txt',
      nestedArchivePath: undefined
    });
    expect(createObjectURLSpy).toHaveBeenCalled();
    createObjectURLSpy.mockRestore();
  });

  it('does nothing when no archive is open', async () => {
    const { archive, api } = makeArchive();

    await archive.downloadFromArchive('path/to/file.txt');

    expect(api.archiveExtract).not.toHaveBeenCalled();
  });

  it('shows error toast on StorageError', async () => {
    const { archive, api } = makeArchive();
    archive.archiveKey = 'archive.zip';
    (api.archiveExtract as Mock).mockRejectedValue(
      new (await import('./errors.js')).StorageError('not_found', 'Not found')
    );

    await archive.downloadFromArchive('missing.txt');

    expect(addToast).toHaveBeenCalledWith('error', expect.any(String));
  });

  it('shows generic error toast on unknown error', async () => {
    const { archive, api } = makeArchive();
    archive.archiveKey = 'archive.zip';
    (api.archiveExtract as Mock).mockRejectedValue(new Error('Network error'));

    await archive.downloadFromArchive('file.txt');

    expect(addToast).toHaveBeenCalledWith('error', expect.any(String));
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// Group 9: refreshListing
// ─────────────────────────────────────────────────────────────────────────────

describe('refreshListing', () => {
  it('re-fetches archive listing', async () => {
    const { archive, api } = makeArchive();
    archive.archiveKey = 'archive.zip';
    (api.archiveListing as Mock).mockResolvedValue({ entries: [], hasMore: false });

    archive.refreshListing();

    // Wait for the async fetch
    await vi.waitFor(() => {
      expect(api.archiveListing).toHaveBeenCalled();
    });
    expect(archive.archiveLoading).toBe(false);
  });

  it('sets loading to false on error', async () => {
    const { archive, api } = makeArchive();
    archive.archiveKey = 'archive.zip';
    (api.archiveListing as Mock).mockRejectedValue(new Error('Fail'));

    archive.refreshListing();

    await vi.waitFor(() => {
      expect(archive.archiveLoading).toBe(false);
    });
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// Group 10: reset
// ─────────────────────────────────────────────────────────────────────────────

describe('reset', () => {
  it('clears all archive state', () => {
    const { archive } = makeArchive();
    archive.archiveKey = 'archive.zip';
    archive.archivePrefix = 'subdir/';
    archive.archiveLoading = true;
    archive.archiveTooLarge = true;
    // Set internal state via enterArchive
    // (nested path is set internally — we verify reset clears it via exitArchive behavior)

    archive.reset();

    expect(archive.archiveKey).toBeNull();
    expect(archive.archivePrefix).toBe('');
    expect(archive.archiveLoading).toBe(false);
    expect(archive.archiveTooLarge).toBe(false);
    expect(archive.isInArchive).toBe(false);
    expect(archive.nestedArchivePath).toBeUndefined();
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// Group 11: _fetchS3Objects (internal)
// ─────────────────────────────────────────────────────────────────────────────

describe('_fetchS3Objects', () => {
  it('calls setObjects and setLoading on success', async () => {
    const { archive, callbacks, api } = makeArchive();
    const mockPage: StoragePage = {
      objects: [],
      hasNextPage: false,
      currentPage: 1,
      pageSize: 25
    };
    (api.list as Mock).mockResolvedValue(mockPage);

    await archive._fetchS3Objects('my-prefix/');

    expect(api.list).toHaveBeenCalledWith({
      bucket: 'test-bucket',
      prefix: 'my-prefix/',
      pageSize: 25
    });
    expect(callbacks.setPrefix).toHaveBeenCalledWith('my-prefix/');
    expect(callbacks.setObjects).toHaveBeenCalledWith(mockPage);
    expect(callbacks.setLoading).toHaveBeenCalledWith(false);
  });

  it('falls back to invalidateAll on error', async () => {
    const { archive, callbacks, api } = makeArchive();
    (api.list as Mock).mockRejectedValue(new Error('Network error'));

    await archive._fetchS3Objects('prefix/');

    expect(invalidateAll).toHaveBeenCalled();
    expect(callbacks.setLoading).toHaveBeenCalledWith(false);
  });

  it('passes empty prefix string when given undefined-like value', async () => {
    const { archive, api } = makeArchive();
    (api.list as Mock).mockResolvedValue({
      objects: [],
      hasNextPage: false,
      currentPage: 1,
      pageSize: 25
    });

    await archive._fetchS3Objects('');

    expect(api.list).toHaveBeenCalledWith(expect.objectContaining({ prefix: '' }));
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// Group 12: Too-large archives
// ─────────────────────────────────────────────────────────────────────────────

describe('too-large archives', () => {
  it('sets archiveTooLarge and clears objects when archive listing returns tooLarge', async () => {
    const { archive, callbacks, api } = makeArchive();
    (api.archiveListing as Mock).mockResolvedValue({
      entries: [],
      hasMore: false,
      tooLarge: true
    });

    await archive.enterArchive('huge.zip');

    expect(archive.archiveTooLarge).toBe(true);
    expect(archive.archiveLoading).toBe(false);
    expect(callbacks.setObjects).toHaveBeenCalledWith({
      objects: [],
      hasNextPage: false,
      currentPage: 1,
      pageSize: null
    });
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// Group 13: Nested archive navigation
// ─────────────────────────────────────────────────────────────────────────────

describe('nested archive navigation', () => {
  it('entering a nested archive preserves outer archiveKey', async () => {
    const { archive, api } = makeArchive();
    archive.archiveKey = 'outer.zip';
    archive.archivePrefix = 'some/path/';
    (api.archiveListing as Mock).mockResolvedValue({ entries: [], hasMore: false });

    await archive.enterArchive('inner.tar');

    expect(archive.archiveKey).toBe('outer.zip');
    expect(archive.nestedArchivePath).toBe('inner.tar');
    expect(archive.archivePrefix).toBe('');
    expect(api.archiveListing).toHaveBeenCalledWith(
      expect.objectContaining({
        key: 'outer.zip',
        nestedArchivePath: 'inner.tar'
      })
    );
  });

  it('navigating within nested archive keeps the nested path', async () => {
    const { archive, api } = makeArchive();
    archive.archiveKey = 'outer.zip';
    (api.archiveListing as Mock).mockResolvedValue({ entries: [], hasMore: false });
    await archive.enterArchive('inner.tar');
    vi.clearAllMocks();
    (api.archiveListing as Mock).mockResolvedValue({ entries: [], hasMore: false });

    await archive.navigateInArchive('subdir/');

    expect(api.archiveListing).toHaveBeenCalledWith(
      expect.objectContaining({
        key: 'outer.zip',
        nestedArchivePath: 'inner.tar',
        internalPrefix: 'subdir/'
      })
    );
  });

  it('navigateToOuterArchiveRoot exits nested archive', async () => {
    const { archive, api } = makeArchive();
    archive.archiveKey = 'outer.zip';
    (api.archiveListing as Mock).mockResolvedValue({ entries: [], hasMore: false });
    await archive.enterArchive('inner.tar');
    vi.clearAllMocks();
    (api.archiveListing as Mock).mockResolvedValue({ entries: [], hasMore: false });

    archive.navigateToOuterArchiveRoot();

    await vi.waitFor(() => {
      expect(api.archiveListing).toHaveBeenCalledWith(
        expect.objectContaining({
          key: 'outer.zip',
          nestedArchivePath: undefined,
          internalPrefix: ''
        })
      );
    });
    expect(archive.nestedArchivePath).toBeUndefined();
  });
});

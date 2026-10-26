import { describe, it, expect } from 'vitest';
import { joinHdfsPath, normaliseHdfsBasePath } from './hdfs-path.js';

describe('normaliseHdfsBasePath', () => {
  it('normalises absolute paths', () => {
    expect(normaliseHdfsBasePath('/')).toBe('/');
    expect(normaliseHdfsBasePath(' /user//alice/ ')).toBe('/user/alice');
    expect(normaliseHdfsBasePath('/data')).toBe('/data');
  });

  it('rejects relative paths and dot segments', () => {
    expect(normaliseHdfsBasePath('data')).toBeNull();
    expect(normaliseHdfsBasePath('/data/../etc')).toBeNull();
    expect(normaliseHdfsBasePath('/./data')).toBeNull();
  });
});

describe('joinHdfsPath', () => {
  it('joins base paths and keys', () => {
    expect(joinHdfsPath('/', '')).toBe('/');
    expect(joinHdfsPath('/', 'a/b.txt')).toBe('/a/b.txt');
    expect(joinHdfsPath('/data', 'dir/')).toBe('/data/dir');
    expect(joinHdfsPath('/data/', '')).toBe('/data');
  });
});

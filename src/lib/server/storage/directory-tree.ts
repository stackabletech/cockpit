import type { TreemapNode, DirectoryChildItem } from '$lib/storage/details-types.js';

function trieToTreemap(prefix: string, node: TrieNode): TreemapNode {
  function convert(n: TrieNode, parentPrefix: string, isRoot: boolean): TreemapNode {
    const result: TreemapNode = {
      name: n.name,
      size: n.size
    };
    if (n.children.size > 0) {
      result.children = [...n.children.entries()]
        .map(([, v]) => convert(v, isRoot ? '' : parentPrefix + n.name + '/', false))
        .sort((a, b) => b.size - a.size);
    } else {
      result.path = parentPrefix || undefined;
      result.fullKey = prefix + (parentPrefix || '') + n.name;
    }
    return result;
  }
  return convert(node, '', true);
}

interface TrieNode {
  name: string;
  size: number;
  children: Map<string, TrieNode>;
}

export function buildTree(prefix: string, keys: Array<{ key: string; size: number }>): TreemapNode {
  const rootName = prefix.split('/').filter(Boolean).pop() || '(root)';

  const rootTrie: TrieNode = { name: rootName, size: 0, children: new Map() };

  for (const { key, size } of keys) {
    const relative = key.slice(prefix.length);
    const parts = relative.split('/').filter(Boolean);
    if (parts.length === 0) continue;

    rootTrie.size += size;
    let current = rootTrie;
    for (let i = 0; i < parts.length; i++) {
      const part = parts[i];
      if (!current.children.has(part)) {
        current.children.set(part, { name: part, size: 0, children: new Map() });
      }
      current = current.children.get(part)!;
      current.size += size;
    }
  }

  return trieToTreemap(prefix, rootTrie);
}

export function buildChildrenByDepth(
  prefix: string,
  keys: Array<{ key: string; size: number; lastModified?: Date }>,
  maxDepth: number
): Record<number, DirectoryChildItem[]> {
  const depthMaps: Map<string, { size: number; lastModified: Date | undefined }>[] = [];
  for (let d = 1; d <= maxDepth; d++) {
    depthMaps.push(new Map());
  }

  for (const { key, size, lastModified } of keys) {
    const relative = key.slice(prefix.length);
    const parts = relative.split('/').filter(Boolean);
    if (parts.length === 0) continue;

    for (let d = 1; d <= maxDepth; d++) {
      if (parts.length < d) continue;

      const nameParts = parts.slice(0, d);
      const index = d - 1;
      const isDir = index < parts.length - 1 || relative.endsWith('/');
      const childName = isDir ? nameParts.join('/') + '/' : nameParts.join('/');

      const map = depthMaps[d - 1];
      const existing = map.get(childName);
      if (existing) {
        existing.size += size;
        if (lastModified && (!existing.lastModified || lastModified > existing.lastModified)) {
          existing.lastModified = lastModified;
        }
      } else {
        map.set(childName, { size, lastModified });
      }
    }
  }

  const result: Record<number, DirectoryChildItem[]> = {};
  for (let d = 1; d <= maxDepth; d++) {
    result[d] = [...depthMaps[d - 1].entries()]
      .map(([name, entry]) => ({
        name,
        size: entry.size,
        lastModified: entry.lastModified?.toISOString(),
        isDirectory: name.endsWith('/')
      }))
      .sort((a, b) => b.size - a.size);
  }

  return result;
}

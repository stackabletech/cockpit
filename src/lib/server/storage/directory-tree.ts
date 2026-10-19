import type {
  DirectoryChildItem,
  DirectoryChildList,
  DirectorySizeResult,
  TreemapNode
} from '$lib/storage/details-types.js';

/** Objects listed at most per calculation; larger directories get a partial result. */
export const DIRECTORY_SIZE_MAX_KEYS = 10_000;
/** Files drawn in the treemap; smaller ones are grouped into "N more" nodes. */
export const TREEMAP_MAX_LEAVES = 30;
/** Entries per depth in the contents list; smaller ones are only counted. */
export const DEPTH_LIST_MAX_ENTRIES = 1000;

interface TrieNode {
  name: string;
  size: number;
  lastModified: Date | undefined;
  isDirectory: boolean;
  /** Keyed by name, with a trailing `/` for folders, so a file and a folder of
   *  the same name stay apart. Created only for folders. */
  children?: Map<string, TrieNode>;
}

type ListedKey = { key: string; size: number; lastModified?: Date };

/**
 * Aggregates a recursive listing batch by batch, without keeping the keys.
 * Stops accepting keys once `maxKeys` have been added.
 */
export class DirectorySizeAggregator {
  readonly #prefix: string;
  readonly #maxKeys: number;
  readonly #root: TrieNode;
  #totalKeys = 0;
  #totalSize = 0;
  #totalFiles = 0;
  #totalDirectories = 0;
  #maxDepth = 1;
  #truncated = false;

  constructor(prefix: string, maxKeys: number) {
    this.#prefix = prefix;
    this.#maxKeys = maxKeys;
    const rootName = prefix.split('/').filter(Boolean).pop() || '(root)';
    this.#root = {
      name: rootName,
      size: 0,
      lastModified: undefined,
      isDirectory: true,
      children: new Map()
    };
  }

  get totalKeys(): number {
    return this.#totalKeys;
  }

  get totalSize(): number {
    return this.#totalSize;
  }

  get truncated(): boolean {
    return this.#truncated;
  }

  /** Adds a batch. Returns `false` once the key limit is reached. */
  add(batch: ListedKey[]): boolean {
    for (const item of batch) {
      if (this.#totalKeys >= this.#maxKeys) {
        this.#truncated = true;
        return false;
      }
      this.#addKey(item);
    }
    return true;
  }

  #addKey({ key, size, lastModified }: ListedKey) {
    this.#totalKeys++;
    this.#totalSize += size;
    if (key.endsWith('/')) this.#totalDirectories++;
    else this.#totalFiles++;

    const relative = key.slice(this.#prefix.length);
    const parts = relative.split('/').filter(Boolean);
    if (parts.length === 0) return;
    if (parts.length > this.#maxDepth) this.#maxDepth = parts.length;

    this.#root.size += size;
    let current = this.#root;
    for (let i = 0; i < parts.length; i++) {
      const isDirectory = i < parts.length - 1 || relative.endsWith('/');
      const childKey = isDirectory ? parts[i] + '/' : parts[i];
      current.children ??= new Map();
      let child = current.children.get(childKey);
      if (!child) {
        child = { name: parts[i], size: 0, lastModified: undefined, isDirectory };
        current.children.set(childKey, child);
      }
      child.size += size;
      if (lastModified && (!child.lastModified || lastModified > child.lastModified)) {
        child.lastModified = lastModified;
      }
      current = child;
    }
  }

  result(durationMs: number): DirectorySizeResult {
    return {
      type: 'complete',
      totalSize: this.#totalSize,
      totalKeys: this.#totalKeys,
      totalFiles: this.#totalFiles,
      totalDirectories: this.#totalDirectories,
      tree: this.#treemap(),
      childrenByDepth: this.#childrenByDepth(),
      maxDepth: this.#maxDepth,
      durationMs,
      truncated: this.#truncated
    };
  }

  /**
   * The treemap keeps the TREEMAP_MAX_LEAVES largest leaves. Everything else
   * in a folder, including subfolders without a kept leaf, becomes one
   * `moreCount` node, so the output stays small however large the folder is.
   */
  #treemap(): TreemapNode {
    const leaves: TrieNode[] = [];
    const collect = (node: TrieNode) => {
      if (!node.children?.size) leaves.push(node);
      else for (const child of node.children.values()) collect(child);
    };
    for (const child of this.#root.children!.values()) collect(child);

    if (leaves.length === 0) return { name: this.#root.name, size: this.#root.size };

    leaves.sort((a, b) => b.size - a.size);
    const kept = new Set(leaves.slice(0, TREEMAP_MAX_LEAVES));

    // Leaf count and whether a kept leaf is inside, per folder.
    const stats = new Map<TrieNode, { leaves: number; hasKept: boolean }>();
    const measure = (node: TrieNode): { leaves: number; hasKept: boolean } => {
      if (!node.children?.size) return { leaves: 1, hasKept: kept.has(node) };
      let count = 0;
      let hasKept = false;
      for (const child of node.children.values()) {
        const s = measure(child);
        count += s.leaves;
        hasKept ||= s.hasKept;
      }
      const s = { leaves: count, hasKept };
      stats.set(node, s);
      return s;
    };
    measure(this.#root);

    const convert = (node: TrieNode, parentPath: string, isRoot: boolean): TreemapNode => {
      if (!node.children?.size) {
        return {
          name: node.name,
          size: node.size,
          path: parentPath || undefined,
          fullKey: this.#prefix + parentPath + node.name + (node.isDirectory ? '/' : '')
        };
      }
      const childPath = isRoot ? '' : parentPath + node.name + '/';
      const children: TreemapNode[] = [];
      let moreSize = 0;
      let moreCount = 0;
      for (const child of node.children.values()) {
        const isLeaf = !child.children?.size;
        if (isLeaf ? kept.has(child) : stats.get(child)!.hasKept) {
          children.push(convert(child, childPath, false));
        } else {
          moreSize += child.size;
          moreCount += isLeaf ? 1 : stats.get(child)!.leaves;
        }
      }
      if (moreCount > 0) children.push({ name: '', size: moreSize, moreCount });
      children.sort((a, b) => b.size - a.size);
      return { name: node.name, size: node.size, children };
    };
    return convert(this.#root, '', true);
  }

  #childrenByDepth(): Record<number, DirectoryChildList> {
    const byDepth: DirectoryChildItem[][] = Array.from({ length: this.#maxDepth }, () => []);
    const walk = (node: TrieNode, path: string, depth: number) => {
      for (const child of node.children?.values() ?? []) {
        const name = path + child.name + (child.isDirectory ? '/' : '');
        byDepth[depth - 1].push({
          name,
          size: child.size,
          lastModified: child.lastModified?.toISOString(),
          isDirectory: child.isDirectory
        });
        if (child.children) walk(child, path + child.name + '/', depth + 1);
      }
    };
    walk(this.#root, '', 1);

    const result: Record<number, DirectoryChildList> = {};
    byDepth.forEach((entries, index) => {
      entries.sort((a, b) => b.size - a.size);
      const omitted = entries.slice(DEPTH_LIST_MAX_ENTRIES);
      result[index + 1] = {
        items: entries.slice(0, DEPTH_LIST_MAX_ENTRIES),
        omittedCount: omitted.length,
        omittedSize: omitted.reduce((sum, entry) => sum + entry.size, 0)
      };
    });
    return result;
  }
}

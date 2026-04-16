import { beforeEach, describe, expect, it } from 'vitest';
import {
  _resetCompletionHistory,
  categoryForKind,
  rankOf,
  recordUse,
  sortPrefixForRank
} from './completion-history';

// Minimal Monaco stub — categoryForKind only inspects the CompletionItemKind
// numeric enum, not the rest of the module.
const CompletionItemKind = {
  Folder: 19,
  Module: 8,
  Class: 6,
  Interface: 7,
  Struct: 21,
  Field: 4,
  Function: 1,
  Keyword: 13,
  Snippet: 26
} as const;
const monacoStub = {
  languages: { CompletionItemKind }
} as unknown as typeof import('monaco-editor');

beforeEach(() => {
  _resetCompletionHistory();
});

describe('completion-history', () => {
  it('records a use and ranks it at position 0', () => {
    recordUse('tables', 'customer');
    expect(rankOf('tables', 'customer')).toBe(0);
  });

  it('keeps insertion order for distinct items', () => {
    recordUse('tables', 'a');
    recordUse('tables', 'b');
    recordUse('tables', 'c');
    expect(rankOf('tables', 'c')).toBe(0);
    expect(rankOf('tables', 'b')).toBe(1);
    expect(rankOf('tables', 'a')).toBe(2);
  });

  it('moves a re-used item back to the front (no duplicates)', () => {
    recordUse('tables', 'a');
    recordUse('tables', 'b');
    recordUse('tables', 'a');
    expect(rankOf('tables', 'a')).toBe(0);
    expect(rankOf('tables', 'b')).toBe(1);
  });

  it('caps the keywords list at 20 entries', () => {
    for (let i = 0; i < 30; i++) recordUse('keywords', `KW${i}`);
    expect(rankOf('keywords', 'KW29')).toBe(0);
    expect(rankOf('keywords', 'KW10')).toBe(19);
    // KW9 and earlier should have been evicted off the tail.
    expect(rankOf('keywords', 'KW9')).toBeNull();
  });

  it('returns null for items not in the list', () => {
    expect(rankOf('columns', 'never_used')).toBeNull();
  });

  it('keeps each category independent', () => {
    recordUse('tables', 'shared');
    expect(rankOf('tables', 'shared')).toBe(0);
    expect(rankOf('columns', 'shared')).toBeNull();
  });

  it('maps table/view/materialized-view item kinds to the shared tables bucket', () => {
    // All three relation kinds must share an LRU bucket — a recently-used view
    // should keep its recency boost if the user creates a table with the same
    // base name, and vice versa.
    expect(categoryForKind(monacoStub, CompletionItemKind.Class)).toBe('tables');
    expect(categoryForKind(monacoStub, CompletionItemKind.Interface)).toBe('tables');
    expect(categoryForKind(monacoStub, CompletionItemKind.Struct)).toBe('tables');
  });

  it('ignores untracked completion kinds', () => {
    expect(categoryForKind(monacoStub, CompletionItemKind.Snippet)).toBeNull();
  });

  it('emits zero-padded sort prefixes so string order matches numeric rank', () => {
    expect(sortPrefixForRank(0) < sortPrefixForRank(1)).toBe(true);
    expect(sortPrefixForRank(9) < sortPrefixForRank(10)).toBe(true);
    expect(sortPrefixForRank(99) < sortPrefixForRank(100)).toBe(true);
    // Ranked prefixes always sort before the existing category prefixes
    // ('0_'..'3_'), so a recently-used item beats an unused one of any tier.
    expect(sortPrefixForRank(199) < '0_').toBe(true);
  });
});

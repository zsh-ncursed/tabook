import { describe, it, expect } from 'vitest';
import { BookSearchIndex, normalizeQuery } from './index.js';
import type { Block } from '../formats/model.js';

function para(text: string): Block {
  return { type: 'paragraph', children: [{ kind: 'text', text }] };
}

const blocks: Block[] = [
  para('The quick brown fox'),
  para('A lazy dog and another fox'),
  { type: 'heading', level: 1, children: [{ kind: 'text', text: 'FOX CHAPTER' }] },
  para('Nothing here'),
];

describe('BookSearchIndex', () => {
  it('finds case-insensitive matches across blocks', () => {
    const index = new BookSearchIndex(blocks);
    const matches = index.search('fox');
    expect(matches.length).toBe(3);
    expect(matches.map((m) => m.blockIndex).sort()).toEqual([0, 1, 2]);
  });

  it('returns every occurrence in a block', () => {
    const index = new BookSearchIndex(blocks);
    const matches = index.search('fox');
    const inBlock = matches.filter((m) => m.blockIndex === 0);
    expect(inBlock).toHaveLength(1);
    expect(inBlock[0]!.start).toBe(16);
  });

  it('ignores empty and whitespace queries', () => {
    const index = new BookSearchIndex(blocks);
    expect(index.search('')).toEqual([]);
    expect(index.search('   ')).toEqual([]);
  });

  it('normalizes multiple spaces in the query', () => {
    expect(normalizeQuery('  The   Quick ')).toBe('the quick');
    const index = new BookSearchIndex(blocks);
    expect(index.search('quick  brown').length).toBe(1);
  });

  it('builds highlight ranges per block', () => {
    const index = new BookSearchIndex(blocks);
    const ranges = index.highlightRanges('fox');
    expect(ranges.has(0)).toBe(true);
    expect(ranges.get(0)).toEqual([{ start: 16, end: 19 }]);
    expect(ranges.has(3)).toBe(false);
  });

  it('returns no matches for absent terms', () => {
    const index = new BookSearchIndex(blocks);
    expect(index.search('zebra')).toEqual([]);
  });
});

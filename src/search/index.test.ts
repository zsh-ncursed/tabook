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

  it('keeps Unicode offsets in original-text coordinates', () => {
    // '\u0130' (U+0130) lowercases to 'i\u0307' (i + combining dot) — two code points
    // from one. A naive toLowerCase() of the whole text would shift all
    // following offsets; the fold map must map back to the original text.
    const unicodeBlocks: Block[] = [para('x\u0130stanbul y')];
    const index = new BookSearchIndex(unicodeBlocks);
    const matches = index.search('istanbul');
    expect(matches).toHaveLength(1);
    expect(matches[0]!.start).toBe(1);
    expect(matches[0]!.end).toBe(9);
    // Offset 9 is within the original text ('x\u0130stanbul y'.length === 11).
    expect('x\u0130stanbul y'.length).toBe(11);
  });

  it('highlights a Unicode term at the correct range', () => {
    const unicodeBlocks: Block[] = [para('\u0130stanbul')];
    const index = new BookSearchIndex(unicodeBlocks);
    const ranges = index.blockHighlights('istanbul', 0);
    expect(ranges).toEqual([{ start: 0, end: 8 }]);
    // '\u0130stanbul'.length === 8 in JS code units.
    expect('\u0130stanbul'.length).toBe(8);
  });

  it('computes block highlights lazily per block', () => {
    const index = new BookSearchIndex(blocks);
    // Only the blocks that contain the term are scanned on demand.
    expect(index.blockHighlights('fox', 0)).toEqual([{ start: 16, end: 19 }]);
    expect(index.blockHighlights('fox', 3)).toEqual([]);
    expect(index.blockHighlights('', 0)).toEqual([]);
  });

  it('handles astral characters (emoji) without offset drift', () => {
    // U+1F600 (😀) is a surrogate pair — 2 UTF-16 code units, but 1 code point.
    // The renderer counts code points, so search offsets must also be code-point based.
    const emojiBlocks: Block[] = [para('a😀bc')];
    const index = new BookSearchIndex(emojiBlocks);
    const matches = index.search('bc');
    expect(matches).toHaveLength(1);
    // Code-point offsets: a=0, 😀=1, b=2, c=3  →  "bc" starts at code-point 2.
    // (The old UTF-16-based code would have returned start=4, which is wrong.)
    expect(matches[0]!.start).toBe(2);
    expect(matches[0]!.end).toBe(4);
  });
});
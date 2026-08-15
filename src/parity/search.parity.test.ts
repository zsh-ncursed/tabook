// Golden parity: in-book search — native.BookSearchIndex (Rust) vs
// TsSearchIndexImpl (pure-TS fallback). Match offsets must agree on
// multi-byte text (Cyrillic, CJK, emoji) — a known drift source.
import { describe, it, expect } from 'vitest';
import type { Block } from '../formats/model.js';
import { TsSearchIndexImpl } from '../search/index.js';
import { requireNative, richBlocks, SEARCH_QUERIES } from './helpers.js';

const n = requireNative();

const P = (text: string): Block => ({ type: 'paragraph', children: [{ kind: 'text', text }] });

function tsRanges(
  impl: TsSearchIndexImpl,
  q: string,
): Array<{ blockIndex: number; ranges: unknown[] }> {
  const map = impl.highlightRanges(q);
  return [...map.entries()]
    .map(([blockIndex, ranges]) => ({ blockIndex, ranges }))
    .sort((a, b) => a.blockIndex - b.blockIndex);
}

function nativeRanges(
  impl: InstanceType<typeof n.BookSearchIndex>,
  q: string,
): Array<{ blockIndex: number; ranges: unknown[] }> {
  return impl
    .highlightRanges(q)
    .map((h) => ({ blockIndex: h.blockIndex, ranges: h.ranges }))
    .sort((a, b) => a.blockIndex - b.blockIndex);
}

describe('parity: search index', () => {
  it('search matches agree on a rich book', () => {
    const blocks = richBlocks();
    const ts = new TsSearchIndexImpl(blocks);
    const nat = new n.BookSearchIndex(blocks);
    expect(ts.blockCount).toBe(nat.blockCount);
    for (const q of SEARCH_QUERIES) {
      expect(ts.search(q), `search(${JSON.stringify(q)})`).toEqual(nat.search(q));
    }
  });

  it('highlight ranges agree block by block', () => {
    const blocks = richBlocks();
    const ts = new TsSearchIndexImpl(blocks);
    const nat = new n.BookSearchIndex(blocks);
    for (const q of SEARCH_QUERIES) {
      expect(tsRanges(ts, q), `highlightRanges(${JSON.stringify(q)})`).toEqual(
        nativeRanges(nat, q),
      );
      for (const b of [0, 1, 5, 13]) {
        expect(ts.blockHighlights(q, b), `blockHighlights(${JSON.stringify(q)}, ${b})`).toEqual(
          nat.blockHighlights(q, b),
        );
      }
    }
  });

  it('offsets agree on Cyrillic text', () => {
    const text = 'сумрачную затхлую комнату и сумрачную лекцию';
    const ts = new TsSearchIndexImpl([P(text)]);
    const nat = new n.BookSearchIndex([P(text)]);
    expect(ts.search('сумрачную')).toEqual(nat.search('сумрачную'));
    expect(ts.search('сумрачную')).toEqual([
      { blockIndex: 0, start: 0, end: 9 },
      { blockIndex: 0, start: 28, end: 37 },
    ]);
  });

  it('offsets agree on text with emoji (code points, not UTF-16)', () => {
    const text = '🎉 party at 🎉 eight';
    const ts = new TsSearchIndexImpl([P(text)]);
    const nat = new n.BookSearchIndex([P(text)]);
    expect(ts.search('party')).toEqual(nat.search('party'));
    // 'party' follows emoji + space = code point 2 (the TS fallback used to
    // report UTF-16 offsets: start 3, and a lone-surrogate end before the
    // fix).
    expect(ts.search('party')).toEqual([{ blockIndex: 0, start: 2, end: 7 }]);
    expect(ts.search('eight')).toEqual([{ blockIndex: 0, start: 13, end: 18 }]);
  });

  it('overlapping matches agree', () => {
    const ts = new TsSearchIndexImpl([P('ааа')]);
    const nat = new n.BookSearchIndex([P('ааа')]);
    expect(ts.search('аа')).toEqual(nat.search('аа'));
    expect(ts.search('аа')).toEqual([
      { blockIndex: 0, start: 0, end: 2 },
      { blockIndex: 0, start: 1, end: 3 },
    ]);
  });

  it('whitespace and diacritic folding agree', () => {
    const text = 'Café  au   lait\nСтрока';
    const ts = new TsSearchIndexImpl([P(text)]);
    const nat = new n.BookSearchIndex([P(text)]);
    for (const q of ['cafe au lait', 'café', 'Строка', '  cafe  au  ', 'lait строка']) {
      expect(ts.search(q), `search(${JSON.stringify(q)})`).toEqual(nat.search(q));
    }
  });
});

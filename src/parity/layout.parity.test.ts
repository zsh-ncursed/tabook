// Golden parity: layout engine — native.BookLayout (Rust) vs TsBookLayout
// (pure-TS fallback) on identical block fixtures.
import { describe, it, expect } from 'vitest';
import type { Block } from '../formats/model.js';
import type { HighlightRange, LayoutOptions } from '../renderer/layout.js';
import { TsBookLayout } from '../renderer/layout.js';
import {
  requireNative,
  richBlocks,
  TYPO,
  TYPO_JUSTIFY,
  layoutAllLines,
  probeOffsets,
} from './helpers.js';

const n = requireNative();

interface LayoutEngine {
  readonly blockCount: number;
  readonly totalChars: number;
  lineCount(): number;
  getRange(start: number, count: number): import('../renderer/layout.js').TextLine[];
  lineForCharOffset(offset: number): number;
  charOffsetForLine(line: number): number;
  textNear(offset: number, length?: number): string;
  estimateLineCount(): number;
  blockCharStart(blockIndex: number): number;
  lineForBlock(blockIndex: number): number;
  pageForCharOffset(offset: number, pageHeight: number): number;
  blockStartLine(blockIndex: number): number | undefined;
}

function tsLayout(
  blocks: Block[],
  typo: typeof TYPO,
  width: number,
  getHighlights?: (blockIndex: number) => HighlightRange[] | undefined,
): LayoutEngine {
  const opts: LayoutOptions = { typo, width, justify: typo.justify, getHighlights };
  return new TsBookLayout(blocks, opts);
}

function nativeLayout(
  blocks: Block[],
  typo: typeof TYPO,
  width: number,
  highlights?: Array<{ blockIndex: number; ranges: HighlightRange[] }>,
): LayoutEngine {
  const layout = new n.BookLayout(blocks, typo, width, typo.justify);
  if (highlights && highlights.length > 0) {
    layout.setHighlights(highlights);
    layout.invalidate();
  }
  return {
    blockCount: layout.blockCount,
    totalChars: layout.totalChars,
    lineCount: () => layout.lineCount(),
    getRange: (s, c) =>
      layout.getRange(s, c) as unknown as import('../renderer/layout.js').TextLine[],
    lineForCharOffset: (o) => layout.lineForCharOffset(o),
    charOffsetForLine: (l) => layout.charOffsetForLine(l),
    textNear: (o, len) => layout.textNear(o, len),
    estimateLineCount: () => layout.estimateLineCount(),
    blockCharStart: (b) => layout.blockCharStart(b),
    lineForBlock: (b) => layout.lineForBlock(b),
    pageForCharOffset: (o, h) => layout.pageForCharOffset(o, h),
    blockStartLine: (b) => layout.blockStartLine(b) ?? undefined,
  };
}

const HIGHLIGHTS: Array<{ blockIndex: number; ranges: HighlightRange[] }> = [
  { blockIndex: 1, ranges: [{ start: 0, end: 6 }] },
  { blockIndex: 13, ranges: [{ start: 0, end: 2 }] },
];

describe('parity: layout engine', () => {
  for (const width of [40, 80]) {
    it(`renders the full book identically at width ${width}`, () => {
      const blocks = richBlocks();
      const ts = tsLayout(blocks, TYPO, width);
      const nat = nativeLayout(blocks, TYPO, width);
      expect(ts.blockCount).toBe(nat.blockCount);
      expect(ts.totalChars).toBe(nat.totalChars);
      expect(layoutAllLines(ts)).toEqual(layoutAllLines(nat));
    });
  }

  it('renders identically with justify + hyphenation', () => {
    const blocks = richBlocks();
    const ts = tsLayout(blocks, TYPO_JUSTIFY, 40);
    const nat = nativeLayout(blocks, TYPO_JUSTIFY, 40);
    expect(layoutAllLines(ts)).toEqual(layoutAllLines(nat));
  });

  it('renders highlights identically', () => {
    const blocks = richBlocks();
    const ts = tsLayout(blocks, TYPO, 40, (i) => {
      const h = HIGHLIGHTS.find((x) => x.blockIndex === i);
      return h ? h.ranges : undefined;
    });
    const nat = nativeLayout(blocks, TYPO, 40, HIGHLIGHTS);
    expect(layoutAllLines(ts)).toEqual(layoutAllLines(nat));
  });

  it('navigation and probe methods agree', () => {
    const blocks = richBlocks();
    for (const width of [40, 80]) {
      const ts = tsLayout(blocks, TYPO, width);
      const nat = nativeLayout(blocks, TYPO, width);
      const pageHeight = 20;
      for (const offset of probeOffsets(nat.totalChars)) {
        expect(ts.lineForCharOffset(offset), `lineForCharOffset(${offset})`).toBe(
          nat.lineForCharOffset(offset),
        );
        expect(ts.textNear(offset, 40), `textNear(${offset})`).toBe(nat.textNear(offset, 40));
        expect(ts.pageForCharOffset(offset, pageHeight), `pageForCharOffset(${offset})`).toBe(
          nat.pageForCharOffset(offset, pageHeight),
        );
      }
      for (const line of [0, 1, 5, 20, 100, 500]) {
        expect(ts.charOffsetForLine(line), `charOffsetForLine(${line})`).toBe(
          nat.charOffsetForLine(line),
        );
      }
      for (let b = 0; b < blocks.length; b++) {
        expect(ts.blockCharStart(b), `blockCharStart(${b})`).toBe(nat.blockCharStart(b));
        expect(ts.lineForBlock(b), `lineForBlock(${b})`).toBe(nat.lineForBlock(b));
        expect(ts.blockStartLine(b), `blockStartLine(${b})`).toBe(nat.blockStartLine(b));
      }
      expect(ts.estimateLineCount()).toBe(nat.estimateLineCount());
    }
  });

  it('empty book edge case', () => {
    const ts = tsLayout([], TYPO, 80);
    const nat = nativeLayout([], TYPO, 80);
    expect(ts.blockCount).toBe(nat.blockCount);
    expect(ts.totalChars).toBe(nat.totalChars);
    expect(layoutAllLines(ts)).toEqual(layoutAllLines(nat));
  });
});

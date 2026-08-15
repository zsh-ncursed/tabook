import { native } from '../native.js';
import type { Block } from '../formats/model.js';
import type { HighlightRange } from '../renderer/layout.js';
import { blockToPlainText } from '../renderer/blocks.js';

export interface SearchMatch {
  blockIndex: number;
  start: number;
  end: number;
}

// BookSearchIndex delegates to native (code-point based, audit bugfix) when
// available, falls back to TS (UTF-16) when not.

interface SearchIndex {
  readonly blockCount: number;
  search(query: string): SearchMatch[];
  blockHighlights(query: string, blockIndex: number): HighlightRange[];
  highlightRanges(query: string): Map<number, HighlightRange[]>;
}

// TS fallback
const MAX_MATCHES = 10000;

interface FoldedBlock {
  folded: string;
  foldToOrig: number[];
}

function foldText(text: string): FoldedBlock {
  // Iterate code points, not UTF-16 code units: split()/for-of would tear
  // surrogate pairs (emoji) into lone halves and corrupt both the folded
  // text and the foldToOrig mapping. Iterating the lc of each source code
  // point by code points keeps one foldToOrig entry per folded char.
  let folded = '';
  const foldToOrig: number[] = [];
  let prevWasSpace = false;
  const chars = Array.from(text);
  for (let i = 0; i < chars.length; i++) {
    const lc = chars[i]!.toLowerCase()
      .normalize('NFKD')
      .replace(/[\u0300-\u036f]/g, '');
    for (const c of lc) {
      if (/\s/.test(c)) {
        if (prevWasSpace) continue;
        folded += ' ';
        foldToOrig.push(i);
        prevWasSpace = true;
      } else {
        folded += c;
        foldToOrig.push(i);
        prevWasSpace = false;
      }
    }
  }
  return { folded, foldToOrig };
}

export class BookSearchIndex implements SearchIndex {
  private readonly impl: SearchIndex;

  constructor(blocks: Block[]) {
    if (native) {
      const inner = new native.BookSearchIndex(blocks);
      this.impl = {
        get blockCount() {
          return inner.blockCount;
        },
        search: (q) => inner.search(q) as SearchMatch[],
        blockHighlights: (q, i) => inner.blockHighlights(q, i) as HighlightRange[],
        highlightRanges: (q) => {
          const map = new Map<number, HighlightRange[]>();
          // Single native crossing: native.highlightRanges returns every
          // block's ranges at once (avoids per-block napi calls).
          for (const { blockIndex, ranges } of inner.highlightRanges(q)) {
            map.set(blockIndex, ranges as HighlightRange[]);
          }
          return map;
        },
      };
    } else {
      this.impl = new TsSearchIndexImpl(blocks);
    }
  }

  get blockCount(): number {
    return this.impl.blockCount;
  }

  search(query: string): SearchMatch[] {
    return this.impl.search(query);
  }

  blockHighlights(query: string, blockIndex: number): HighlightRange[] {
    return this.impl.blockHighlights(query, blockIndex);
  }

  highlightRanges(query: string): Map<number, HighlightRange[]> {
    return this.impl.highlightRanges(query);
  }
}

// Exported so parity tests can compare the pure-TS fallback against
// native.BookSearchIndex directly (see src/parity/search.parity.test.ts).
export class TsSearchIndexImpl implements SearchIndex {
  private readonly folded: FoldedBlock[];

  constructor(blocks: Block[]) {
    this.folded = blocks.map((block) => foldText(blockToPlainText(block)));
  }

  get blockCount(): number {
    return this.folded.length;
  }

  search(query: string): SearchMatch[] {
    const q = normalizeQuery(query);
    if (q === '') return [];
    // indexOf returns UTF-16 offsets, but foldToOrig is indexed by code point
    // (foldText pushes one entry per folded char). Converting the match start
    // to a code-point index keeps offsets correct on multi-byte text — the
    // same bugfix the Rust core applies (search.rs).
    const matches: SearchMatch[] = [];
    const qLen = Array.from(q).length;
    for (let b = 0; b < this.folded.length; b++) {
      const fb = this.folded[b]!;
      if (fb.folded.length === 0) continue;
      let idx = fb.folded.indexOf(q);
      while (idx !== -1) {
        const charStart = Array.from(fb.folded.slice(0, idx)).length;
        const end = fb.foldToOrig[charStart + qLen - 1]! + 1;
        matches.push({ blockIndex: b, start: fb.foldToOrig[charStart]!, end });
        if (matches.length >= MAX_MATCHES) return matches;
        // Advance one code point past the match start (allows overlapping
        // matches, mirroring Rust's next_start = start + len_utf8).
        const cp = fb.folded.codePointAt(idx);
        const step = cp !== undefined && cp > 0xffff ? 2 : 1;
        const next = idx + step;
        if (next >= fb.folded.length) break;
        idx = fb.folded.indexOf(q, next);
      }
    }
    return matches;
  }

  blockHighlights(query: string, blockIndex: number): HighlightRange[] {
    const q = normalizeQuery(query);
    if (q === '') return [];
    const fb = this.folded[blockIndex];
    if (!fb || fb.folded.length === 0) return [];
    const ranges: HighlightRange[] = [];
    const qLen = Array.from(q).length;
    let idx = fb.folded.indexOf(q);
    while (idx !== -1) {
      const charStart = Array.from(fb.folded.slice(0, idx)).length;
      const end = fb.foldToOrig[charStart + qLen - 1]! + 1;
      ranges.push({ start: fb.foldToOrig[charStart]!, end });
      const cp = fb.folded.codePointAt(idx);
      const step = cp !== undefined && cp > 0xffff ? 2 : 1;
      const next = idx + step;
      if (next >= fb.folded.length) break;
      idx = fb.folded.indexOf(q, next);
    }
    return ranges;
  }

  highlightRanges(query: string): Map<number, HighlightRange[]> {
    const map = new Map<number, HighlightRange[]>();
    for (let b = 0; b < this.folded.length; b++) {
      const ranges = this.blockHighlights(query, b);
      if (ranges.length > 0) map.set(b, ranges);
    }
    return map;
  }
}

export function normalizeQuery(query: string): string {
  return foldText(query).folded.replace(/\s+/g, ' ').trim();
}

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
  let folded = '';
  const foldToOrig: number[] = [];
  let prevWasSpace = false;
  for (let i = 0; i < text.length;) {
    const cp = text.codePointAt(i)!;
    const ch = String.fromCodePoint(cp);
    const lc = ch
      .toLowerCase()
      .normalize('NFKD')
      .replace(/[\u0300-\u036f]/g, '');
    for (let k = 0; k < lc.length; k++) {
      const c = lc[k]!;
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
    i += ch.length;
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

class TsSearchIndexImpl implements SearchIndex {
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
    const matches: SearchMatch[] = [];
    for (let b = 0; b < this.folded.length; b++) {
      const fb = this.folded[b]!;
      if (fb.folded.length === 0) continue;
      let idx = fb.folded.indexOf(q);
      while (idx !== -1) {
        const end = fb.foldToOrig[idx + q.length - 1]! + 1;
        matches.push({ blockIndex: b, start: fb.foldToOrig[idx]!, end });
        if (matches.length >= MAX_MATCHES) return matches;
        idx = fb.folded.indexOf(q, idx + 1);
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
    let idx = fb.folded.indexOf(q);
    while (idx !== -1) {
      const end = fb.foldToOrig[idx + q.length - 1]! + 1;
      ranges.push({ start: fb.foldToOrig[idx]!, end });
      idx = fb.folded.indexOf(q, idx + 1);
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

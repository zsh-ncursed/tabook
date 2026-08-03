import type { Block } from '../formats/model.js';
import { blockToPlainText } from '../renderer/blocks.js';
import type { HighlightRange } from '../renderer/layout.js';

export interface SearchMatch {
  blockIndex: number;
  start: number;
  end: number;
}

const MAX_MATCHES = 10000;

export class BookSearchIndex {
  private readonly blockTexts: string[];

  constructor(blocks: Block[]) {
    this.blockTexts = blocks.map((block) => blockToPlainText(block).toLowerCase());
  }

  get blockCount(): number {
    return this.blockTexts.length;
  }

  search(query: string): SearchMatch[] {
    const q = normalizeQuery(query);
    if (q === '') return [];
    const matches: SearchMatch[] = [];
    for (let b = 0; b < this.blockTexts.length; b++) {
      const text = this.blockTexts[b]!;
      if (text.length === 0) continue;
      let idx = text.indexOf(q);
      while (idx !== -1) {
        matches.push({ blockIndex: b, start: idx, end: idx + q.length });
        if (matches.length >= MAX_MATCHES) return matches;
        idx = text.indexOf(q, idx + 1);
      }
    }
    return matches;
  }

  highlightRanges(query: string): Map<number, HighlightRange[]> {
    const q = normalizeQuery(query);
    const map = new Map<number, HighlightRange[]>();
    if (q === '') return map;
    for (let b = 0; b < this.blockTexts.length; b++) {
      const text = this.blockTexts[b]!;
      if (text.length === 0) continue;
      const ranges: HighlightRange[] = [];
      let idx = text.indexOf(q);
      while (idx !== -1) {
        ranges.push({ start: idx, end: idx + q.length });
        idx = text.indexOf(q, idx + 1);
      }
      if (ranges.length > 0) map.set(b, ranges);
    }
    return map;
  }

  blockHas(query: string, blockIndex: number): boolean {
    const q = normalizeQuery(query);
    if (q === '') return false;
    return this.blockTexts[blockIndex]!.includes(q);
  }
}

export function normalizeQuery(query: string): string {
  return query.toLowerCase().replace(/\s+/g, ' ').trim();
}

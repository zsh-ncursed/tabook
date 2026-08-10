import type { Block } from '../formats/model.js';
import { blockToPlainText } from '../renderer/blocks.js';
import type { HighlightRange } from '../renderer/layout.js';

export interface SearchMatch {
  blockIndex: number;
  start: number;
  end: number;
}

const MAX_MATCHES = 10000;

interface FoldedBlock {
  // Block text folded char-by-char. toLowerCase() can change the string
  // length (e.g. '\u0130' → 'i\u0307'), so a naive toLowerCase() of the whole text
  // would produce offsets that no longer point into the original text.
  folded: string;
  // For every position in `folded`, the **code-point index** (in the original
  // block text) of the character it came from.  We iterate the original text
  // by code points so that astral characters (emoji, CJK extensions) count as
  // exactly one index — matching the renderer / layout.ts convention.
  foldToOrig: number[];
}

function foldText(text: string): FoldedBlock {
  let folded = '';
  const foldToOrig: number[] = [];
  let cpIndex = 0;
  for (const ch of text) {
    // Lowercase, decompose, then strip combining marks: '\u0130' folds to 'i' (not
    // 'i\u0307'), so 'istanbul' matches '\u0130stanbul' and fold lengths stay stable.
    const lc = ch
      .toLowerCase()
      .normalize('NFKD')
      .replace(/[\u0300-\u036f]/g, '');
    folded += lc;
    for (let k = 0; k < lc.length; k++) foldToOrig.push(cpIndex);
    cpIndex += 1;
  }
  return { folded, foldToOrig };
}

export class BookSearchIndex {
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
        // Map the folded match back to original-text coordinates.
        const end = fb.foldToOrig[idx + q.length - 1]! + 1;
        matches.push({ blockIndex: b, start: fb.foldToOrig[idx]!, end });
        if (matches.length >= MAX_MATCHES) return matches;
        idx = fb.folded.indexOf(q, idx + 1);
      }
    }
    return matches;
  }

  /**
   * Highlight ranges for a single block, computed on demand. The reader
   * only lays out a few blocks at a time, so this avoids scanning every
   * block just to highlight the visible page.
   */
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
  // Fold with the same per-character rules used for block text, then collapse
  // whitespace. Folding here keeps '\u0130' → 'i' consistent with block folding.
  return foldText(query).folded.replace(/\s+/g, ' ').trim();
}
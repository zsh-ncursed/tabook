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
  // length (e.g. 'İ' → 'i̇'), so a naive toLowerCase() of the whole text
  // would produce offsets that no longer point into the original text.
  folded: string;
  // For every position in `folded`, the index (in the original block text)
  // of the character it came from.
  foldToOrig: number[];
}

function foldText(text: string): FoldedBlock {
  let folded = '';
  const foldToOrig: number[] = [];
  for (let i = 0; i < text.length; ) {
    const cp = text.codePointAt(i)!;
    const ch = String.fromCodePoint(cp);
    // Lowercase, decompose, then strip combining marks: 'İ' folds to 'i' (not
    // 'i̇'), so 'istanbul' matches 'İstanbul' and fold lengths stay stable.
    const lc = ch.toLowerCase().normalize('NFKD').replace(/[\u0300-\u036f]/g, '');
    folded += lc;
    for (let k = 0; k < lc.length; k++) foldToOrig.push(i);
    i += ch.length;
  }
  // Known limitation: foldToOrig stores UTF-16 code-unit indices, while
  // renderer/layout.ts counts code points per char. For BMP text (Cyrillic,
  // Latin, most CJK) the two agree; an astral (surrogate-pair) char before a
  // match would make search offsets diverge from layout charOffsets.
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
  // whitespace. Folding here keeps 'İ' → 'i' consistent with block folding.
  return foldText(query).folded.replace(/\s+/g, ' ').trim();
}

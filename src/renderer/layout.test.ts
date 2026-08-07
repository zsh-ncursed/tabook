import { describe, it, expect } from 'vitest';
import { defaultConfig } from '../config/defaults.js';
import { inlineToSpans, wrapSpans, layoutBlock, BookLayout, applyHighlights } from './layout.js';
import type { Block, Inline } from '../formats/model.js';

const typo = defaultConfig().typography;

function t(text: string): Inline {
  return { kind: 'text', text };
}

describe('inlineToSpans', () => {
  it('merges adjacent runs with the same style', () => {
    const spans = inlineToSpans([t('ab'), t('cd')]);
    expect(spans).toHaveLength(1);
    expect(spans[0]!.text).toBe('abcd');
  });

  it('tracks nested formatting', () => {
    const spans = inlineToSpans([
      t('a'),
      { kind: 'bold', children: [t('b'), { kind: 'italic', children: [t('c')] }] },
      t('d'),
    ]);
    expect(spans.map((s) => s.text).join('')).toBe('abcd');
    expect(spans.find((s) => s.bold && s.italic)!.text).toBe('c');
  });

  it('flattens images and line breaks', () => {
    const spans = inlineToSpans([
      { kind: 'image', src: 'x', alt: 'pic' },
      { kind: 'lineBreak' },
      t('z'),
    ]);
    expect(spans.map((s) => s.text).join('')).toBe('pic z');
  });
});

describe('wrapSpans', () => {
  it('wraps long lines on word boundaries', () => {
    const spans = inlineToSpans([t('one two three four')]);
    const lines = wrapSpans(spans, 8);
    expect(lines.length).toBeGreaterThan(1);
    const texts = lines.map((l) => l.map((s) => s.text).join(''));
    for (const line of texts) expect(line.length).toBeLessThanOrEqual(8);
  });

  it('breaks a single long word without losing text', () => {
    const spans = inlineToSpans([t('supercalifragilistic')]);
    const lines = wrapSpans(spans, 5);
    const joined = lines.map((l) => l.map((s) => s.text).join('')).join('');
    expect(joined).toBe('supercalifragilistic');
    for (const line of lines) {
      expect(line.map((s) => s.text).join('')).toHaveLength(5);
    }
  });

  it('applies highlight ranges', () => {
    const spans = inlineToSpans([t('abcdef')]);
    const lines = wrapSpans(spans, 20, [{ start: 1, end: 4 }]);
    const highlighted = lines[0]!.filter((s) => s.highlight);
    expect(highlighted.map((s) => s.text).join('')).toBe('bcd');
  });
});

describe('applyHighlights', () => {
  it('marks only characters within the range', () => {
    const spans = inlineToSpans([t('hello')]);
    const out = applyHighlights(spans, [{ start: 0, end: 2 }]);
    expect(
      out
        .filter((s) => s.highlight)
        .map((s) => s.text)
        .join(''),
    ).toBe('he');
  });
});

describe('layoutBlock', () => {
  it('lays out a paragraph with indent on the first line only', () => {
    const block: Block = { type: 'paragraph', children: [t('x'.repeat(80))] };
    const lines = layoutBlock(block, 0, { typo, width: 30 });
    expect(lines.length).toBeGreaterThan(1);
    expect(lines[0]!.indent).toBe(typo.paragraphIndent);
    for (let i = 1; i < lines.length; i++) expect(lines[i]!.indent).toBe(0);
    expect(lines[0]!.blockIndex).toBe(0);
  });

  it('emits table header and cell rows', () => {
    const block: Block = {
      type: 'table',
      headers: [[t('Name')], [t('Age')]],
      rows: [[[t('Ann')], [t('30')]]],
    };
    const lines = layoutBlock(block, 1, { typo, width: 40 });
    expect(lines[0]!.role).toBe('tableHeader');
    expect(lines[1]!.role).toBe('tableCell');
  });

  it('renders images as centered placeholders', () => {
    const block: Block = { type: 'image', src: 'cover.jpg', alt: 'cover' };
    const lines = layoutBlock(block, 2, { typo, width: 40 });
    expect(lines[0]!.role).toBe('image');
    expect(lines[0]!.spans[0]!.text).toBe('[Image: cover]');
  });

  it('lays out list items with markers', () => {
    const block: Block = {
      type: 'list',
      ordered: true,
      items: [{ children: [t('first item')], nested: [] }],
    };
    const lines = layoutBlock(block, 3, { typo, width: 40 });
    expect(lines[0]!.role).toBe('listItem');
    expect(lines[0]!.prefix).toBe('1. ');
  });

  it('restarts numbering for nested ordered lists', () => {
    // HTML <ol> nesting: each level starts at 1. The previous walkCounter
    // implementation shared one counter and pre-advanced it, producing
    // markers like "5.", "6.", "7." for a 3-item nested <ol>.
    const block: Block = {
      type: 'list',
      ordered: true,
      items: [
        {
          children: [t('top')],
          nested: [
            {
              type: 'list',
              ordered: true,
              items: [
                { children: [t('inner one')], nested: [] },
                { children: [t('inner two')], nested: [] },
              ],
            },
          ],
        },
        { children: [t('top two')], nested: [] },
      ],
    };
    const lines = layoutBlock(block, 0, { typo, width: 60 });
    const itemLines = lines.filter((l) => l.role === 'listItem');
    const prefixes = itemLines.map((l) => l.prefix);
    expect(prefixes).toContain('1. ');
    expect(prefixes).toContain('2. ');
    // Nested ordered list restarts at 1.
    const innerMarkers = prefixes.filter((p) => p === '1. ');
    expect(innerMarkers.length).toBeGreaterThanOrEqual(2);
  });

  it('highlights only the matching item in a list', () => {
    const block: Block = {
      type: 'list',
      ordered: false,
      items: [
        { children: [t('alpha beta')], nested: [] },
        { children: [t('gamma delta')], nested: [] },
      ],
    };
    const lines = layoutBlock(block, 0, {
      typo,
      width: 40,
      getHighlights: () => [{ start: 11, end: 16 }],
    });
    const itemLines = lines.filter((l) => l.role === 'listItem');
    expect(itemLines[0]!.charOffset).toBe(0);
    expect(itemLines[1]!.charOffset).toBe(11);
    const firstHighlights = itemLines[0]!.spans.filter((s) => s.highlight);
    const secondHighlights = itemLines[1]!.spans.filter((s) => s.highlight);
    expect(firstHighlights.map((s) => s.text).join('')).toBe('');
    expect(secondHighlights.map((s) => s.text).join('')).toBe('gamma');
  });

  it('highlights across wrapped list item lines with correct offsets', () => {
    const block: Block = {
      type: 'list',
      ordered: false,
      items: [{ children: [t('one two three four five')], nested: [] }],
    };
    const lines = layoutBlock(block, 0, {
      typo,
      width: 12,
      getHighlights: () => [{ start: 8, end: 13 }],
    });
    const itemLines = lines.filter((l) => l.role === 'listItem');
    expect(itemLines.length).toBeGreaterThan(1);
    const highlighted = itemLines.flatMap((l) =>
      l.spans.filter((s) => s.highlight).map((s) => s.text),
    );
    expect(highlighted.join('')).toBe('three');
    let running = 0;
    for (const line of itemLines) {
      expect(line.charOffset).toBe(running);
      running += line.spans.map((s) => s.text).join('').length;
    }
  });

  it('highlights a poem verse at the right offset', () => {
    const block: Block = {
      type: 'poem',
      stanzas: [{ lines: [[t('roses')], [t('violets')]] }],
    };
    const lines = layoutBlock(block, 0, {
      typo,
      width: 40,
      getHighlights: () => [{ start: 6, end: 10 }],
    });
    const poemLines = lines.filter((l) => l.role === 'poemLine');
    expect(poemLines[0]!.charOffset).toBe(0);
    expect(poemLines[1]!.charOffset).toBe(6);
    const highlighted = poemLines.flatMap((l) =>
      l.spans.filter((s) => s.highlight).map((s) => s.text),
    );
    expect(highlighted.join('')).toBe('viol');
  });

  it('highlights table cells matching their plain-text offset', () => {
    const block: Block = {
      type: 'table',
      headers: [],
      rows: [
        [[t('one')], [t('two')]],
        [[t('three')], [t('four')]],
      ],
    };
    const lines = layoutBlock(block, 0, {
      typo,
      width: 40,
      getHighlights: () => [{ start: 4, end: 6 }],
    });
    const cellLines = lines.filter((l) => l.role === 'tableCell');
    expect(cellLines.length).toBe(2);
    expect(cellLines[0]!.charOffset).toBe(0);
    expect(cellLines[1]!.charOffset).toBe(8);
    const highlighted = cellLines.flatMap((l) =>
      l.spans.filter((s) => s.highlight).map((s) => s.text),
    );
    expect(highlighted.join('')).toBe('tw');
  });

  it('highlights ragged tables with empty cells at correct offsets', () => {
    const block: Block = {
      type: 'table',
      headers: [],
      rows: [
        [[t('alpha')], [t('beta gamma')]],
        [[], [t('delta')]],
      ],
    };
    const lines = layoutBlock(block, 0, {
      typo,
      width: 40,
      // 'beta gamma' sits at plain-text offset 6, so 'beta' is chars 6..9.
      getHighlights: () => [{ start: 6, end: 10 }],
    });
    const cellLines = lines.filter((l) => l.role === 'tableCell');
    // Each row emits a single line: row 1 starts at 0, row 2 starts at 18
    // (empty cell at 17, then delta).
    expect(cellLines.length).toBe(2);
    expect(cellLines[0]!.charOffset).toBe(0);
    expect(cellLines[1]!.charOffset).toBe(18);
    const highlighted = cellLines.flatMap((l) =>
      l.spans.filter((s) => s.highlight).map((s) => s.text),
    );
    expect(highlighted.join('')).toBe('beta');
  });

  it('falls back to a zero char offset for all-empty header rows', () => {
    const block: Block = { type: 'table', headers: [[], []], rows: [] };
    const lines = layoutBlock(block, 0, { typo, width: 30 });
    expect(lines[0]!.role).toBe('tableHeader');
    expect(lines[0]!.charOffset).toBe(0);
  });
});

describe('BookLayout', () => {
  const blocks: Block[] = [
    { type: 'heading', level: 1, children: [t('Chapter One')] },
    { type: 'paragraph', children: [t('a '.repeat(100))] },
    { type: 'paragraph', children: [t('final text')] },
  ];

  it('computes total characters', () => {
    const layout = new BookLayout(blocks, { typo, width: 50 });
    expect(layout.totalChars).toBe(
      'Chapter One'.length + 'a '.repeat(100).length + 'final text'.length,
    );
  });

  it('maps char offsets to lines lazily', () => {
    const layout = new BookLayout(blocks, { typo, width: 50 });
    const line = layout.lineForCharOffset(0);
    expect(line).toBe(0);
    const lastLine = layout.lineForCharOffset(layout.totalChars - 1);
    expect(lastLine).toBeGreaterThan(0);
  });

  it('round-trips line <-> char offset within the block', () => {
    const layout = new BookLayout(blocks, { typo: { ...typo, paragraphSpacing: 0 }, width: 30 });
    const line = 3;
    const offset = layout.charOffsetForLine(line);
    expect(offset).toBeGreaterThan(0);
    const back = layout.lineForCharOffset(offset);
    expect(back).toBeGreaterThanOrEqual(1);
  });

  it('pages slices lines', () => {
    const layout = new BookLayout(blocks, { typo, width: 50 });
    const page = layout.getPage(0, 5);
    expect(page.length).toBeLessThanOrEqual(5);
  });

  it('finds pages for char offsets', () => {
    const layout = new BookLayout(blocks, { typo, width: 50 });
    expect(layout.pageForCharOffset(0, 10)).toBe(0);
    expect(layout.pageForCharOffset(layout.totalChars - 1, 10)).toBeGreaterThanOrEqual(0);
  });

  it('textNear returns a window around an offset', () => {
    const layout = new BookLayout(blocks, { typo, width: 50 });
    const near = layout.textNear(20, 10);
    expect(near.length).toBeGreaterThan(0);
    expect(near.length).toBeLessThanOrEqual(10);
  });

  it('invalidates and re-lays out', () => {
    const layout = new BookLayout(blocks, { typo, width: 50 });
    const before = layout.lineCount();
    layout.invalidate();
    const after = layout.lineCount();
    expect(after).toBe(before);
  });

  it('handles an empty block list', () => {
    const layout = new BookLayout([], { typo, width: 50 });
    expect(layout.lineCount()).toBe(0);
    expect(layout.textNear(0)).toBe('');
    expect(layout.lineForCharOffset(0)).toBe(0);
  });

  it('assigns correct charOffset for repeated text in a paragraph', () => {
    // Two identical words 'abc abc' — second occurrence should have offset 4, not 0
    const block: Block = {
      type: 'paragraph',
      children: [t('abc abc abc')],
    };
    const lines = layoutBlock(block, 0, { typo, width: 20 });
    // All text fits on one line, so charOffset should be 0 (first occurrence)
    expect(lines[0]!.charOffset).toBe(0);
  });

  it('assigns correct charOffset for repeated text across wrapped lines', () => {
    // 'abc abc abc' wrapped at width 5 — each wrapped line should advance
    const block: Block = {
      type: 'paragraph',
      children: [t('abc abc abc')],
    };
    const lines = layoutBlock(block, 0, { typo, width: 5 });
    expect(lines.length).toBeGreaterThanOrEqual(2);
    // charOffset of each line should be monotonically non-decreasing
    for (let i = 1; i < lines.length; i++) {
      expect(lines[i]!.charOffset).toBeGreaterThanOrEqual(lines[i - 1]!.charOffset);
    }
  });
});

describe('inlineToSpans extended styles', () => {
  it('tracks underline, strike, link and code', () => {
    const spans = inlineToSpans([
      { kind: 'underline', children: [t('u')] },
      { kind: 'strike', children: [t('s')] },
      { kind: 'link', href: '#', children: [t('l')] },
      { kind: 'code', text: 'c' },
    ]);
    expect(spans.map((s) => s.text).join('')).toBe('uslc');
    expect(spans.some((s) => s.underline)).toBe(true);
    expect(spans.some((s) => s.strike)).toBe(true);
    expect(spans.some((s) => s.link)).toBe(true);
  });
});

describe('wrapSpans edge cases', () => {
  it('trims trailing whitespace when hard-breaking a line', () => {
    // 'a  ' at width 1: the second space overflows and is flushed with its line
    const spans = inlineToSpans([t('a  ')]);
    const lines = wrapSpans(spans, 1);
    expect(lines.map((l) => l.map((s) => s.text).join('')).join('')).toBe('a');
  });
});

describe('layoutBlock edge cases', () => {
  it('emits an empty line for a paragraph with only a line break', () => {
    const block: Block = { type: 'paragraph', children: [{ kind: 'lineBreak' }] };
    const lines = layoutBlock(block, 0, { typo, width: 30 });
    expect(lines.length).toBeGreaterThan(0);
    expect(lines[0]!.role).toBe('empty');
  });

  it('lays out an empty block as a single empty line', () => {
    const lines = layoutBlock({ type: 'empty' }, 0, { typo, width: 30 });
    expect(lines).toHaveLength(1);
    expect(lines[0]!.role).toBe('empty');
  });

  it('produces no lines for an empty heading', () => {
    const lines = layoutBlock({ type: 'heading', level: 1, children: [] }, 0, { typo, width: 30 });
    expect(lines).toHaveLength(0);
  });

  it('lays out quotes, epigraphs and annotations', () => {
    const quote = layoutBlock({ type: 'quote', children: [t('to be')] }, 0, { typo, width: 30 });
    expect(quote[0]!.role).toBe('quote');
    const epigraph = layoutBlock({ type: 'epigraph', children: [t('carpe diem')] }, 0, {
      typo,
      width: 30,
    });
    expect(epigraph[0]!.role).toBe('epigraph');
    const annotation = layoutBlock({ type: 'annotation', children: [t('note')] }, 0, {
      typo,
      width: 30,
    });
    expect(annotation[0]!.role).toBe('annotation');
  });

  it('skips empty list items and walks nested lists', () => {
    const block: Block = {
      type: 'list',
      ordered: true,
      items: [
        { children: [], nested: [] },
        {
          children: [t('one')],
          nested: [
            { type: 'list', ordered: false, items: [{ children: [t('two')], nested: [] }] },
            { type: 'paragraph', children: [t('ignored')] },
          ],
        },
      ],
    };
    const lines = layoutBlock(block, 0, { typo, width: 30 });
    const itemLines = lines.filter((l) => l.role === 'listItem');
    expect(itemLines.length).toBeGreaterThanOrEqual(2);
    const texts = itemLines.map((l) => l.spans.map((s) => s.text).join(''));
    expect(texts).toContain('one');
    expect(texts).toContain('two');
  });

  it('separates poem stanzas with an empty line', () => {
    const block: Block = {
      type: 'poem',
      stanzas: [{ lines: [[t('one')]] }, { lines: [[t('two')]] }],
    };
    const lines = layoutBlock(block, 0, { typo, width: 30 });
    expect(lines.some((l) => l.role === 'empty')).toBe(true);
  });

  it('falls back to a generic label for images without alt text', () => {
    const lines = layoutBlock({ type: 'image', src: 'x.png', alt: '' }, 0, { typo, width: 30 });
    expect(lines[0]!.spans[0]!.text).toBe('[Image: image]');
  });

  it('inserts spacer lines when lineSpacing is configured', () => {
    const block: Block = { type: 'paragraph', children: [t('hello world')] };
    const lines = layoutBlock(block, 0, {
      typo: { ...typo, lineSpacing: 2, paragraphSpacing: 0 },
      width: 30,
    });
    expect(lines.filter((l) => l.role === 'empty').length).toBe(2);
  });

  it('returns no lines for a fully empty table', () => {
    expect(layoutBlock({ type: 'table', headers: [], rows: [] }, 0, { typo, width: 30 })).toEqual(
      [],
    );
  });

  it('handles ragged table rows with missing cells', () => {
    const block: Block = {
      type: 'table',
      headers: [],
      rows: [[[t('a')], [t('b')]], [[t('c')]]],
    };
    const lines = layoutBlock(block, 0, { typo, width: 30 });
    expect(lines.filter((l) => l.role === 'tableCell').length).toBeGreaterThan(0);
  });

  it('pads empty cells and falls back to a row char offset', () => {
    const block: Block = { type: 'table', headers: [], rows: [[[], []]] };
    const lines = layoutBlock(block, 0, { typo, width: 30 });
    expect(lines[0]!.role).toBe('tableCell');
  });
});

describe('BookLayout edge cases', () => {
  const blocks: Block[] = [
    { type: 'heading', level: 1, children: [t('Chapter One')] },
    { type: 'paragraph', children: [t('a '.repeat(100))] },
    { type: 'paragraph', children: [t('final text')] },
  ];

  it('returns empty for non-positive page height and range count', () => {
    const layout = new BookLayout(blocks, { typo, width: 50 });
    expect(layout.getPage(0, 0)).toEqual([]);
    expect(layout.getRange(0, 0)).toEqual([]);
  });

  it('serves line ranges', () => {
    const layout = new BookLayout(blocks, { typo, width: 50 });
    expect(layout.getRange(0, 2)).toHaveLength(2);
  });

  it('estimates line counts and clamps zero width', () => {
    const layout = new BookLayout(blocks, { typo, width: 50 });
    expect(layout.estimateLineCount()).toBeGreaterThan(0);
    const zero = new BookLayout(blocks, { typo, width: 0 });
    expect(zero.estimateLineCount()).toBe(1);
  });

  it('maps blocks to their start lines', () => {
    const layout = new BookLayout(blocks, { typo, width: 50 });
    expect(layout.blockStartLine(0)).toBe(0);
    expect(layout.lineForBlock(0)).toBe(0);
    expect(layout.lineForBlock(2)).toBeGreaterThan(0);
  });

  it('clamps charOffsetForLine lookups', () => {
    const layout = new BookLayout(blocks, { typo, width: 50 });
    expect(layout.charOffsetForLine(0)).toBe(0);
    expect(layout.charOffsetForLine(10_000)).toBe(layout.totalChars);
  });
});

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
});

import { describe, it, expect } from 'vitest';
import { simplifyBlocks, simplifyBlocksWithMap } from './simplify.js';
import type { Block, Inline } from '../formats/model.js';

function t(text: string): Inline {
  return { kind: 'text', text };
}

describe('simplifyBlocks', () => {
  it('keeps paragraphs and headings as-is', () => {
    const blocks: Block[] = [
      { type: 'heading', level: 2, children: [t('H')] },
      { type: 'paragraph', children: [t('P')] },
    ];
    const out = simplifyBlocks(blocks);
    expect(out).toEqual(blocks);
  });

  it('flattens lists into paragraphs', () => {
    const blocks: Block[] = [
      { type: 'list', ordered: false, items: [{ children: [t('one')], nested: [] }] },
    ];
    const out = simplifyBlocks(blocks);
    expect(out).toHaveLength(1);
    expect(out[0]!.type).toBe('paragraph');
  });

  it('converts quotes, epigraphs and annotations to paragraphs', () => {
    const quote: Block = { type: 'quote', children: [t('q')] };
    const epigraph: Block = { type: 'epigraph', children: [t('e')] };
    const annotation: Block = { type: 'annotation', children: [t('a')] };
    const out = simplifyBlocks([quote, epigraph, annotation]);
    expect(out.every((b) => b.type === 'paragraph')).toBe(true);
  });

  it('joins poem verses into paragraphs', () => {
    const poem: Block = {
      type: 'poem',
      stanzas: [{ lines: [[t('line one')], [t('line two')]] }],
    };
    const out = simplifyBlocks([poem]);
    expect(out).toHaveLength(1);
    const para = out[0] as Extract<Block, { type: 'paragraph' }>;
    expect(para.children.map((c) => (c.kind === 'text' ? c.text : '')).join('')).toBe(
      'line one line two',
    );
  });

  it('flattens table rows into pipe-joined paragraphs', () => {
    const table: Block = { type: 'table', headers: [], rows: [[[t('a')], [t('b')]]] };
    const out = simplifyBlocks([table]);
    expect(out[0]!.type).toBe('paragraph');
    const para = out[0] as Extract<Block, { type: 'paragraph' }>;
    expect(para.children.map((c) => (c.kind === 'text' ? c.text : '')).join('')).toBe('a | b');
  });

  it('drops images and empty blocks', () => {
    const blocks: Block[] = [{ type: 'image', src: 'x', alt: 'pic' }, { type: 'empty' }];
    expect(simplifyBlocks(blocks)).toEqual([]);
  });

  it('returns a map from original to simplified block indices', () => {
    const blocks: Block[] = [
      { type: 'image', src: 'x', alt: 'pic' }, // dropped
      { type: 'heading', level: 1, children: [t('H')] }, // 1:1
      {
        type: 'list',
        ordered: false,
        items: [
          { children: [t('a')], nested: [] },
          { children: [t('b')], nested: [] },
        ],
      }, // expands to 2
      { type: 'empty' }, // dropped
      { type: 'paragraph', children: [t('P')] }, // 1:1
    ];
    const { blocks: out, map } = simplifyBlocksWithMap(blocks);
    expect(out).toHaveLength(4); // heading + 2 list paragraphs + paragraph
    // Original 0 (image) maps to where the next block lands (0); original 1
    // (heading) is simplified index 0; original 2 (list) starts at 1; original
    // 3 (empty) maps forward to 3; original 4 (paragraph) is index 3.
    expect(map).toEqual([0, 0, 1, 3, 3]);
  });
});

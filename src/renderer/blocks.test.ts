import { describe, it, expect } from 'vitest';
import { blockToPlainText } from './blocks.js';
import type { Block, Inline } from '../formats/model.js';

function t(text: string): Inline {
  return { kind: 'text', text };
}

describe('blockToPlainText', () => {
  it('flattens nested inline styles', () => {
    const block: Block = {
      type: 'paragraph',
      children: [
        t('A '),
        { kind: 'bold', children: [{ kind: 'italic', children: [t('B')] }] },
        { kind: 'link', href: '#', children: [t(' C')] },
        { kind: 'code', text: ' D' },
      ],
    };
    expect(blockToPlainText(block)).toBe('A B C D');
  });

  it('joins list items with newlines', () => {
    const block: Block = {
      type: 'list',
      ordered: true,
      items: [
        { children: [t('one')], nested: [] },
        { children: [t('two')], nested: [] },
      ],
    };
    expect(blockToPlainText(block)).toBe('one\ntwo');
  });

  it('flattens tables and poems', () => {
    const table: Block = { type: 'table', headers: [], rows: [[[t('x')], [t('y')]]] };
    expect(blockToPlainText(table)).toBe('x y');
    const poem: Block = { type: 'poem', stanzas: [{ lines: [[t('a')], [t('b')]] }] };
    expect(blockToPlainText(poem)).toBe('a\nb');
  });

  it('returns alt text for images and empty string for empty blocks', () => {
    expect(blockToPlainText({ type: 'image', src: 'x', alt: 'cover' })).toBe('cover');
    expect(blockToPlainText({ type: 'empty' })).toBe('');
  });
});

describe('blockToPlainText edge cases', () => {
  it('flattens inline images and line breaks', () => {
    const block: Block = {
      type: 'paragraph',
      children: [{ kind: 'image', src: 'x.png', alt: 'pic' }, { kind: 'lineBreak' }, t('tail')],
    };
    expect(blockToPlainText(block)).toBe('pic tail');
  });

  it('skips empty items and flattens nested lists', () => {
    const block: Block = {
      type: 'list',
      ordered: false,
      items: [
        { children: [], nested: [] },
        {
          children: [t('top')],
          nested: [
            { type: 'list', ordered: true, items: [{ children: [t('sub')], nested: [] }] },
            { type: 'paragraph', children: [] },
          ],
        },
      ],
    };
    expect(blockToPlainText(block)).toBe('top\nsub');
  });
});

import { describe, it, expect } from 'vitest';
import { parseInlines, plainOf, normalizeInlines, decodeTextRaw } from './inline.js';
import { parseXml } from './xml.js';

function xmlToInlines(xml: string) {
  return parseInlines(parseXml(xml)[0]);
}

describe('parseInlines', () => {
  it('parses text and style tags', () => {
    const inlines = xmlToInlines('<p>a<strong>b</strong><em>c</em></p>');
    expect(plainOf(inlines)).toBe('abc');
    expect(inlines[1]).toMatchObject({ kind: 'bold' });
    expect(inlines[2]).toMatchObject({ kind: 'italic' });
  });

  it('maps anchor tags to links', () => {
    const inlines = xmlToInlines('<p><a href="#x">go</a></p>');
    expect(inlines[0]).toMatchObject({ kind: 'link', href: '#x' });
  });

  it('parses images with href and alt', () => {
    const inlines = xmlToInlines('<p><image href="#i1" alt="pic"/></p>');
    expect(inlines[0]).toEqual({ kind: 'image', src: '#i1', alt: 'pic' });
  });

  it('treats br as a line break', () => {
    const inlines = xmlToInlines('<p>a<br/>b</p>');
    expect(inlines.map((i) => i.kind)).toEqual(['text', 'lineBreak', 'text']);
  });

  it('flattens code tags to plain code', () => {
    const inlines = xmlToInlines('<p><code>const x = 1</code></p>');
    expect(inlines[0]).toEqual({ kind: 'code', text: 'const x = 1' });
  });

  it('accepts an undefined node', () => {
    expect(parseInlines(undefined)).toEqual([]);
  });
});

describe('normalizeInlines', () => {
  it('collapses whitespace and drops empty text', () => {
    const inlines = normalizeInlines([
      { kind: 'text', text: '  a\n\t b  ' },
      { kind: 'text', text: '   ' },
    ]);
    expect(plainOf(inlines)).toBe('a b');
  });

  it('keeps line breaks and drops empty styled nodes', () => {
    const inlines = normalizeInlines([
      { kind: 'lineBreak' },
      { kind: 'bold', children: [{ kind: 'text', text: '   ' }] },
    ]);
    expect(inlines).toHaveLength(1);
    expect(inlines[0]).toMatchObject({ kind: 'lineBreak' });
  });

  it('trims leading and trailing whitespace text runs', () => {
    const inlines = normalizeInlines([
      { kind: 'text', text: '  hello ' },
      { kind: 'text', text: ' world  ' },
    ]);
    expect(plainOf(inlines)).toBe('hello  world');
  });

  it('normalizes nested children', () => {
    const inlines = normalizeInlines([
      {
        kind: 'italic',
        children: [
          { kind: 'text', text: ' x ' },
          { kind: 'text', text: 'y ' },
        ],
      },
    ]);
    expect(plainOf(inlines)).toBe('x y');
  });
});

describe('decodeTextRaw', () => {
  it('decodes entities in strings', () => {
    expect(decodeTextRaw('a &amp; b')).toBe('a & b');
    expect(decodeTextRaw(42)).toBe('');
  });
});

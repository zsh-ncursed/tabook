import { describe, it, expect } from 'vitest';
import {
  parseXml,
  asXmlChildren,
  tagOf,
  childrenOf,
  findChildren,
  firstChild,
  hasChild,
  textOf,
  attributesOf,
  attrOf,
  asArray,
  directText,
  fullTextOf,
} from './xml.js';
import type { XmlNode } from './xml.js';

describe('parseXml', () => {
  it('returns an array of nodes', () => {
    const nodes = parseXml('<a><b>1</b></a>');
    expect(Array.isArray(nodes)).toBe(true);
    expect(tagOf(nodes[0]!)).toBe('a');
  });
});

describe('asXmlChildren', () => {
  it('wraps a single node and passes arrays through', () => {
    expect(asXmlChildren({ a: [] } as unknown)).toHaveLength(1);
    expect(asXmlChildren([{ a: [] }])).toHaveLength(1);
  });

  it('returns an empty array for nullish or primitive values', () => {
    expect(asXmlChildren(null)).toEqual([]);
    expect(asXmlChildren(undefined)).toEqual([]);
    expect(asXmlChildren('text' as unknown)).toEqual([]);
  });
});

describe('tagOf / childrenOf', () => {
  it('handles empty nodes and non-array children', () => {
    expect(tagOf({} as XmlNode)).toBe('');
    expect(childrenOf({ p: 'text' } as unknown as XmlNode)).toEqual([]);
  });
});

describe('findChildren / firstChild / hasChild', () => {
  it('finds children by normalized tag name', () => {
    const node = parseXml('<root><item>A</item><fb:item>B</fb:item></root>')[0]!;
    expect(findChildren(node, 'item')).toHaveLength(2);
  });

  it('handles undefined nodes and missing tags', () => {
    expect(firstChild(undefined, 'x')).toBeUndefined();
    const node = parseXml('<p><a>1</a></p>')[0]!;
    expect(firstChild(node, 'a')).toBeDefined();
    expect(firstChild(node, 'missing')).toBeUndefined();
    expect(hasChild(node, 'a')).toBe(true);
    expect(hasChild(node, 'z')).toBe(false);
  });
});

describe('textOf', () => {
  it('joins text nodes and decodes entities', () => {
    expect(textOf(parseXml('<p>a &amp; b</p>')[0]!)).toBe('a & b');
  });

  it('joins array-typed text values', () => {
    expect(textOf({ p: [{ '#text': ['x', 'y'] }] } as unknown as XmlNode)).toBe('xy');
  });

  it('returns empty for undefined nodes', () => {
    expect(textOf(undefined)).toBe('');
  });
});

describe('attributesOf / attrOf', () => {
  it('reads namespaced attributes with normalized names', () => {
    const img = parseXml('<img src="x.png" xml:lang="en"/>')[0]!;
    expect(attributesOf(img)).toEqual({ src: 'x.png', lang: 'en' });
    expect(attrOf(img, 'src')).toBe('x.png');
    expect(attrOf(img, 'lang')).toBe('en');
  });

  it('returns undefined for missing nodes and attributes', () => {
    expect(attrOf(undefined, 'src')).toBeUndefined();
    expect(attrOf(parseXml('<img/>')[0]!, 'src')).toBeUndefined();
  });
});

describe('asArray', () => {
  it('normalizes values to arrays', () => {
    expect(asArray(undefined)).toEqual([]);
    expect(asArray(null)).toEqual([]);
    expect(asArray('a')).toEqual(['a']);
    expect(asArray(['a', 'b'])).toEqual(['a', 'b']);
  });
});

describe('directText / fullTextOf', () => {
  it('returns direct text', () => {
    expect(directText(undefined)).toBe('');
    expect(directText(parseXml('<p>hi</p>')[0]!)).toBe('hi');
  });

  it('recurses into nested elements', () => {
    const nested = parseXml('<p>a<strong>b</strong>c</p>')[0]!;
    expect(fullTextOf(nested)).toBe('abc');
    expect(fullTextOf(undefined)).toBe('');
  });
});

describe('xml coverage edge cases', () => {
  it('reads attributes stored as child entries', () => {
    const node = { p: [{ '@_foo': 'bar' }, { '#text': 'hi' }] } as unknown as XmlNode;
    expect(attributesOf(node)).toEqual({ foo: 'bar' });
  });

  it('skips non-attribute keys in the attribute map', () => {
    const node = { p: [], ':@': { plain: 'x' } } as unknown as XmlNode;
    expect(attributesOf(node)).toEqual({});
  });

  it('handles empty and non-text children', () => {
    expect(textOf({ p: [{}] } as unknown as XmlNode)).toBe('');
    expect(textOf({ p: [{ '#text': 42 }] } as unknown as XmlNode)).toBe('');
    expect(textOf({ p: [{ other: 'x' }, { '#text': 'y' }] } as unknown as XmlNode)).toBe('y');
  });

  it('tolerates empty child objects in findChildren', () => {
    expect(findChildren({ root: [{}] } as unknown as XmlNode, 'x')).toEqual([]);
  });

  it('normalizes namespaced attribute and tag lookups', () => {
    const img = parseXml('<img src="x.png" xml:lang="en"/>')[0]!;
    expect(attrOf(img, 'xml:lang')).toBe('en');
    const node = { root: [{ 'fb:item': 'v' }] } as unknown as XmlNode;
    expect(findChildren(node, 'item')).toHaveLength(1);
  });

  it('joins array-typed text in fullTextOf', () => {
    expect(fullTextOf({ p: [{ '#text': ['a', 'b'] }] } as unknown as XmlNode)).toBe('ab');
    expect(fullTextOf({ p: [{ '#text': 42 }] } as unknown as XmlNode)).toBe('');
    expect(fullTextOf({ p: [{}] } as unknown as XmlNode)).toBe('');
  });
});

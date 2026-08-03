import { describe, it, expect } from 'vitest';
import { parseEpubBuffer } from './parser.js';
import { buildEpub, buildNcxEpub, makeBrokenZip } from '../test-utils.js';
import { ParseError } from '../../utils/errors.js';
import { joinAuthors } from '../model.js';

describe('EPUB parser', () => {
  it('parses metadata from the OPF', () => {
    const book = parseEpubBuffer(buildEpub(), '/tmp/book.epub');
    expect(book.format).toBe('epub');
    expect(book.metadata.title).toBe('Epub Book');
    expect(book.metadata.authors).toHaveLength(1);
    expect(joinAuthors(book.metadata.authors)).toContain('Jane Roe');
    expect(book.metadata.lang).toBe('en');
    expect(book.metadata.genres).toContain('Fiction');
    expect(book.metadata.annotation).toContain('compelling');
    expect(book.metadata.isbn).toBe('urn:isbn:9781234567890');
    expect(book.metadata.coverKey).toBe('OEBPS/images/cover.jpg');
  });

  it('parses spine content into blocks in order', () => {
    const book = parseEpubBuffer(buildEpub(), '/tmp/book.epub');
    const types = book.content.map((b) => b.type);
    expect(types).toContain('heading');
    expect(types).toContain('paragraph');
    expect(types).toContain('list');
    expect(types).toContain('quote');
    expect(types).toContain('table');
    expect(types).toContain('image');
    const firstHeading = book.content.findIndex((b) => b.type === 'heading');
    expect(firstHeading).toBe(0);
    const heading = book.content[0];
    if (heading && heading.type === 'heading') {
      expect(heading.level).toBe(1);
    }
  });

  it('builds TOC from the nav document with fragment resolution', () => {
    const book = parseEpubBuffer(buildEpub(), '/tmp/book.epub');
    const labels = book.toc.map((t) => t.label);
    expect(labels).toEqual(['Chapter One', 'Chapter Two', 'A Section']);
    expect(book.toc[0]!.blockIndex).toBe(0);
    expect(book.toc[2]!.level).toBe(2);
    const last = book.toc[2]!;
    expect(book.content[last.blockIndex]).toBeDefined();
  });

  it('builds TOC from NCX when present', () => {
    const book = parseEpubBuffer(buildNcxEpub(), '/tmp/ncx.epub');
    expect(book.metadata.title).toBe('Ncx Book');
    expect(book.toc.map((t) => t.label)).toEqual(['First Chapter']);
    expect(book.toc[0]!.blockIndex).toBe(0);
  });

  it('collects image resources', () => {
    const book = parseEpubBuffer(buildEpub(), '/tmp/book.epub');
    expect(book.resources.has('OEBPS/images/cover.jpg')).toBe(true);
  });

  it('rejects a non-zip epub', () => {
    expect(() => parseEpubBuffer(Buffer.from('not a zip'), '/tmp/x.epub')).toThrow(ParseError);
  });

  it('rejects a broken zip container', () => {
    expect(() => parseEpubBuffer(makeBrokenZip(), '/tmp/x.epub')).toThrow(ParseError);
  });
});

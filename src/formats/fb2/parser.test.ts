import { describe, it, expect } from 'vitest';
import { parseFb2Text, parseFb2Buffer, extractFb2FromZip } from './parser.js';
import { FB2_SAMPLE, FB2_CP1251_SAMPLE, makeFb2Zip, zipFileNames } from '../test-utils.js';
import { ParseError } from '../../utils/errors.js';
import { joinAuthors } from '../model.js';
import { detectFormat } from '../index.js';

describe('FB2 parser', () => {
  it('parses metadata from title-info', () => {
    const { metadata } = parseFb2Text(FB2_SAMPLE, '/tmp/book.fb2', 'book.fb2');
    expect(metadata.title).toBe('Test Book');
    expect(metadata.authors).toHaveLength(2);
    expect(joinAuthors(metadata.authors)).toBe('Doe John, Nick');
    expect(metadata.genres).toEqual(['sf', 'adventure']);
    expect(metadata.annotation).toContain('important');
    expect(metadata.lang).toBe('en');
    expect(metadata.series).toEqual({ name: 'The Series', number: 2 });
    expect(metadata.coverKey).toBe('cover.jpg');
    expect(metadata.publisher).toBe('Example Press');
    expect(metadata.year).toBe(2020);
    expect(metadata.isbn).toBe('978-3-16-148410-0');
  });

  it('falls back to filename for missing title', () => {
    const xml = `<?xml version="1.0"?><FictionBook><description/></FictionBook>`;
    const { metadata } = parseFb2Text(xml, '/tmp/no-title.fb2', 'no-title.fb2');
    expect(metadata.title).toBe('no-title');
  });

  it('parses content blocks preserving structure', () => {
    const { state } = parseFb2Text(FB2_SAMPLE, '/tmp/book.fb2', 'book.fb2');
    const types = state.blocks.map((b) => b.type);
    expect(types).toContain('heading');
    expect(types).toContain('paragraph');
    expect(types).toContain('list');
    expect(types).toContain('quote');
    expect(types).toContain('poem');
    expect(types).toContain('empty');
    expect(types).toContain('table');

    const paragraphs = state.blocks.filter((b) => b.type === 'paragraph');
    const first = paragraphs[0];
    expect(first).toBeDefined();
    if (first && first.type === 'paragraph') {
      const hasBold = first.children.some(
        (c) =>
          c.kind === 'bold' && c.children.some((x) => x.kind === 'text' && x.text.includes('bold')),
      );
      expect(hasBold).toBe(true);
    }

    const heading = state.blocks.find((b) => b.type === 'heading');
    expect(heading).toBeDefined();
    if (heading && heading.type === 'heading') {
      expect(heading.level).toBe(2);
    }
  });

  it('builds a table of contents', () => {
    const { state } = parseFb2Text(FB2_SAMPLE, '/tmp/book.fb2', 'book.fb2');
    const labels = state.toc.map((t) => t.label);
    expect(labels).toContain('Book Title');
    expect(labels).toContain('Chapter One');
    expect(labels).toContain('Nested Section');
    for (const entry of state.toc) {
      const block = state.blocks[entry.blockIndex];
      expect(block).toBeDefined();
      expect(block?.type).toBe('heading');
    }
  });

  it('collects binary resources', () => {
    const { resources } = parseFb2Text(FB2_SAMPLE, '/tmp/book.fb2', 'book.fb2');
    expect(resources.has('cover.jpg')).toBe(true);
    expect(resources.has('img1')).toBe(true);
    const cover = resources.get('cover.jpg')!;
    expect(Buffer.from(cover).toString('utf8')).toBe('hello world');
  });

  it('decodes windows-1251 encoded FB2', () => {
    const book = parseFb2Buffer(FB2_CP1251_SAMPLE, '/tmp/ru.fb2');
    expect(book.metadata.title).toBe('Тестовая книга');
    expect(book.metadata.authors[0]?.firstName).toBe('Иван');
  });

  it('parses fb2.zip archives', () => {
    const zip = makeFb2Zip(FB2_SAMPLE, 'books/test.fb2');
    const book = parseFb2Buffer(zip, '/tmp/archive.fb2.zip');
    expect(book.format).toBe('fb2');
    expect(book.metadata.title).toBe('Test Book');
    expect(zipFileNames(zip)).toContain('books/test.fb2');
  });

  it('extracts the inner fb2 from a zip', () => {
    const zip = makeFb2Zip(FB2_SAMPLE);
    const inner = extractFb2FromZip(zip);
    expect(inner.name).toBe('book.fb2');
    expect(inner.data.length).toBeGreaterThan(0);
  });

  it('throws ParseError for non-FB2 XML', () => {
    expect(() => parseFb2Text('<html></html>', '/tmp/x.fb2', 'x.fb2')).toThrow(ParseError);
  });

  it('throws ParseError when a zip has no fb2 file', () => {
    expect(() => parseFb2Buffer(makeFb2Zip('<html/>', 'readme.txt'), '/tmp/a.fb2.zip')).toThrow(
      ParseError,
    );
  });

  it('detects format from content and extension', () => {
    expect(detectFormat(Buffer.from(FB2_SAMPLE), 'unknown.txt')).toBe('fb2');
    expect(detectFormat(makeFb2Zip(FB2_SAMPLE), 'x.fb2.zip')).toBe('fb2');
    expect(detectFormat(Buffer.from('PK\x03\x04 data'), 'x.epub')).toBe('epub');
  });

  it('handles truncated xml gracefully without crashing', () => {
    const corrupt = '<?xml version="1.0"?><FictionBook><description><broken>';
    const book = parseFb2Text(corrupt, '/tmp/b.fb2', 'b.fb2');
    expect(book.metadata.title).toBe('b');
    expect(book.state.blocks.length).toBe(0);
  });
});

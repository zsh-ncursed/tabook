// Golden parity: EPUB parsing — native.parseEpubBuffer / parseEpubMetadata
// (Rust) vs the pure-TS parser (src/formats/epub/parser.ts).
import { describe, it, expect } from 'vitest';
import { buildEpub, buildNcxEpub } from '../formats/test-utils.js';
import { parseEpubBuffer, parseEpubMetadata } from '../formats/epub/parser.js';
import { canonicalBook, requireNative } from './helpers.js';

const n = requireNative();

const PATH = '/some/dir/Книга.epub';

describe('parity: EPUB parser', () => {
  it('full parse of a nav-based EPUB (nav.xhtml toc)', () => {
    const data = buildEpub();
    const ts = parseEpubBuffer(data, PATH);
    const nat = n.parseEpubBuffer(data, PATH);
    expect(canonicalBook(ts)).toEqual(canonicalBook(nat));
  });

  it('full parse of an NCX-based EPUB (toc.ncx toc)', () => {
    const data = buildNcxEpub();
    const ts = parseEpubBuffer(data, PATH);
    const nat = n.parseEpubBuffer(data, PATH);
    expect(canonicalBook(ts)).toEqual(canonicalBook(nat));
  });

  it('metadata parse agrees', () => {
    for (const data of [buildEpub(), buildNcxEpub()]) {
      expect(n.parseEpubMetadata(data, PATH)).toEqual(parseEpubMetadata(data, PATH));
    }
  });

  it('epub without a title in metadata falls back to the filename', () => {
    const data = buildEpub({ chapters: [{ name: 'chap1.xhtml', body: '<p>Body only.</p>' }] });
    const ts = parseEpubBuffer(data, PATH);
    const nat = n.parseEpubBuffer(data, PATH);
    expect(canonicalBook(ts)).toEqual(canonicalBook(nat));
  });
});

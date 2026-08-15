// Golden parity: FB2 parsing — native.parseFb2Buffer / parseFb2Metadata
// (Rust) vs the pure-TS parser (src/formats/fb2/parser.ts).
import { describe, it, expect } from 'vitest';
import AdmZip from 'adm-zip';
import { FB2_SAMPLE, FB2_CP1251_SAMPLE, makeFb2Zip } from '../formats/test-utils.js';
import { parseFb2Buffer, parseFb2Metadata } from '../formats/fb2/parser.js';
import { canonicalBook, canonicalMetadata, requireNative } from './helpers.js';

const n = requireNative();

const PATH = '/some/dir/Книга.fb2';

describe('parity: FB2 parser', () => {
  it('full parse of a rich FB2 document', () => {
    const data = Buffer.from(FB2_SAMPLE, 'utf8');
    const ts = parseFb2Buffer(data, PATH);
    const nat = n.parseFb2Buffer(data, PATH);
    expect(canonicalBook(ts)).toEqual(canonicalBook(nat));
  });

  it('metadata parse of a rich FB2 document', () => {
    const data = Buffer.from(FB2_SAMPLE, 'utf8');
    expect(canonicalMetadata(n.parseFb2Metadata(data, PATH))).toEqual(
      canonicalMetadata(parseFb2Metadata(data, PATH)),
    );
  });

  it('windows-1251 encoded FB2', () => {
    const data = Buffer.from(FB2_CP1251_SAMPLE);
    const ts = parseFb2Buffer(data, PATH);
    const nat = n.parseFb2Buffer(data, PATH);
    expect(canonicalBook(ts)).toEqual(canonicalBook(nat));
    expect(canonicalMetadata(n.parseFb2Metadata(data, PATH))).toEqual(
      canonicalMetadata(parseFb2Metadata(data, PATH)),
    );
  });

  it('fb2.zip archive', () => {
    const data = makeFb2Zip(FB2_SAMPLE);
    const ts = parseFb2Buffer(data, PATH);
    const nat = n.parseFb2Buffer(data, PATH);
    expect(canonicalBook(ts)).toEqual(canonicalBook(nat));
    expect(canonicalMetadata(n.parseFb2Metadata(data, PATH))).toEqual(
      canonicalMetadata(parseFb2Metadata(data, PATH)),
    );
  });

  it('zip with the fb2 in a subdirectory (fallback-title drift guard)', () => {
    // A book without a <book-title> falls back to the entry filename. The
    // metadata path must use the basename, not the full archive path.
    const minimal = `<?xml version="1.0" encoding="UTF-8"?>
<FictionBook xmlns="http://www.gribuser.ru/xml/fictionbook/2.0">
  <description><title-info>
    <author><first-name>Ann</first-name><last-name>Lee</last-name></author>
  </title-info></description>
  <body><section><title><p>Chapter</p></title><p>Body text.</p></section></body>
</FictionBook>`;
    const zip = new AdmZip();
    zip.addFile('subdir/book.fb2', Buffer.from(minimal, 'utf8'));
    const data = zip.toBuffer();
    const tsMeta = parseFb2Metadata(data, PATH);
    const natMeta = n.parseFb2Metadata(data, PATH);
    expect(natMeta.title).toBe('book');
    expect(canonicalMetadata(tsMeta)).toEqual(canonicalMetadata(natMeta));
    expect(canonicalBook(parseFb2Buffer(data, PATH))).toEqual(
      canonicalBook(n.parseFb2Buffer(data, PATH)),
    );
  });
});

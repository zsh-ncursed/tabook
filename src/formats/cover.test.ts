import { describe, it, expect } from 'vitest';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { decodeDataUri, extractCoverBytes, extractFb2CoverBytes } from './cover.js';
import { FB2_SAMPLE, makeFb2Zip, buildEpub } from './test-utils.js';

function writeTemp(data: Uint8Array | string): string {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'tabook-cover-test-'));
  const file = path.join(dir, 'book');
  fs.writeFileSync(file, data);
  return file;
}

describe('extractFb2CoverBytes', () => {
  it('extracts the base64 cover block by id', () => {
    const bytes = extractFb2CoverBytes(FB2_SAMPLE, 'cover.jpg');
    expect(bytes).toBeDefined();
    expect(Buffer.from(bytes!).toString('utf8')).toBe('hello world');
  });

  it('returns undefined for an unknown cover key', () => {
    expect(extractFb2CoverBytes(FB2_SAMPLE, 'nope.jpg')).toBeUndefined();
  });

  it('handles regex metacharacters in the cover key', () => {
    const xml =
      '<FictionBook><binary id="a.b+c" content-type="image/png">cGF0dGVybg==</binary></FictionBook>';
    expect(Buffer.from(extractFb2CoverBytes(xml, 'a.b+c')!).toString('utf8')).toBe('pattern');
  });
});

describe('extractCoverBytes', () => {
  it('extracts a cover from a plain FB2 file', () => {
    const file = writeTemp(FB2_SAMPLE);
    const bytes = extractCoverBytes(file, 'fb2', 'cover.jpg');
    expect(bytes).toBeDefined();
    expect(Buffer.from(bytes!).toString('utf8')).toBe('hello world');
  });

  it('extracts a cover from an FB2 zip', () => {
    const file = writeTemp(makeFb2Zip(FB2_SAMPLE));
    const bytes = extractCoverBytes(file, 'fb2', 'cover.jpg');
    expect(bytes).toBeDefined();
  });

  it('extracts the cover entry from an EPUB', () => {
    const file = writeTemp(buildEpub());
    const bytes = extractCoverBytes(file, 'epub', 'images/cover.jpg');
    expect(Buffer.from(bytes!)).toEqual(Buffer.from([0xff, 0xd8, 0xff, 0xe0]));
  });

  it('returns undefined for a missing cover key', () => {
    const file = writeTemp(FB2_SAMPLE);
    expect(extractCoverBytes(file, 'fb2', undefined)).toBeUndefined();
  });

  it('returns undefined for a nonexistent file', () => {
    expect(extractCoverBytes('/nonexistent/book.fb2', 'fb2', 'cover.jpg')).toBeUndefined();
  });

  it('returns undefined for a broken zip', () => {
    const file = writeTemp(Buffer.from('PK\x03\x04 not a real zip at all'));
    expect(extractCoverBytes(file, 'fb2', 'cover.jpg')).toBeUndefined();
  });
});

describe('decodeDataUri', () => {
  it('decodes a base64 data URI', () => {
    const bytes = decodeDataUri('data:image/png;base64,aGVsbG8=');
    expect(Buffer.from(bytes!).toString('utf8')).toBe('hello');
  });

  it('returns undefined for non-base64 or malformed URIs', () => {
    expect(decodeDataUri('https://example.com/cover.jpg')).toBeUndefined();
    expect(decodeDataUri('data:image/png,raw')).toBeUndefined();
    expect(decodeDataUri('data:')).toBeUndefined();
  });
});

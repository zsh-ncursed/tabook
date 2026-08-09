import { describe, it, expect } from 'vitest';
import { openZip } from './zip.js';
import { ParseError } from './errors.js';
import { makeFb2Zip, FB2_SAMPLE, makeBrokenZip } from '../formats/test-utils.js';

describe('openZip', () => {
  it('lists entries and reads their content', () => {
    const zip = openZip(makeFb2Zip(FB2_SAMPLE, 'books/a.fb2'));
    expect(zip.entries.map((e) => e.name)).toEqual(['books/a.fb2']);
    const data = zip.read('books/a.fb2');
    expect(Buffer.from(data).toString('utf8')).toContain('<FictionBook');
  });

  it('throws a ParseError for an invalid zip', () => {
    expect(() => openZip(Buffer.from('not a zip at all'))).toThrow(ParseError);
  });

  it('throws a ParseError when reading a missing entry', () => {
    const zip = openZip(makeFb2Zip(FB2_SAMPLE));
    expect(() => zip.read('nope.fb2')).toThrow(ParseError);
  });

  it('throws a ParseError for a corrupted archive', () => {
    expect(() => openZip(makeBrokenZip())).toThrow(ParseError);
  });
});

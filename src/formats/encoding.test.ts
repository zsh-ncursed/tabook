import { describe, it, expect } from 'vitest';
import {
  detectEncoding,
  normalizeEncoding,
  decodeXmlBuffer,
  fileExtension,
  isZipBuffer,
} from './encoding.js';

describe('detectEncoding', () => {
  it('detects BOMs', () => {
    expect(detectEncoding(new Uint8Array([0xef, 0xbb, 0xbf, 0x3c]))).toBe('utf-8');
    expect(detectEncoding(new Uint8Array([0xff, 0xfe, 0x3c]))).toBe('utf-16le');
    expect(detectEncoding(new Uint8Array([0xfe, 0xff, 0x00, 0x3c]))).toBe('utf-16be');
  });

  it('reads the encoding declaration', () => {
    const utf8 = Buffer.from('<?xml version="1.0" encoding="UTF-8"?>');
    expect(detectEncoding(utf8)).toBe('utf-8');
    const cp1251 = Buffer.from('<?xml version="1.0" encoding="windows-1251"?>');
    expect(detectEncoding(cp1251)).toBe('windows-1251');
    const koi = Buffer.from('<?xml encoding="koi8-r"?>');
    expect(detectEncoding(koi)).toBe('koi8-r');
  });

  it('defaults to utf-8', () => {
    expect(detectEncoding(Buffer.from('plain text'))).toBe('utf-8');
  });

  it('detects UTF-16LE without BOM by heuristic (0x3C 0x00)', () => {
    const data = new Uint8Array([0x3c, 0x00, 0x3f, 0x00]); // < in LE
    expect(detectEncoding(data)).toBe('utf-16le');
  });

  it('detects UTF-16BE without BOM by heuristic (0x00 0x3C)', () => {
    const data = new Uint8Array([0x00, 0x3c, 0x00, 0x3f]); // < in BE
    expect(detectEncoding(data)).toBe('utf-16be');
  });
});

describe('normalizeEncoding', () => {
  it('maps common aliases', () => {
    expect(normalizeEncoding('cp1251')).toBe('windows-1251');
    expect(normalizeEncoding('WINDOWS-1251')).toBe('windows-1251');
    expect(normalizeEncoding('iso-8859-1')).toBe('iso-8859-1');
    expect(normalizeEncoding('utf16')).toBe('utf-16le');
    expect(normalizeEncoding('utf16le')).toBe('utf-16le');
    expect(normalizeEncoding('utf16be')).toBe('utf-16be');
  });
});

describe('decodeXmlBuffer', () => {
  it('strips a UTF-8 BOM before decoding', () => {
    const data = Buffer.concat([Buffer.from([0xef, 0xbb, 0xbf]), Buffer.from('<a>hello</a>')]);
    expect(decodeXmlBuffer(data)).toBe('<a>hello</a>');
  });

  it('decodes utf-16le content', () => {
    const text = '<a>x</a>';
    const data = Buffer.concat([Buffer.from([0xff, 0xfe]), Buffer.from(text, 'utf16le')]);
    expect(decodeXmlBuffer(data)).toBe(text);
  });

  it('decodes windows-1251 content', () => {
    const cp = [0xcf, 0xf0, 0xe8, 0xe2, 0xe5, 0xf2]; // "Привет"
    const xml = Buffer.concat([Buffer.from('<?xml encoding="windows-1251"?>'), Buffer.from(cp)]);
    expect(decodeXmlBuffer(xml)).toContain('Привет');
  });
});

describe('fileExtension & isZipBuffer', () => {
  it('extracts lowercase extensions', () => {
    expect(fileExtension('a.fb2')).toBe('fb2');
    expect(fileExtension('a.FB2.ZIP')).toBe('zip');
    expect(fileExtension('noext')).toBe('');
  });

  it('recognizes zip magic', () => {
    expect(isZipBuffer(Buffer.from('PK\x03\x04'))).toBe(true);
    expect(isZipBuffer(Buffer.from('nope'))).toBe(false);
  });
});

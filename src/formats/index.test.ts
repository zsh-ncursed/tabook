import { describe, it, expect } from 'vitest';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { detectFormat, parseBookFile, openBook, invalidateBookCache } from './index.js';
import { FB2_SAMPLE, buildEpub, makeFb2Zip } from './test-utils.js';

describe('format detection', () => {
  it('detects fb2 from extension and content', () => {
    expect(detectFormat(Buffer.from(FB2_SAMPLE), 'book.fb2')).toBe('fb2');
    expect(detectFormat(makeFb2Zip(FB2_SAMPLE), 'book.fb2.zip')).toBe('fb2');
    expect(detectFormat(makeFb2Zip(FB2_SAMPLE), 'archive.zip')).toBe('epub');
  });

  it('detects epub from extension and zip magic', () => {
    expect(detectFormat(buildEpub(), 'book.epub')).toBe('epub');
    expect(detectFormat(buildEpub(), 'mystery.bin')).toBe('epub');
  });

  it('throws ParseError for unrecognized format', () => {
    const garbage = new TextEncoder().encode('this is not a book');
    expect(() => detectFormat(garbage, 'file.xyz')).toThrow('Cannot determine format');
  });
});

describe('file-based parsing', () => {
  it('parseBookFile reads and parses fb2 from disk', () => {
    const file = path.join(os.tmpdir(), 'tabook-detect-test.fb2');
    fs.writeFileSync(file, FB2_SAMPLE);
    try {
      const book = parseBookFile(file);
      expect(book.metadata.title).toBe('Test Book');
      expect(book.content.length).toBeGreaterThan(0);
    } finally {
      fs.unlinkSync(file);
    }
  });

  it('openBook parses epub asynchronously', async () => {
    const file = path.join(os.tmpdir(), 'tabook-detect-test.epub');
    fs.writeFileSync(file, buildEpub());
    try {
      const book = await openBook(file);
      expect(book.metadata.title).toBe('Epub Book');
    } finally {
      fs.unlinkSync(file);
    }
  });

  it('returns the cached parsed book on repeat opens of the same path', async () => {
    const file = path.join(os.tmpdir(), 'tabook-cache-test.fb2');
    fs.writeFileSync(file, FB2_SAMPLE);
    try {
      invalidateBookCache();
      const first = parseBookFile(file);
      // Mutate the disk copy; the cache must serve the original parse so a
      // repeated open is instant and consistent within the session.
      fs.writeFileSync(file, FB2_SAMPLE.replace('Test Book', 'Changed Book'));
      const second = parseBookFile(file);
      expect(second).toBe(first);
      expect(second.metadata.title).toBe('Test Book');
      // openBook shares the same cache.
      const third = await openBook(file);
      expect(third).toBe(first);
    } finally {
      invalidateBookCache();
      fs.unlinkSync(file);
    }
  });

  it('evicts the oldest entry when the cache grows past its bound', () => {
    invalidateBookCache();
    const files = new Array<string>(5);
    try {
      for (let i = 0; i < 5; i++) {
        const file = path.join(os.tmpdir(), `tabook-cache-evict-${i}.fb2`);
        fs.writeFileSync(file, FB2_SAMPLE);
        files[i] = file;
        parseBookFile(file);
      }
      // First file was evicted; the rest are still served from cache.
      expect(() => parseBookFile(files[0]!)).not.toBe(files[0]);
      const first = parseBookFile(files[0]!);
      expect(first.metadata.title).toBe('Test Book');
      const secondFile = files[1]!;
      expect(parseBookFile(secondFile)).toBe(parseBookFile(secondFile));
    } finally {
      invalidateBookCache();
      for (const file of files) fs.unlinkSync(file);
    }
  });
});

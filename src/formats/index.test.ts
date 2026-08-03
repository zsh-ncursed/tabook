import { describe, it, expect } from 'vitest';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { detectFormat, parseBookFile, openBook } from './index.js';
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
});

describe('file-based parsing', () => {
  it('parseBookFile reads and parses fb2 from disk', () => {
    const file = path.join(os.tmpdir(), 'tome-detect-test.fb2');
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
    const file = path.join(os.tmpdir(), 'tome-detect-test.epub');
    fs.writeFileSync(file, buildEpub());
    try {
      const book = await openBook(file);
      expect(book.metadata.title).toBe('Epub Book');
    } finally {
      fs.unlinkSync(file);
    }
  });
});

import fs from 'node:fs';
import path from 'node:path';
import { ParseError } from '../utils/errors.js';
import { fileExtension, isZipBuffer } from './encoding.js';
import { parseFb2Buffer } from './fb2/parser.js';
import { parseEpubBuffer } from './epub/parser.js';
import type { ParsedBook } from './model.js';

export { parseFb2Buffer, parseFb2Text, parseFb2Metadata } from './fb2/parser.js';
export { parseEpubBuffer, parseEpubMetadata } from './epub/parser.js';
export type { ParsedBook, BookMetadata, Block, Inline, TocEntry } from './model.js';
export * from './model.js';

export function detectFormat(data: Uint8Array, name: string): 'fb2' | 'epub' {
  const ext = fileExtension(name);
  const lowerName = name.toLowerCase();
  if (ext === 'fb2' || lowerName.endsWith('.fb2.zip')) return 'fb2';
  if (ext === 'epub') return 'epub';
  if (isZipBuffer(data)) return 'epub';
  const head = Buffer.from(data.subarray(0, 512)).toString('utf8');
  if (head.includes('<FictionBook')) return 'fb2';
  if (head.trimStart().startsWith('<?xml') && head.includes('<FictionBook')) return 'fb2';
  throw new ParseError(`Cannot determine format of "${name}" — expected .fb2 or .epub`);
}

// Shared detect+dispatch for both sync and async entry points. Adding a new
// format touches exactly one place — the previous version duplicated the
// switch across parseBookFile and openBook, and the error messages diverged.
function dispatchParse(data: Uint8Array, filePath: string): ParsedBook {
  const format = detectFormat(data, path.basename(filePath));
  switch (format) {
    case 'fb2':
      return parseFb2Buffer(data, filePath);
    case 'epub':
      return parseEpubBuffer(data, filePath);
    default:
      throw new ParseError(`Unsupported format for ${filePath}`);
  }
}

// Bounded LRU of parsed books keyed by path. The library detail view re-parses
// a book just to extract its cover, and reopening a book re-parses it too; for
// large files that is a multi-second synchronous stall on the main thread.
// Caching the last few parsed books makes repeat opens instant. Eviction keeps
// memory bounded (a couple of books in flight at once is normal usage).
const MAX_CACHED_BOOKS = 4;
const bookCache = new Map<string, ParsedBook>();

export function invalidateBookCache(): void {
  bookCache.clear();
}

function cachedParse(data: Uint8Array, filePath: string): ParsedBook {
  const cached = bookCache.get(filePath);
  if (cached) return cached;
  const book = dispatchParse(data, filePath);
  if (bookCache.size >= MAX_CACHED_BOOKS) {
    const oldest = bookCache.keys().next().value;
    if (oldest !== undefined) bookCache.delete(oldest);
  }
  bookCache.set(filePath, book);
  return book;
}

export function parseBookFile(filePath: string): ParsedBook {
  const cached = bookCache.get(filePath);
  if (cached) return cached;
  const data = fs.readFileSync(filePath);
  return cachedParse(data, filePath);
}

export async function openBook(filePath: string): Promise<ParsedBook> {
  const cached = bookCache.get(filePath);
  if (cached) return cached;
  const data = await fs.promises.readFile(filePath);
  return cachedParse(data, filePath);
}

import { native } from '../native.js';
import type { ParsedBook } from './model.js';

// Re-export types (unchanged)
export type { ParsedBook, BookMetadata, Block, Inline, TocEntry } from './model.js';
export * from './model.js';

// Re-export parsers — delegate to native if available, fall back to TS
export { parseFb2Buffer, parseFb2Metadata } from './fb2/parser.js';
export { parseEpubBuffer, parseEpubMetadata } from './epub/parser.js';

export function detectFormat(data: Uint8Array, name: string): 'fb2' | 'epub' {
  if (native) {
    const result = native.detectFormat(Buffer.from(data), name);
    // napi-rs returns Error objects instead of throwing; re-throw
    if (typeof result !== 'string') {
      throw new Error(String(result));
    }
    return result as 'fb2' | 'epub';
  }
  // Fallback: TS implementation
  const { fileExtension, isZipBuffer } = require('./encoding.js') as typeof import('./encoding.js');
  const ext = fileExtension(name);
  const lowerName = name.toLowerCase();
  if (ext === 'fb2' || lowerName.endsWith('.fb2.zip')) return 'fb2';
  if (ext === 'epub') return 'epub';
  if (isZipBuffer(data)) return 'epub';
  const head = Buffer.from(data.subarray(0, 512)).toString('utf8');
  if (head.includes('<FictionBook')) return 'fb2';
  if (head.trimStart().startsWith('<?xml') && head.includes('<FictionBook')) return 'fb2';
  throw new Error(`Cannot determine format of "${name}" — expected .fb2 or .epub`);
}

export function invalidateBookCache(): void {
  if (native) {
    native.invalidateBookCache();
    return;
  }
}

export function parseBookFile(filePath: string): ParsedBook {
  if (native) {
    return native.parseBookFile(filePath) as unknown as ParsedBook;
  }
  // Fallback: TS implementation
  const fs = require('node:fs') as typeof import('node:fs');
  const { parseFb2Buffer } = require('./fb2/parser.js') as typeof import('./fb2/parser.js');
  const { parseEpubBuffer } = require('./epub/parser.js') as typeof import('./epub/parser.js');
  const data = fs.readFileSync(filePath);
  const format = detectFormat(data, filePath);
  if (format === 'fb2') return parseFb2Buffer(data, filePath);
  return parseEpubBuffer(data, filePath);
}

export async function openBook(filePath: string): Promise<ParsedBook> {
  if (native) {
    return native.parseBookFile(filePath) as unknown as ParsedBook;
  }
  // Fallback: TS implementation
  const fs = require('node:fs') as typeof import('node:fs');
  const data = await fs.promises.readFile(filePath);
  const format = detectFormat(data, filePath);
  const { parseFb2Buffer } = require('./fb2/parser.js') as typeof import('./fb2/parser.js');
  const { parseEpubBuffer } = require('./epub/parser.js') as typeof import('./epub/parser.js');
  if (format === 'fb2') return parseFb2Buffer(data, filePath);
  return parseEpubBuffer(data, filePath);
}
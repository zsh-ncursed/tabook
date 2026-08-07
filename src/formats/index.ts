import fs from 'node:fs';
import path from 'node:path';
import { ParseError } from '../utils/errors.js';
import { fileExtension, isZipBuffer } from './encoding.js';
import { parseFb2Buffer } from './fb2/parser.js';
import { parseEpubBuffer } from './epub/parser.js';
import type { ParsedBook } from './model.js';

export { parseFb2Buffer, parseFb2Text } from './fb2/parser.js';
export { parseEpubBuffer } from './epub/parser.js';
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

export function parseBookFile(filePath: string): ParsedBook {
  const data = fs.readFileSync(filePath);
  return dispatchParse(data, filePath);
}

export async function openBook(filePath: string): Promise<ParsedBook> {
  const data = await fs.promises.readFile(filePath);
  return dispatchParse(data, filePath);
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

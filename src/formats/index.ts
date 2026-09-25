import fs from 'node:fs';
import { native, isNativeErrorResult } from '../native.js';
import type { ParsedBook, BookMetadata } from './model.js';
import { fileExtension, isZipBuffer } from './encoding.js';
import { ParseError } from '../utils/errors.js';
import { parseFb2Buffer, parseFb2Metadata } from './fb2/parser.js';
import { parseEpubBuffer, parseEpubMetadata } from './epub/parser.js';

// Re-export types (unchanged)
export type { ParsedBook, BookMetadata, Block, Inline, TocEntry } from './model.js';
export * from './model.js';

// Re-export parsers — delegate to native if available, fall back to TS
export { parseFb2Buffer, parseFb2Metadata } from './fb2/parser.js';
export { parseEpubBuffer, parseEpubMetadata } from './epub/parser.js';

export function detectFormat(data: Uint8Array, name: string): 'fb2' | 'epub' {
  if (native) {
    const result = native.detectFormat(Buffer.from(data), name);
    // napi-rs returns Err as a value instead of throwing; re-throw
    if (typeof result !== 'string' || isNativeErrorResult(result)) {
      throw new Error(String(result));
    }
    return result as 'fb2' | 'epub';
  }
  return detectFormatTs(data, name);
}

// Pure-TS format detection, used when the native module is unavailable.
// Exported so parity tests can compare it against native.detectFormat
// directly (see src/parity/detect.parity.test.ts).
export function detectFormatTs(data: Uint8Array, name: string): 'fb2' | 'epub' {
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

// Metadata-only parse used by the folder scanner (src/db/scan.ts). Gated on
// native like detectFormat/parseBookFile: the Rust metadata fast paths skip
// content-block building and base64 decoding, which is the difference between
// a multi-second and a near-instant scan of a large folder. The TS parsers
// remain the fallback when the binding is unavailable.
export function parseBookMetadata(
  data: Uint8Array,
  filePath: string,
  format: 'fb2' | 'epub',
): BookMetadata {
  if (native) {
    const result =
      format === 'fb2'
        ? native.parseFb2Metadata(Buffer.from(data), filePath)
        : native.parseEpubMetadata(Buffer.from(data), filePath);
    // napi-rs returns Err as a value instead of throwing; re-throw as a
    // ParseError so scanner error reporting (messageOf) matches the TS
    // parsers' behavior.
    if (isNativeErrorResult(result)) {
      throw new ParseError(result.message ?? String(result));
    }
    return result;
  }
  return format === 'fb2' ? parseFb2Metadata(data, filePath) : parseEpubMetadata(data, filePath);
}

export function invalidateBookCache(): void {
  if (native) {
    native.invalidateBookCache();
    return;
  }
}

// napi-rs serializes `resources: Vec<ResourceEntry>` as a plain array of
// { key, data }, but the app (imageLayer, BookDetail cover, InfoModal) expects
// Map<string, Uint8Array> — image rendering silently broke on the native path
// because resources.get() was undefined. Convert once at the boundary.
type NativeParsedBook = Omit<ParsedBook, 'resources'> & {
  resources: { key: string; data: Uint8Array }[];
};

function withResourcesMap(book: NativeParsedBook): ParsedBook {
  const resources = new Map<string, Uint8Array>();
  for (const r of book.resources) {
    // napi-rs serializes Vec<u8> as a plain number array; fs.writeFileSync
    // (imageLayer) and Uint8Array consumers need a real typed array.
    resources.set(r.key, Uint8Array.from(r.data));
  }
  return { ...book, resources };
}

export function parseBookFile(filePath: string): ParsedBook {
  if (native) {
    return withResourcesMap(native.parseBookFile(filePath) as unknown as NativeParsedBook);
  }
  // Fallback: TS implementation
  const data = fs.readFileSync(filePath);
  const format = detectFormat(data, filePath);
  if (format === 'fb2') return parseFb2Buffer(data, filePath);
  return parseEpubBuffer(data, filePath);
}

export async function openBook(filePath: string): Promise<ParsedBook> {
  if (native) {
    return withResourcesMap(native.parseBookFile(filePath) as unknown as NativeParsedBook);
  }
  // Fallback: TS implementation
  const data = await fs.promises.readFile(filePath);
  const format = detectFormat(data, filePath);
  if (format === 'fb2') return parseFb2Buffer(data, filePath);
  return parseEpubBuffer(data, filePath);
}

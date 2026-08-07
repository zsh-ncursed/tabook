import AdmZip from 'adm-zip';
import path from 'node:path';
import { ParseError } from './errors.js';

export interface ZipEntryInfo {
  name: string;
  size: number;
}

export interface ZipArchive {
  entries: ZipEntryInfo[];
  read(name: string): Uint8Array;
  readEntry(entry: ZipEntryInfo): Uint8Array;
}

export function openZip(data: Uint8Array): ZipArchive {
  let zip: AdmZip;
  try {
    zip = new AdmZip(Buffer.from(data));
  } catch (err) {
    throw new ParseError(
      `Invalid ZIP archive: ${err instanceof Error ? err.message : String(err)}`,
      { cause: err },
    );
  }
  const entries: ZipEntryInfo[] = [];
  for (const entry of zip.getEntries()) {
    if (entry.isDirectory) continue;
    // Defense against zip-slip: reject entries whose normalized path escapes
    // the archive root. A leading "../" or absolute path would let a malicious
    // archive collide keys in the in-memory resources map today, and become a
    // real traversal if any future feature extracts entries to disk.
    const norm = path.posix.normalize(entry.entryName);
    if (norm.startsWith('../') || path.posix.isAbsolute(norm)) {
      throw new ParseError(
        `ZIP entry escapes archive root: ${entry.entryName}`,
      );
    }
    entries.push({ name: norm, size: entry.header.size });
  }
  return {
    entries,
    read(name: string): Uint8Array {
      const entry = zip.getEntry(name);
      if (!entry) {
        throw new ParseError(`ZIP entry not found: ${name}`);
      }
      try {
        const data = zip.readFile(entry);
        if (data === null) {
          throw new ParseError(`Cannot read ZIP entry ${name}: null data`);
        }
        return data;
      } catch (err) {
        throw new ParseError(`Cannot read ZIP entry ${name}: ${String(err)}`, { cause: err });
      }
    },
    readEntry(entry: ZipEntryInfo): Uint8Array {
      return this.read(entry.name);
    },
  };
}

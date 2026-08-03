import AdmZip from 'adm-zip';
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
    entries.push({ name: entry.entryName, size: entry.header.size });
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

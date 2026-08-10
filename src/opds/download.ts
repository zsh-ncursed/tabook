import { join } from 'node:path';
import { writeFileSync } from 'node:fs';
import { ensureDir, downloadsDir } from '../utils/paths.js';
import { downloadBook, type OpdsAuth } from './client.js';
import { parseBookFile } from '../formats/index.js';
import type { LibraryDb } from '../db/db.js';
import type { OpdsEntry } from './model.js';
import { pickAcquisitionLink, mimeToExtension } from './model.js';

export interface DownloadResult {
  bookId: number;
  filePath: string;
  title: string;
}

// ext4 (and most other filesystems) cap file names at 255 *bytes* — characters
// are not bytes: a 180-char Cyrillic title is 360 bytes and still throws
// ENAMETOOLONG. Truncate by UTF-8 byte length, leaving room for the extension.
const MAX_FILENAME_BYTES = 255;

function truncateUtf8(value: string, maxBytes: number): string {
  if (Buffer.byteLength(value, 'utf8') <= maxBytes) return value;
  // Binary search for the longest prefix that fits within maxBytes.
  let lo = 0;
  let hi = value.length;
  while (lo < hi) {
    const mid = Math.ceil((lo + hi) / 2);
    if (Buffer.byteLength(value.slice(0, mid), 'utf8') <= maxBytes) {
      lo = mid;
    } else {
      hi = mid - 1;
    }
  }
  return value.slice(0, lo);
}

function sanitizeFilename(name: string, ext: string): string {
  const cleaned = name.replace(/[<>:"/\\|?*\x00-\x1f]/g, '_').trim() || 'download';
  const stemBytes = Math.max(1, MAX_FILENAME_BYTES - Buffer.byteLength(ext, 'utf8'));
  return truncateUtf8(cleaned, stemBytes);
}

export async function downloadAndSave(
  entry: OpdsEntry,
  opts: { auth?: OpdsAuth; db: LibraryDb; base?: string },
): Promise<DownloadResult> {
  const link = pickAcquisitionLink(entry.acquisitionLinks);
  if (!link) {
    throw new Error(`No supported acquisition link for "${entry.title}"`);
  }
  if (!link.type) {
    throw new Error(`Acquisition link has no MIME type for "${entry.title}"`);
  }

  const { data } = await downloadBook(link.href, { auth: opts.auth, base: opts.base });
  const ext = mimeToExtension(link.type);
  const basename = sanitizeFilename(entry.title, ext) + ext;
  const dir = downloadsDir();
  ensureDir(dir);
  const filePath = join(dir, basename);
  writeFileSync(filePath, data);

  const parsed = parseBookFile(filePath);
  const bookId = opts.db.addBook({
    path: filePath,
    filename: basename,
    format: parsed.format,
    size: parsed.size,
    metadata: parsed.metadata,
  });

  return { bookId, filePath, title: parsed.metadata.title };
}
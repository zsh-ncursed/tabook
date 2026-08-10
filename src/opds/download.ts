import { join, basename as pathBasename } from 'node:path';
import { writeFileSync, existsSync, unlinkSync } from 'node:fs';
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
  const cleaned =
    name
      .replace(/[<>:"/\\|?*\x00-\x1f]/g, '_')
      .replace(/^\.+/, '')
      .trim() || 'download';
  const stemBytes = Math.max(1, MAX_FILENAME_BYTES - Buffer.byteLength(ext, 'utf8'));
  return truncateUtf8(cleaned, stemBytes);
}

function uniqueFilePath(dir: string, basename: string): string {
  const candidate = join(dir, basename);
  if (!existsSync(candidate)) return candidate;
  const dot = basename.lastIndexOf('.');
  const stem = dot > 0 ? basename.slice(0, dot) : basename;
  const ext = dot > 0 ? basename.slice(dot) : '';
  for (let i = 2; i < 1000; i++) {
    const alt = join(dir, `${stem}-${i}${ext}`);
    if (!existsSync(alt)) return alt;
  }
  return join(dir, `${stem}-${Date.now()}${ext}`);
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
  const filePath = uniqueFilePath(dir, basename);
  writeFileSync(filePath, data);

  try {
    const parsed = parseBookFile(filePath);
    const bookId = opts.db.addBook({
      path: filePath,
      // uniqueFilePath may have deduped to "Book-2.fb2" — store the actual name
      filename: pathBasename(filePath),
      format: parsed.format,
      size: parsed.size,
      metadata: parsed.metadata,
    });
    return { bookId, filePath, title: parsed.metadata.title };
  } catch (err) {
    unlinkSync(filePath);
    throw err;
  }
}

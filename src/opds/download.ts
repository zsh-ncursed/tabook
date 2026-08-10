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

function sanitizeFilename(name: string): string {
  return name.replace(/[<>:"/\\|?*\x00-\x1f]/g, '_').trim() || 'download';
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
  const basename = sanitizeFilename(entry.title) + ext;
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
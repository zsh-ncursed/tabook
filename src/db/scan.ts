import fs from 'node:fs';
import path from 'node:path';
import type { LibraryDb, LibraryFolderRecord } from './db.js';
import { detectFormat } from '../formats/index.js';
import { parseFb2Metadata } from '../formats/fb2/parser.js';
import { parseEpubMetadata } from '../formats/epub/parser.js';
import type { BookMetadata } from '../formats/model.js';
import { expandTilde } from '../utils/paths.js';
import { messageOf } from '../utils/errors.js';

// Supported book extensions, case-insensitive: .fb2, .fb2.zip, .epub.
const BOOK_FILE_RE = /\.(?:epub|fb2(?:\.zip)?)$/i;

// Files are processed in batches and the event loop is yielded between
// batches, so a large scan does not freeze the TUI.
const BATCH_SIZE = 16;

// Only the first few per-file errors are collected; the rest are counted.
const MAX_REPORTED_ERRORS = 5;

export interface ScanSummary {
  total: number;
  added: number;
  updated: number;
  removed: number;
  failed: number;
  errors: string[];
}

export type ScanProgress = (done: number, total: number) => void;

// Resolve a user-supplied folder path: expand a leading ~ and make it
// absolute so DB lookups and the scanner always agree on the same string.
export function resolveFolderPath(p: string): string {
  return path.resolve(expandTilde(p));
}

function isBookFile(name: string): boolean {
  return BOOK_FILE_RE.test(name);
}

// Iterative chunked walk invoking onFile for every book file found. Yields
// to the event loop every WALK_CHUNK processing steps, so walking a huge
// folder does not block the TUI main thread — both the dirty check and the
// scan's file collection run on it. onFile may return false to abort the
// walk early (the dirty check stops as soon as a change is found). Symlinks
// are followed but cycles are cut by tracking visited real paths. Hidden
// directories are skipped (e.g. .git, .Trash); the attached root itself is
// always walked. Exported for unit testing (early-exit behavior).
const WALK_CHUNK = 64;

export async function walkBookFiles(
  root: string,
  onFile: (file: string) => boolean | void,
): Promise<void> {
  const visited = new Set<string>();
  const stack = [root];
  let steps = 0;
  while (stack.length > 0) {
    const dir = stack.pop()!;
    steps += 1;
    if (steps % WALK_CHUNK === 0) await yieldToEventLoop();
    let real: string;
    try {
      real = fs.realpathSync(dir);
    } catch {
      continue; // dangling symlink / unreadable dir
    }
    if (visited.has(real)) continue;
    visited.add(real);
    let entries: fs.Dirent[];
    try {
      entries = fs.readdirSync(dir, { withFileTypes: true });
    } catch {
      continue; // permission denied or vanished mid-walk
    }
    for (const entry of entries) {
      const full = path.join(dir, entry.name);
      if (entry.isDirectory()) {
        if (entry.name.startsWith('.')) continue;
        stack.push(full);
      } else if (entry.isFile() && isBookFile(entry.name)) {
        steps += 1;
        if (onFile(full) === false) return;
        if (steps % WALK_CHUNK === 0) await yieldToEventLoop();
      }
    }
  }
}

async function collectBookFiles(root: string): Promise<string[]> {
  const files: string[] = [];
  await walkBookFiles(root, (file) => {
    files.push(file);
  });
  return files;
}

function yieldToEventLoop(): Promise<void> {
  return new Promise((resolve) => setImmediate(resolve));
}

export async function scanLibraryFolder(
  db: LibraryDb,
  root: string,
  onProgress?: ScanProgress,
): Promise<ScanSummary> {
  let stat: fs.Stats;
  try {
    stat = fs.statSync(root);
  } catch {
    throw new Error(`Folder not found: ${root}`);
  }
  if (!stat.isDirectory()) {
    throw new Error(`Not a directory: ${root}`);
  }

  const files = (await collectBookFiles(root)).sort();
  const seen = new Set(files);
  const total = files.length;
  onProgress?.(0, total);

  // Whether the folder is attached *now*. Only scans of attached folders are
  // aborted mid-way if the folder gets detached; ad-hoc scans of unattached
  // directories (unit tests, future tooling) keep their original behavior.
  const attachedAtStart = db.getLibraryFolderByPath(root) !== undefined;

  const summary: ScanSummary = {
    total,
    added: 0,
    updated: 0,
    removed: 0,
    failed: 0,
    errors: [],
  };

  // Paths already tracked under this root, to distinguish new vs updated and
  // to detect files that vanished since the last scan.
  const existing = new Set(db.listPathsByLibraryRoot(root));

  let done = 0;
  for (let i = 0; i < files.length; i += BATCH_SIZE) {
    // The folder may be detached mid-scan (e.g. :library remove confirmed
    // while a large folder is still scanning). Its books were deleted from
    // the DB by the detach — keep going and they would be re-inserted with
    // a library_root pointing at a folder that no longer exists, and no
    // future scan would ever clean them up.
    if (attachedAtStart && !db.getLibraryFolderByPath(root)) {
      break;
    }
    const batch = files.slice(i, i + BATCH_SIZE);
    for (const file of batch) {
      try {
        const data = fs.readFileSync(file);
        const format = detectFormat(data, path.basename(file));
        const metadata: BookMetadata =
          format === 'fb2' ? parseFb2Metadata(data, file) : parseEpubMetadata(data, file);
        db.addBook({
          path: file,
          filename: path.basename(file),
          format,
          // data.length is the size we just read — no extra stat syscall,
          // and immune to TOCTOU if the file changes mid-scan.
          size: data.length,
          metadata,
          libraryRoot: root,
        });
        if (existing.has(file)) {
          summary.updated += 1;
        } else {
          summary.added += 1;
        }
      } catch (err) {
        summary.failed += 1;
        if (summary.errors.length < MAX_REPORTED_ERRORS) {
          summary.errors.push(`${path.basename(file)}: ${messageOf(err)}`);
        }
      }
      done += 1;
    }
    onProgress?.(done, total);
    await yieldToEventLoop();
  }

  // Books that disappeared from the folder are removed from the library
  // (progress/bookmarks cascade via FK).
  const vanished: string[] = [];
  for (const p of existing) {
    if (!seen.has(p)) vanished.push(p);
  }
  if (vanished.length > 0) {
    summary.removed = db.removeBooksByPaths(vanished);
  }

  // Record when the scan completed so the next entry into the library can
  // skip this folder unless a file changed since (mtime comparison). Only
  // attached folders have a row; the mid-scan-detach break above leaves it
  // untouched, so the stale timestamp is never written for a detached root.
  const folder = db.getLibraryFolderByPath(root);
  if (folder) {
    db.setFolderScannedAt(folder.id, Date.now());
  }

  return summary;
}

// Cheap mtime-based dirty check: does this folder need a rescan? Walks the
// tree statting only book files (no parsing) and compares mtimes against the
// last scan time; a file added, modified or deleted since then means dirty.
// Async and chunked so entering the library never blocks on large folders;
// aborts the walk as soon as a change is found.
export async function folderNeedsRescan(
  db: LibraryDb,
  folder: LibraryFolderRecord,
): Promise<boolean> {
  // Never scanned (or scanned before the timestamp column existed) → scan.
  if (folder.lastScannedAt === null) return true;
  // Narrowed copy — TS does not keep property narrowing inside the walk
  // callback closure below.
  const lastScannedAt = folder.lastScannedAt;
  let stat: fs.Stats;
  try {
    stat = fs.statSync(folder.path);
  } catch {
    // Folder missing on disk: don't retry on every library entry; a manual
    // :library scan still surfaces the error.
    return false;
  }
  if (!stat.isDirectory()) return false;

  const dbPaths = new Set(db.listPathsByLibraryRoot(folder.path));
  const walked = new Set<string>();
  let dirty = false;
  await walkBookFiles(folder.path, (file) => {
    walked.add(file);
    try {
      if (fs.statSync(file).mtimeMs > lastScannedAt) {
        dirty = true;
        return false; // abort the walk — already known to be dirty
      }
    } catch {
      // unreadable file mid-walk — ignore
    }
    return true;
  });
  if (dirty) return true;
  // Deletions: a DB-tracked book path that no longer exists on disk.
  //
  // Known trade-off: files added with a *preserved* old mtime (git clone,
  // cp -p) are walked but not in dbPaths and fail the mtime check, so they
  // stay invisible until an explicit :library scan. A count comparison would
  // catch them but also flags permanently unparseable files as dirty on
  // every entry (they are walked but never in the DB), causing a rescan
  // loop — the membership check below avoids that.
  for (const p of dbPaths) {
    if (!walked.has(p)) return true;
  }
  return false;
}

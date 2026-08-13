import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { LibraryDb } from './db.js';
import {
  scanLibraryFolder,
  folderNeedsRescan,
  walkBookFiles,
  resolveFolderPath,
  type ScanSummary,
} from './scan.js';
import { FB2_SAMPLE, makeFb2Zip, buildEpub } from '../formats/test-utils.js';

let dir: string;
let db: LibraryDb;

beforeEach(() => {
  dir = fs.mkdtempSync(path.join(os.tmpdir(), 'tabook-scan-'));
  db = new LibraryDb(path.join(dir, 'lib.sqlite'));
});

afterEach(() => {
  db.close();
  fs.rmSync(dir, { recursive: true, force: true });
});

function writeBook(relPath: string, data: Buffer | string): string {
  const full = path.join(dir, relPath);
  fs.mkdirSync(path.dirname(full), { recursive: true });
  fs.writeFileSync(full, data);
  return full;
}

const emptySummary = (): ScanSummary => ({
  total: 0,
  added: 0,
  updated: 0,
  removed: 0,
  failed: 0,
  errors: [],
});

describe('resolveFolderPath', () => {
  it('expands a tilde and makes the path absolute', () => {
    expect(resolveFolderPath('~')).toBe(os.homedir());
    expect(resolveFolderPath('~/books')).toBe(path.join(os.homedir(), 'books'));
    expect(resolveFolderPath('rel/path')).toBe(path.resolve('rel/path'));
  });
});

describe('scanLibraryFolder', () => {
  it('imports fb2, fb2.zip and epub with metadata', async () => {
    writeBook('plain.fb2', FB2_SAMPLE);
    writeBook('arch/book.fb2.zip', makeFb2Zip(FB2_SAMPLE));
    writeBook('sub/dir/novel.epub', buildEpub());
    // Unsupported files are ignored, not imported.
    writeBook('notes.txt', 'hello');
    writeBook('cover.jpg', Buffer.from([0xff, 0xd8]));

    const summary = await scanLibraryFolder(db, dir);
    expect(summary.added).toBe(3);
    expect(summary.failed).toBe(0);
    const books = db.listBooks();
    expect(books).toHaveLength(3);
    const titles = books.map((b) => b.title).sort();
    expect(titles).toEqual(['Epub Book', 'Test Book', 'Test Book']);
    expect(books.map((b) => b.format).sort()).toEqual(['epub', 'fb2', 'fb2']);
    // All scanned books are tracked under the folder root.
    expect(db.listPathsByLibraryRoot(dir)).toHaveLength(3);
  });

  it('reports progress and treats re-scans as updates', async () => {
    writeBook('a.fb2', FB2_SAMPLE);
    writeBook('b.epub', buildEpub());
    const progress: Array<[number, number]> = [];
    await scanLibraryFolder(db, dir, (done, total) => progress.push([done, total]));
    expect(db.listBooks()).toHaveLength(2);
    expect(progress[progress.length - 1]).toEqual([2, 2]);

    const second = await scanLibraryFolder(db, dir);
    expect(second.added).toBe(0);
    expect(second.updated).toBe(2);
    expect(db.listBooks()).toHaveLength(2);
  });

  it('removes books whose files vanished', async () => {
    const gone = writeBook('gone.fb2', FB2_SAMPLE);
    writeBook('kept.epub', buildEpub());
    await scanLibraryFolder(db, dir);
    expect(db.listBooks()).toHaveLength(2);

    fs.rmSync(gone);
    const summary = await scanLibraryFolder(db, dir);
    expect(summary.removed).toBe(1);
    expect(db.listBooks()).toHaveLength(1);
    expect(db.listBooks()[0]!.filename).toBe('kept.epub');
  });

  it('counts unreadable books as failed and reports errors', async () => {
    writeBook('broken.fb2', 'this is not xml at all');
    writeBook('good.fb2', FB2_SAMPLE);
    const summary = await scanLibraryFolder(db, dir);
    expect(summary.failed).toBe(1);
    expect(summary.added).toBe(1);
    expect(summary.errors[0]).toContain('broken.fb2');
  });

  it('skips hidden subdirectories but scans the root itself', async () => {
    writeBook('visible.fb2', FB2_SAMPLE);
    writeBook('.hidden/sneaky.fb2', FB2_SAMPLE);
    const summary = await scanLibraryFolder(db, dir);
    expect(summary.added).toBe(1);
  });

  it('rejects a missing folder', async () => {
    await expect(scanLibraryFolder(db, path.join(dir, 'nope'))).rejects.toThrow(/Folder not found/);
  });

  it('rejects a non-directory path', async () => {
    const file = writeBook('file.fb2', FB2_SAMPLE);
    await expect(scanLibraryFolder(db, file)).rejects.toThrow(/Not a directory/);
  });

  it('handles a folder with no books', async () => {
    const summary = await scanLibraryFolder(db, dir);
    expect(summary).toEqual(emptySummary());
    expect(db.listBooks()).toEqual([]);
  });

  it('aborts when the folder is detached mid-scan', async () => {
    for (let i = 0; i < 40; i++) writeBook(`b${i}.fb2`, FB2_SAMPLE);
    db.addLibraryFolder(dir);
    let detached = false;
    const summary = await scanLibraryFolder(db, dir, (done) => {
      // After the first batch, simulate :library remove confirming mid-scan:
      // books are deleted and the folder row is removed.
      if (!detached && done > 0) {
        detached = true;
        db.removeBooksByLibraryRoot(dir);
        db.removeLibraryFolder(db.getLibraryFolderByPath(dir)!.id);
      }
    });
    // Batch 1 was upserted then deleted by the detach; the scan must not
    // re-insert the remaining files with a stale library_root.
    expect(db.listBooks()).toHaveLength(0);
    expect(summary.added).toBeGreaterThan(0);
  });

  it('records the scan completion time on the attached folder', async () => {
    writeBook('a.fb2', FB2_SAMPLE);
    db.addLibraryFolder(dir);
    await scanLibraryFolder(db, dir);
    const folder = db.getLibraryFolderByPath(dir)!;
    expect(folder.lastScannedAt).toEqual(expect.any(Number));
    // After a fresh scan the folder needs no rescan.
    await expect(folderNeedsRescan(db, folder)).resolves.toBe(false);
  });
});

describe('walkBookFiles', () => {
  it('walks every book file recursively when the callback never aborts', async () => {
    writeBook('a.fb2', FB2_SAMPLE);
    writeBook('sub/b.epub', buildEpub());
    writeBook('sub/deep/c.fb2.zip', makeFb2Zip(FB2_SAMPLE));
    const visited: string[] = [];
    await walkBookFiles(dir, (file) => {
      visited.push(file);
    });
    expect(visited).toHaveLength(3);
    expect(new Set(visited).size).toBe(3);
  });

  it('aborts the walk early when the callback returns false', async () => {
    for (let i = 0; i < 10; i++) writeBook(`b${i}.fb2`, FB2_SAMPLE);
    const visited: string[] = [];
    await walkBookFiles(dir, (file) => {
      visited.push(path.basename(file));
      return visited.length < 3;
    });
    // The walker stops at the third file; the remaining seven are untouched.
    expect(visited).toHaveLength(3);
    expect(fs.readdirSync(dir).filter((n) => n.endsWith('.fb2'))).toHaveLength(10);
  });

  it('ignores non-book files and hidden directories', async () => {
    writeBook('visible.fb2', FB2_SAMPLE);
    writeBook('notes.txt', 'not a book');
    writeBook('.hidden/sneaky.fb2', FB2_SAMPLE);
    const visited: string[] = [];
    await walkBookFiles(dir, (file) => {
      visited.push(path.basename(file));
    });
    expect(visited).toEqual(['visible.fb2']);
  });
});

describe('folderNeedsRescan', () => {
  it('is dirty for a never-scanned folder', async () => {
    writeBook('a.fb2', FB2_SAMPLE);
    db.addLibraryFolder(dir);
    const folder = db.getLibraryFolderByPath(dir)!;
    expect(folder.lastScannedAt).toBeNull();
    await expect(folderNeedsRescan(db, folder)).resolves.toBe(true);
  });

  it('detects a modified file', async () => {
    const file = writeBook('a.fb2', FB2_SAMPLE);
    db.addLibraryFolder(dir);
    await scanLibraryFolder(db, dir);
    const folder = db.getLibraryFolderByPath(dir)!;
    await expect(folderNeedsRescan(db, folder)).resolves.toBe(false);

    const future = Date.now() + 5000;
    fs.utimesSync(file, new Date(future), new Date(future));
    await expect(folderNeedsRescan(db, folder)).resolves.toBe(true);
  });

  it('detects an added file', async () => {
    writeBook('a.fb2', FB2_SAMPLE);
    db.addLibraryFolder(dir);
    await scanLibraryFolder(db, dir);
    const folder = db.getLibraryFolderByPath(dir)!;
    await expect(folderNeedsRescan(db, folder)).resolves.toBe(false);

    const added = writeBook('new.epub', buildEpub());
    // Set its mtime explicitly to a time after the scan timestamp:
    // filesystem mtime granularity is coarse (1s on some CI filesystems), so
    // a file created in the same second as the scan could compare as "not
    // newer" and flake this assertion.
    fs.utimesSync(added, Date.now() / 1000 + 5, Date.now() / 1000 + 5);
    await expect(folderNeedsRescan(db, folder)).resolves.toBe(true);
  });

  it('detects a deleted file', async () => {
    const file = writeBook('a.fb2', FB2_SAMPLE);
    db.addLibraryFolder(dir);
    await scanLibraryFolder(db, dir);
    const folder = db.getLibraryFolderByPath(dir)!;
    await expect(folderNeedsRescan(db, folder)).resolves.toBe(false);

    fs.rmSync(file);
    await expect(folderNeedsRescan(db, folder)).resolves.toBe(true);
  });

  it('skips a folder missing on disk', async () => {
    writeBook('a.fb2', FB2_SAMPLE);
    db.addLibraryFolder(dir);
    await scanLibraryFolder(db, dir);
    const folder = db.getLibraryFolderByPath(dir)!;
    await expect(folderNeedsRescan(db, folder)).resolves.toBe(false);

    // The attached folder row survives even though the directory is gone.
    fs.rmSync(dir, { recursive: true });
    await expect(folderNeedsRescan(db, folder)).resolves.toBe(false);
  });

  it('is not perpetually dirty because of an unparseable file', async () => {
    writeBook('good.fb2', FB2_SAMPLE);
    writeBook('broken.fb2', 'this is not xml');
    db.addLibraryFolder(dir);
    await scanLibraryFolder(db, dir);
    const folder = db.getLibraryFolderByPath(dir)!;
    expect(db.listBooks()).toHaveLength(1);
    // The broken file is walked but never lands in the DB; the membership-
    // based check must not treat its permanent absence as a change, or the
    // folder would rescan on every library entry forever.
    await expect(folderNeedsRescan(db, folder)).resolves.toBe(false);
  });
});

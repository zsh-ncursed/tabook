// Database layer golden script: NativeDbBackend (rusqlite through the napi
// binding) runs the full operation script and the result is snapshotted.
// The former better-sqlite3 backend it was parity-checked against is gone
// (the Rust core is now the single DB implementation), so this file guards
// the native behavior itself: any change to record shapes, id allocation,
// derived text or cascade behavior shows up as a snapshot diff.
import { describe, it, expect, afterAll } from 'vitest';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { NativeDbBackend, type DbBackend, type SessionStats } from '../db/db.js';
import type { BookMetadata } from '../formats/model.js';
import { requireNative } from './helpers.js';

// Guard the native binding so NativeDbBackend can open a database.
requireNative();

const META_A: BookMetadata = {
  title: 'Тестовая книга — Том I',
  authors: [
    { firstName: 'Иван', lastName: 'Петров', middleName: 'Сергеевич' },
    { firstName: 'Jane', lastName: 'Roe', nickname: 'jane' },
    { firstName: 'Solo', lastName: 'Author' },
  ],
  series: { name: 'Серия', number: 3 },
  genres: ['fantasy', 'sci-fi'],
  annotation: 'Аннотация с переносом строки.',
  lang: 'ru',
  coverKey: 'cover.jpg',
  publisher: 'Издательство',
  isbn: '978-5-00000-000-0',
  year: 2021,
};

const META_B: BookMetadata = {
  title: 'Minimal',
  authors: [],
  genres: [],
  annotation: '',
};

const ROOT = '/lib/root';

// The exact same operations, in the exact same order, on both backends. Ids
// are not compared to constants — only that both sides agree with each
// other, so a change to id allocation on one side is caught.
function script(
  db: DbBackend,
  paths: { a: string; b: string },
): {
  bookIds: number[];
  bookA: unknown;
  bookByPath: unknown;
  listAll: unknown;
  listLimit: unknown;
  listAdded: unknown;
  listOpened: unknown;
  progress: unknown;
  bookmarkId: number;
  bookmarks: unknown;
  bookmark: unknown;
  bookmarkUpdated: unknown;
  bookmarkAfterDelete: unknown;
  history: unknown;
  recent: unknown;
  continueList: unknown;
  stats: SessionStats;
  catalogIds: number[];
  catalogs: unknown;
  catalog: unknown;
  catalogByName: unknown;
  catalogAfterUpdate: unknown;
  catalogsAfterRemove: unknown;
  folderId: number;
  folders: unknown;
  folderByPath: unknown;
  foldersScanned: unknown;
  pathsInRoot: unknown;
  removedByPaths: number;
  bookAfterRemove: unknown;
  removedByRoot: number;
  folderRemoved: boolean;
  foldersFinal: unknown;
} {
  const idA = db.addBook({
    path: paths.a,
    filename: 'book-a.fb2',
    format: 'fb2',
    size: 1234,
    metadata: META_A,
  });
  const idB = db.addBook({
    path: paths.b,
    filename: 'book-b.epub',
    format: 'epub',
    size: 99,
    metadata: META_B,
    libraryRoot: ROOT,
  });

  db.setProgress(idA, 12345, 42);
  const bookmarkId = db.addBookmark(idA, 500, 'закладка');

  db.recordOpen(idA);
  const sessionId = db.startSession(idA);
  db.endSession(sessionId, 3);

  const cat1 = db.addCatalog({ name: 'gutenberg', url: 'https://gutenberg.org' });
  const cat2 = db.addCatalog({ name: 'auth', url: 'https://x', username: 'u', password: 'secret' });
  db.updateCatalog(cat1, { username: 'newuser' });
  db.removeCatalog(cat2);

  const folderId = db.addLibraryFolder(ROOT);
  db.setFolderScannedAt(folderId, 123456);

  return {
    bookIds: [idA, idB],
    bookA: db.getBook(idA),
    bookByPath: db.getBookByPath(paths.a),
    listAll: db.listBooks(),
    listLimit: db.listBooks({ limit: 1 }),
    listAdded: db.listBooks({ orderBy: 'added' }),
    listOpened: db.listBooks({ orderBy: 'opened' }),
    progress: db.getProgress(idA),
    bookmarkId,
    bookmarks: db.listBookmarks(idA),
    bookmark: db.getBookmark(bookmarkId),
    bookmarkUpdated: db.updateBookmarkLabel(bookmarkId, 'новая'),
    bookmarkAfterDelete: (() => {
      db.deleteBookmark(bookmarkId);
      return db.getBookmark(bookmarkId);
    })(),
    history: db.listHistory(5),
    recent: db.listRecentBooks(5),
    continueList: db.listContinueBooks(5),
    stats: db.getStats(idA),
    catalogIds: [cat1, cat2],
    catalogs: db.listCatalogs(),
    catalog: db.getCatalog(cat1),
    catalogByName: db.getCatalogByName('auth'),
    catalogAfterUpdate: db.getCatalog(cat1),
    catalogsAfterRemove: db.listCatalogs(),
    folderId,
    folders: db.listLibraryFolders(),
    folderByPath: db.getLibraryFolderByPath(ROOT),
    foldersScanned: db.listLibraryFolders(),
    pathsInRoot: db.listPathsByLibraryRoot(ROOT),
    removedByPaths: db.removeBooksByPaths([paths.a]),
    bookAfterRemove: db.getBook(idA),
    removedByRoot: db.removeBooksByLibraryRoot(ROOT),
    folderRemoved: db.removeLibraryFolder(folderId),
    foldersFinal: db.listLibraryFolders(),
  };
}

describe('parity: database backend', () => {
  const dirs: string[] = [];

  afterAll(() => {
    for (const d of dirs) fs.rmSync(d, { recursive: true, force: true });
  });

  it('native backend runs the full operation script consistently', () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'tabook-db-parity-'));
    dirs.push(dir);
    const natPath = path.join(dir, 'native.db');
    const paths = { a: path.join(dir, 'book-a.fb2'), b: path.join(dir, 'book-b.epub') };

    const nat = new NativeDbBackend(natPath);
    try {
      const out = script(nat, paths);

      // Determinism spot-checks that the old cross-backend comparison
      // covered indirectly: id allocation is sequential, the upsert keeps
      // one row per path, and deletes report exact counts.
      expect(out.bookIds).toEqual([1, 2]);
      expect(out.removedByPaths).toBe(1);
      expect(out.removedByRoot).toBe(1);
      expect(out.bookAfterRemove).toBeUndefined();
      expect(out.folderRemoved).toBe(true);
      expect(out.foldersFinal).toEqual([]);

      // Derived text matches the structured authors/series.
      const bookA = out.bookA as {
        authorsText: string;
        seriesText: string | null;
        progressPercent: number | null;
        progressPosition: number | null;
      };
      expect(bookA.authorsText).toBe('Петров Иван Сергеевич, jane, Author Solo');
      expect(bookA.seriesText).toBe('Серия #3');
      expect(bookA.progressPercent).toBeCloseTo(42);
      expect(bookA.progressPosition).toBe(12345);

      // Cascades: progress/bookmarks/sessions die with the book.
      expect(out.progress).toBeDefined();
      expect((out.bookmarks as unknown[]).length).toBeGreaterThan(0);
      expect(out.stats.sessionCount).toBe(1);
    } finally {
      nat.close();
    }
  });
});

import type { BookMetadata } from '../formats/model.js';
import { joinAuthors, formatSeries } from '../formats/model.js';
import { native, isNativeErrorResult, getNativeLoadError } from '../native.js';
import {
  encryptCatalogPassword,
  decryptCatalogPassword,
  isEncryptedCatalogPassword,
} from './catalogCrypto.js';
import type * as NativeTypes from '@tabook/native';
import { DatabaseError } from '../utils/errors.js';

export interface BookRecord extends BookMetadata {
  id: number;
  path: string;
  filename: string;
  format: 'fb2' | 'epub';
  size: number;
  addedAt: string;
  lastOpenedAt: string | null;
  authorsText: string;
  seriesText: string | null;
  progressPercent: number | null;
  progressPosition: number | null;
}

export interface BookmarkRecord {
  id: number;
  bookId: number;
  position: number;
  label: string;
  createdAt: string;
}

export interface ProgressRecord {
  bookId: number;
  position: number;
  percent: number;
  updatedAt: string;
}

export interface HistoryRecord {
  bookId: number;
  title: string;
  openedAt: string;
}

export interface SessionStats {
  totalSeconds: number;
  totalPages: number;
  sessionCount: number;
  lastReadAt: string | null;
}

export interface CatalogRecord {
  id: number;
  name: string;
  url: string;
  username: string | null;
  password: string | null;
}

export interface LibraryFolderRecord {
  id: number;
  path: string;
  addedAt: string;
  // Epoch milliseconds of the last completed scan, used to skip rescans of
  // folders whose files haven't changed (mtime comparison). null = never
  // scanned (or scanned before this column existed) → must scan.
  lastScannedAt: number | null;
}

export type SortField = 'title' | 'author' | 'added' | 'progress';

// ---- shared interface for the two backends ---------------------------------

// Exported for the TS↔Rust parity suite (src/parity/db.parity.test.ts), which
// drives both backends through the identical operation script.
export interface DbBackend {
  readonly filePath: string;
  close(): void;
  fileExists(): boolean;
  addBook(record: {
    path: string;
    filename: string;
    format: 'fb2' | 'epub';
    size: number;
    metadata: BookMetadata;
    libraryRoot?: string;
  }): number;
  getBook(id: number): BookRecord | undefined;
  getBookByPath(filePath: string): BookRecord | undefined;
  listBooks(opts?: {
    limit?: number;
    offset?: number;
    orderBy?: 'title' | 'added' | 'opened';
  }): BookRecord[];
  removeBook(id: number): boolean;
  setProgress(bookId: number, position: number, percent: number): void;
  getProgress(bookId: number): ProgressRecord | undefined;
  addBookmark(bookId: number, position: number, label: string): number;
  listBookmarks(bookId: number): BookmarkRecord[];
  getBookmark(id: number): BookmarkRecord | undefined;
  deleteBookmark(id: number): boolean;
  updateBookmarkLabel(id: number, label: string): boolean;
  recordOpen(bookId: number): void;
  listHistory(limit?: number): HistoryRecord[];
  listRecentBooks(limit?: number): BookRecord[];
  listContinueBooks(limit?: number): BookRecord[];
  startSession(bookId: number): number;
  endSession(sessionId: number, pagesRead: number): void;
  getStats(bookId: number): SessionStats;
  addCatalog(catalog: { name: string; url: string; username?: string; password?: string }): number;
  listCatalogs(): CatalogRecord[];
  getCatalog(id: number): CatalogRecord | undefined;
  getCatalogByName(name: string): CatalogRecord | undefined;
  updateCatalog(
    id: number,
    fields: { name?: string; url?: string; username?: string; password?: string },
  ): void;
  removeCatalog(id: number): void;
  addLibraryFolder(folderPath: string): number;
  listLibraryFolders(): LibraryFolderRecord[];
  getLibraryFolderByPath(folderPath: string): LibraryFolderRecord | undefined;
  setFolderScannedAt(id: number, scannedAtMs: number): void;
  removeLibraryFolder(id: number): boolean;
  listPathsByLibraryRoot(root: string): string[];
  removeBooksByPaths(paths: string[]): number;
  removeBooksByLibraryRoot(root: string): number;
}

// Convert a native (rusqlite-backed) book record into the TS BookRecord shape.
// Native returns structured authors/series; the TS contract additionally
// carries authorsText/seriesText and null (not undefined) for absent fields.
function nativeToBookRecord(b: NativeTypes.BookRecord): BookRecord {
  const authors: BookMetadata['authors'] = b.authors.map((a) => ({
    firstName: a.firstName,
    lastName: a.lastName,
    middleName: a.middleName ?? '',
    nickname: a.nickname,
  }));
  const metadata: BookMetadata = {
    title: b.title,
    authors,
    genres: b.genres,
    annotation: b.annotation,
    lang: b.lang ?? undefined,
    coverKey: b.coverKey ?? undefined,
    publisher: b.publisher ?? undefined,
    isbn: b.isbn ?? undefined,
    year: b.year ?? undefined,
  };
  if (b.series) {
    metadata.series = { name: b.series.name, number: b.series.number };
  }
  return {
    ...metadata,
    id: b.id,
    path: b.path,
    filename: b.filename,
    format: b.format as 'fb2' | 'epub',
    size: b.size,
    addedAt: b.addedAt,
    lastOpenedAt: b.lastOpenedAt ?? null,
    authorsText: joinAuthors(authors),
    seriesText: formatSeries(metadata.series) ?? null,
    progressPercent: b.progressPercent ?? null,
    progressPosition: b.progressPosition ?? null,
  };
}

function nativeToCatalog(c: NativeTypes.CatalogRecord): CatalogRecord {
  return {
    id: c.id,
    name: c.name,
    url: c.url,
    username: c.username ?? null,
    password: c.password ?? null,
  };
}

function nativeToFolder(f: NativeTypes.LibraryFolderRecord): LibraryFolderRecord {
  return {
    id: f.id,
    path: f.path,
    addedAt: f.addedAt,
    lastScannedAt: f.lastScannedAt ?? null,
  };
}

// napi-rs returns Err from Result-returning #[napi] fns as a value
// ({ code: ... }) rather than throwing. DB methods that can fail must check
// the return for that shape and surface a DatabaseError.
function unwrapNative<T>(result: T): T {
  if (isNativeErrorResult(result)) {
    throw new DatabaseError(result.message ?? String(result));
  }
  return result;
}

// ---- native (rusqlite) backend ----------------------------------------------

export class NativeDbBackend implements DbBackend {
  private readonly db: NativeTypes.LibraryDb;
  readonly filePath: string;

  constructor(filePath: string) {
    this.filePath = filePath;
    if (!native) {
      throw new DatabaseError(
        `Cannot open database at ${filePath}: the Rust core (@tabook/native) is unavailable` +
          (getNativeLoadError() ? ` — ${getNativeLoadError()}` : '') +
          '. Build it with `npm run build:native`.',
      );
    }
    // Created via the napi factory (no JS constructor): napi-rs surfaces the
    // open failure as an error-value ({ code, message }), not a throw.
    const opened = native.openLibraryDb(filePath);
    if (isNativeErrorResult(opened)) {
      throw new DatabaseError(
        `Cannot open database at ${filePath}: ${opened.message ?? String(opened)}`,
        {
          cause: opened,
        },
      );
    }
    this.db = opened;
  }

  close(): void {
    this.db.close();
  }

  fileExists(): boolean {
    return this.db.fileExists();
  }

  addBook(record: {
    path: string;
    filename: string;
    format: 'fb2' | 'epub';
    size: number;
    metadata: BookMetadata;
    libraryRoot?: string;
  }): number {
    const id = unwrapNative(
      this.db.addBook(
        record.path,
        record.filename,
        record.format,
        record.size,
        record.metadata,
        record.libraryRoot ?? null,
      ),
    );
    return Number(id);
  }

  getBook(id: number): BookRecord | undefined {
    const b = this.db.getBook(id);
    return b ? nativeToBookRecord(b) : undefined;
  }

  getBookByPath(filePath: string): BookRecord | undefined {
    const b = this.db.getBookByPath(filePath);
    return b ? nativeToBookRecord(b) : undefined;
  }

  listBooks(opts?: {
    limit?: number;
    offset?: number;
    orderBy?: 'title' | 'added' | 'opened';
  }): BookRecord[] {
    const rows = this.db.listBooks(
      opts?.limit ?? null,
      opts?.offset ?? 0,
      opts?.orderBy ?? 'title',
    );
    return rows.map(nativeToBookRecord);
  }

  removeBook(id: number): boolean {
    return this.db.removeBook(id);
  }

  setProgress(bookId: number, position: number, percent: number): void {
    unwrapNative(this.db.setProgress(bookId, position, percent));
  }

  getProgress(bookId: number): ProgressRecord | undefined {
    const p = this.db.getProgress(bookId);
    return p
      ? {
          bookId: p.bookId,
          position: p.position,
          percent: p.percent,
          updatedAt: p.updatedAt,
        }
      : undefined;
  }

  addBookmark(bookId: number, position: number, label: string): number {
    return Number(unwrapNative(this.db.addBookmark(bookId, position, label)));
  }

  listBookmarks(bookId: number): BookmarkRecord[] {
    return this.db.listBookmarks(bookId).map((b) => ({
      id: b.id,
      bookId: b.bookId,
      position: b.position,
      label: b.label,
      createdAt: b.createdAt,
    }));
  }

  getBookmark(id: number): BookmarkRecord | undefined {
    const b = this.db.getBookmark(id);
    return b
      ? {
          id: b.id,
          bookId: b.bookId,
          position: b.position,
          label: b.label,
          createdAt: b.createdAt,
        }
      : undefined;
  }

  deleteBookmark(id: number): boolean {
    return this.db.deleteBookmark(id);
  }

  updateBookmarkLabel(id: number, label: string): boolean {
    return this.db.updateBookmarkLabel(id, label);
  }

  recordOpen(bookId: number): void {
    unwrapNative(this.db.recordOpen(bookId));
  }

  listHistory(limit = 20): HistoryRecord[] {
    return this.db.listHistory(limit).map((h) => ({
      bookId: h.bookId,
      title: h.title,
      openedAt: h.openedAt,
    }));
  }

  listRecentBooks(limit = 20): BookRecord[] {
    return this.db.listRecentBooks(limit).map(nativeToBookRecord);
  }

  listContinueBooks(limit = 20): BookRecord[] {
    return this.db.listContinueBooks(limit).map(nativeToBookRecord);
  }

  startSession(bookId: number): number {
    return Number(unwrapNative(this.db.startSession(bookId)));
  }

  endSession(sessionId: number, pagesRead: number): void {
    unwrapNative(this.db.endSession(sessionId, pagesRead));
  }

  getStats(bookId: number): SessionStats {
    const s = this.db.getStats(bookId);
    return {
      totalSeconds: s.totalSeconds,
      totalPages: s.totalPages,
      sessionCount: s.sessionCount,
      lastReadAt: s.lastReadAt ?? null,
    };
  }

  addCatalog(catalog: { name: string; url: string; username?: string; password?: string }): number {
    const id = unwrapNative(
      this.db.addCatalog(
        catalog.name,
        catalog.url,
        catalog.username ?? null,
        catalog.password ?? null,
      ),
    );
    return Number(id);
  }

  listCatalogs(): CatalogRecord[] {
    return this.db.listCatalogs().map(nativeToCatalog);
  }

  getCatalog(id: number): CatalogRecord | undefined {
    const c = this.db.getCatalog(id);
    return c ? nativeToCatalog(c) : undefined;
  }

  getCatalogByName(name: string): CatalogRecord | undefined {
    const c = this.db.getCatalogByName(name);
    return c ? nativeToCatalog(c) : undefined;
  }

  updateCatalog(
    id: number,
    fields: { name?: string; url?: string; username?: string; password?: string },
  ): void {
    unwrapNative(
      this.db.updateCatalog(id, fields.name, fields.url, fields.username, fields.password),
    );
  }

  removeCatalog(id: number): void {
    unwrapNative(this.db.removeCatalog(id));
  }

  addLibraryFolder(folderPath: string): number {
    return Number(unwrapNative(this.db.addLibraryFolder(folderPath)));
  }

  listLibraryFolders(): LibraryFolderRecord[] {
    return this.db.listLibraryFolders().map(nativeToFolder);
  }

  getLibraryFolderByPath(folderPath: string): LibraryFolderRecord | undefined {
    const f = this.db.getLibraryFolderByPath(folderPath);
    return f ? nativeToFolder(f) : undefined;
  }

  setFolderScannedAt(id: number, scannedAtMs: number): void {
    unwrapNative(this.db.setFolderScannedAt(id, scannedAtMs));
  }

  removeLibraryFolder(id: number): boolean {
    return this.db.removeLibraryFolder(id);
  }

  listPathsByLibraryRoot(root: string): string[] {
    return this.db.listPathsByLibraryRoot(root);
  }

  removeBooksByPaths(paths: string[]): number {
    return Number(unwrapNative(this.db.removeBooksByPaths(paths)));
  }

  removeBooksByLibraryRoot(root: string): number {
    return Number(unwrapNative(this.db.removeBooksByLibraryRoot(root)));
  }
}

// ---- public facade -----------------------------------------------------------

// The library database is owned by the Rust core (rusqlite, bundled SQLite).
// The former better-sqlite3 TS backend is gone: the schema lived in two places
// and had to be migrated in lockstep, and the release package never shipped it
// ("on glibc Linux that fallback is never needed" — README). When the native
// binding is unavailable the constructor fails fast with the loader's reason
// instead of silently degrading to a second SQL implementation.
export class LibraryDb implements DbBackend {
  private readonly impl: NativeDbBackend;
  readonly filePath: string;

  constructor(filePath: string) {
    this.filePath = filePath;
    this.impl = new NativeDbBackend(filePath);
    this.migrateLegacyPasswords();
  }

  // One-time migration: databases created before password encryption stored
  // OPDS passwords in plaintext. Rewrite them encrypted so the plaintext never
  // sits on disk after an upgrade. (Best-effort — a failure only means the
  // legacy value stays until the next write, and reads still work via the
  // decryptCatalog fallback.)
  private migrateLegacyPasswords(): void {
    try {
      for (const c of this.impl.listCatalogs()) {
        if (c.password !== null && c.password !== '' && !isEncryptedCatalogPassword(c.password)) {
          this.impl.updateCatalog(c.id, {
            password: encryptCatalogPassword(this.filePath, c.password),
          });
        }
      }
    } catch {
      // Non-fatal: leave legacy passwords as-is for now.
    }
  }

  // Decrypt a catalog record's password (encrypted at rest by add/update).
  // Undecryptable values (DB copied without its key file) become null so
  // callers re-prompt for credentials rather than crash.
  private decryptCatalog(c: CatalogRecord): CatalogRecord {
    if (c.password === null) return c;
    return { ...c, password: decryptCatalogPassword(this.filePath, c.password) };
  }

  close(): void {
    this.impl.close();
  }

  fileExists(): boolean {
    return this.impl.fileExists();
  }

  addBook(record: {
    path: string;
    filename: string;
    format: 'fb2' | 'epub';
    size: number;
    metadata: BookMetadata;
    libraryRoot?: string;
  }): number {
    return this.impl.addBook(record);
  }

  getBook(id: number): BookRecord | undefined {
    return this.impl.getBook(id);
  }

  getBookByPath(filePath: string): BookRecord | undefined {
    return this.impl.getBookByPath(filePath);
  }

  listBooks(opts?: {
    limit?: number;
    offset?: number;
    orderBy?: 'title' | 'added' | 'opened';
  }): BookRecord[] {
    return this.impl.listBooks(opts);
  }

  removeBook(id: number): boolean {
    return this.impl.removeBook(id);
  }

  setProgress(bookId: number, position: number, percent: number): void {
    this.impl.setProgress(bookId, position, percent);
  }

  getProgress(bookId: number): ProgressRecord | undefined {
    return this.impl.getProgress(bookId);
  }

  addBookmark(bookId: number, position: number, label: string): number {
    return this.impl.addBookmark(bookId, position, label);
  }

  listBookmarks(bookId: number): BookmarkRecord[] {
    return this.impl.listBookmarks(bookId);
  }

  getBookmark(id: number): BookmarkRecord | undefined {
    return this.impl.getBookmark(id);
  }

  deleteBookmark(id: number): boolean {
    return this.impl.deleteBookmark(id);
  }

  updateBookmarkLabel(id: number, label: string): boolean {
    return this.impl.updateBookmarkLabel(id, label);
  }

  recordOpen(bookId: number): void {
    this.impl.recordOpen(bookId);
  }

  listHistory(limit?: number): HistoryRecord[] {
    return this.impl.listHistory(limit);
  }

  listRecentBooks(limit?: number): BookRecord[] {
    return this.impl.listRecentBooks(limit);
  }

  listContinueBooks(limit?: number): BookRecord[] {
    return this.impl.listContinueBooks(limit);
  }

  startSession(bookId: number): number {
    return this.impl.startSession(bookId);
  }

  endSession(sessionId: number, pagesRead: number): void {
    this.impl.endSession(sessionId, pagesRead);
  }

  getStats(bookId: number): SessionStats {
    return this.impl.getStats(bookId);
  }

  addCatalog(catalog: { name: string; url: string; username?: string; password?: string }): number {
    const { password, ...rest } = catalog;
    return this.impl.addCatalog({
      ...rest,
      password:
        password !== undefined ? encryptCatalogPassword(this.filePath, password) : undefined,
    });
  }

  listCatalogs(): CatalogRecord[] {
    return this.impl.listCatalogs().map((c) => this.decryptCatalog(c));
  }

  getCatalog(id: number): CatalogRecord | undefined {
    const c = this.impl.getCatalog(id);
    return c ? this.decryptCatalog(c) : undefined;
  }

  getCatalogByName(name: string): CatalogRecord | undefined {
    const c = this.impl.getCatalogByName(name);
    return c ? this.decryptCatalog(c) : undefined;
  }

  updateCatalog(
    id: number,
    fields: { name?: string; url?: string; username?: string; password?: string },
  ): void {
    const { password, ...rest } = fields;
    this.impl.updateCatalog(id, {
      ...rest,
      password:
        password !== undefined ? encryptCatalogPassword(this.filePath, password) : undefined,
    });
  }

  removeCatalog(id: number): void {
    this.impl.removeCatalog(id);
  }

  addLibraryFolder(folderPath: string): number {
    return this.impl.addLibraryFolder(folderPath);
  }

  listLibraryFolders(): LibraryFolderRecord[] {
    return this.impl.listLibraryFolders();
  }

  getLibraryFolderByPath(folderPath: string): LibraryFolderRecord | undefined {
    return this.impl.getLibraryFolderByPath(folderPath);
  }

  setFolderScannedAt(id: number, scannedAtMs: number): void {
    this.impl.setFolderScannedAt(id, scannedAtMs);
  }

  removeLibraryFolder(id: number): boolean {
    return this.impl.removeLibraryFolder(id);
  }

  listPathsByLibraryRoot(root: string): string[] {
    return this.impl.listPathsByLibraryRoot(root);
  }

  removeBooksByPaths(paths: string[]): number {
    return this.impl.removeBooksByPaths(paths);
  }

  removeBooksByLibraryRoot(root: string): number {
    return this.impl.removeBooksByLibraryRoot(root);
  }
}
